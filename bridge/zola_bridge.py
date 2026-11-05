#!/usr/bin/env python3
"""zola_bridge.py — THE HIL TELEMETRY BRIDGE (spec section 4, fixed).

Parses the Zola flight controller's 36-byte binary frames (see
firmware/zola_fc/zola_flight.cpp for the packet canon) and streams them as
JSON over WebSocket to the panel.

Fixes over the draft:
  * ONE serial reader task broadcasts to N websocket clients — the draft
    opened the serial port once per client, which fails on the second
    connect (the OS allows one holder).
  * CRC verified with the firmware's exact routine (reflected 0xA001,
    init 0xFFFF, over bytes 0..31) — the draft accepted any garbage whose
    header/footer matched.
  * Header/footer = the spec table's wire bytes (FA FB / FC FD); the draft's
    0xFBFB check disagreed with its own spec.
  * Port auto-detect + env overrides, and --sim: a built-in frame generator
    so the whole pipeline runs end-to-end TODAY, before the FC exists.

Run:
  python bridge/zola_bridge.py --sim          # bench test, no hardware
  python bridge/zola_bridge.py                # real FC, auto-detected port
  ZOLA_FC_PORT=COM7 python bridge/zola_bridge.py
"""
import argparse
import asyncio
import json
import os
import struct
import sys
import time

try:
    import serial
except ImportError:
    serial = None
try:
    import websockets
except ImportError:
    websockets = None

BAUD_RATE = 921_600
PACKET_SIZE = 36
HEADER = b"\xFA\xFB"
FOOTER = b"\xFC\xFD"
UNPACK = struct.Struct("<HIIfffHHHHHHH")  # header,seq,ts,r,p,y,m1..m4,batt,crc,footer
CRC_SPAN = 32  # crc covers bytes 0..31 (everything except crc itself and footer)


def zola_crc(data: bytes) -> int:
    """The firmware's routine, byte for byte (reflected 0xA001, init 0xFFFF)."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def parse_frame(frame: bytes):
    """Validate + unpack one 36-byte frame. None = structurally invalid."""
    if len(frame) != PACKET_SIZE or frame[:2] != HEADER or frame[-2:] != FOOTER:
        return None
    header, seq, ts, roll, pitch, yaw, m1, m2, m3, m4, batt, crc, footer = UNPACK.unpack(frame)
    if zola_crc(frame[:CRC_SPAN]) != crc:
        return None
    return {
        "sequence_id": seq,
        "timestamp_us": ts,
        "attitude": {"roll": round(roll, 3), "pitch": round(pitch, 3), "yaw": round(yaw, 3)},
        "motors": [m1, m2, m3, m4],
        "battery_mv": batt,
    }


def find_serial_port():
    """Auto-detect the FC's serial port (env override wins)."""
    env = os.environ.get("ZOLA_FC_PORT")
    if env:
        return env
    if serial is None:
        return None
    from serial.tools import list_ports
    ports = list(list_ports.comports())
    for p in ports:  # prefer USB CDC / CP210x-style bridges
        if "USB" in (p.description or "") or "CP210" in (p.description or ""):
            return p.device
    return ports[0].device if ports else None


class Bridge:
    def __init__(self, source, stats_interval=5.0, envelope_type="ZOLA_TELEMETRY_UPDATE",
                 panel_id="hil_telemetry_03"):
        self.source = source          # "serial" | "sim" | "udp"
        self.envelope_type = envelope_type
        self.panel_id = panel_id
        self.clients: set = set()
        self.frames_ok = 0
        self.frames_bad = 0
        self.stats_interval = stats_interval

    async def broadcast(self, data: dict, source_ip: str | None = None):
        message = json.dumps({
            "type": self.envelope_type,
            "panel_id": self.panel_id,
            "payload": data,
            **({"source_ip": source_ip} if source_ip else {}),
        })
        dead = []
        for ws in self.clients:
            try:
                # a stuck client must never stall the 100 Hz promise — 20 ms
                # of grace (2 missed frames), then the client is dropped
                # (it can reconnect)
                await asyncio.wait_for(ws.send(message), timeout=0.02)
            except (asyncio.TimeoutError, Exception):
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def stats_loop(self):
        while True:
            await asyncio.sleep(self.stats_interval)
            rate = self.frames_ok / self.stats_interval
            print(f"[Zola Bridge] {rate:.0f} fps ok · {self.frames_bad} bad · "
                  f"{len(self.clients)} client(s)", flush=True)
            self.frames_ok = 0
            self.frames_bad = 0

    # ---- the serial reader: ONE owner, resyncs on any framing error ----
    async def serial_loop(self):
        port_name = find_serial_port()
        if not port_name:
            print("[Zola Bridge] no serial port found — falling back to --sim", flush=True)
            return await self.sim_loop()
        ser = serial.Serial(port_name, BAUD_RATE, timeout=0.01)
        print(f"[Zola Bridge] reading {port_name} @ {BAUD_RATE}", flush=True)
        buffer = bytearray()
        while True:
            await asyncio.sleep(0.001)
            n = ser.in_waiting
            if not n:
                continue
            buffer.extend(ser.read(n))
            while True:
                start = buffer.find(HEADER)
                if start < 0:
                    buffer.clear()
                    break
                if start:
                    del buffer[:start]  # resync: drop the pre-header noise
                if len(buffer) < PACKET_SIZE:
                    break
                frame = bytes(buffer[:PACKET_SIZE])
                data = parse_frame(frame)
                if data:
                    del buffer[:PACKET_SIZE]
                    self.frames_ok += 1
                    await self.broadcast(data)
                else:
                    # bad CRC or mangled frame: drop ONE byte and rescan —
                    # never silently swallow a corrupt frame
                    del buffer[:2]
                    self.frames_bad += 1

    # ---- the simulator: spec-shaped frames at 100 Hz, bench-testable ----
    async def sim_loop(self):
        import math
        print("[Zola Bridge] SIM mode — generating spec-shaped frames (no FC needed)", flush=True)
        seq = 0
        start = time.perf_counter()
        # THE TICK GATE: the rate is governed by the CLOCK, not by sleep
        # granularity. sleep(0.01) on Windows proved unreliable under a live
        # websocket reader (websockets 14.2 distorted the timer — one probe
        # measured 21,000 fps from the same loop that gave 64 fps with no
        # client). Only the wall clock opens the gate; the rate cannot run
        # away, no matter what the sleeps do.
        next_tick = start + 0.01
        while True:
            now = time.perf_counter()
            if now < next_tick:
                await asyncio.sleep(min(0.002, max(0.0, next_tick - now)))
                continue
            next_tick += 0.01
            if next_tick < now - 0.05:  # we fell far behind — re-anchor
                next_tick = now + 0.01
            t = now - start
            seq += 1
            roll = 5.0 * math.sin(t * 1.2)
            pitch = 4.0 * math.sin(t * 0.9)
            yaw = (t * 12.0) % 360.0
            head = struct.pack(
                "<HIIfffHHHHH",  # header,seq,ts,roll,pitch,yaw,m1..m4,battery
                0xFBFA, seq, int(t * 1_000_000),
                roll, pitch, yaw,
                1150, 1150, int(1148 + 6 * math.sin(t * 2.0)), 1152,
                12450 - int(t * 2),  # the sim battery slowly drains, like a real one
            )
            frame = head + struct.pack("<HH", zola_crc(head), 0xFDFC)
            data = parse_frame(frame)
            if data:
                self.frames_ok += 1
                await self.broadcast(data)

    async def handler(self, websocket):
        self.clients.add(websocket)
        try:
            await websocket.wait_closed()
        finally:
            self.clients.discard(websocket)

    async def run(self, host="127.0.0.1", port=8002):
        async with websockets.serve(self.handler, host, port):
            print(f"[Zola Bridge] telemetry bridge active on ws://{host}:{port} "
                  f"(source: {self.source})", flush=True)
            await asyncio.gather(
                self.serial_loop() if self.source == "serial" else self.sim_loop(),
                self.stats_loop(),
            )


def main():
    parser = argparse.ArgumentParser(description="Zola HIL telemetry bridge")
    parser.add_argument("--sim", action="store_true", help="generate spec-shaped frames (no FC)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("ZOLA_WS_PORT", 8002)))
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    if websockets is None:
        sys.exit("pip install websockets pyserial")
    bridge = Bridge(source="sim" if args.sim else "serial")
    try:
        asyncio.run(bridge.run(args.host, args.port))
    except KeyboardInterrupt:
        print("[Zola Bridge] stopped", flush=True)


if __name__ == "__main__":
    main()
