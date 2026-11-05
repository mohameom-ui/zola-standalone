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
import itertools
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


def parse_pdb_frame(frame: bytes):
    """THE PDB VARIANT (36 bytes, header FB FC): power/thermal telemetry —
    decoded and routed as its own envelope; the flight canon is untouched."""
    if len(frame) != PACKET_SIZE or frame[0] != 0xFB or frame[1] != 0xFC:
        return None
    seq = struct.unpack_from("<I", frame, 2)[0]
    current_ma, power_cw, mah = struct.unpack_from("<HHH", frame, 6)
    esc_temp = frame[12]
    sag_mv = struct.unpack_from("<H", frame, 13)[0]
    limit_pct = frame[15]
    erpm = list(struct.unpack_from("<HHHH", frame, 16))
    v_bus = struct.unpack_from("<H", frame, 24)[0]
    flags = frame[26]
    crc = struct.unpack_from("<H", frame, 34)[0]
    if zola_crc(frame[:34]) != crc:
        return None
    # THE STATE ANNEX (bytes 27-33): the flight mode, the sensor health, the
    # waypoint progress, the swarm role — one frame, both stories
    return {
        "sequence_id": seq, "current_ma": current_ma, "power_w": power_cw / 100.0,
        "mah_used": mah, "esc_temp_max_c": esc_temp, "sag_mv": sag_mv,
        "throttle_limit_pct": limit_pct, "erpm": erpm, "v_bus_mv": v_bus,
        "thermal_brake": bool(flags & 1), "sag_limiting": bool(flags & 2),
        "mode": frame[27], "sensor_flags": frame[28],
        "wp_index": frame[29], "wp_count": frame[30],
        "leader_id": frame[31], "live_peers": frame[32], "braking": bool(frame[33]),
    }


def parse_frame(frame: bytes):
    """Validate + unpack one 36-byte flight frame. None = invalid. (The PDB
    variant routes through parse_pdb_frame — the header is the type tag.)"""
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


# ===========================================================================
# THE COMMAND CANON (16 bytes inbound — the ground station's return path):
#   [0]  CA FE   header (uint16 LE = 0xFECA)
#   [2]  cmd_id  uint8  (0x00 heartbeat · 0x01 arm · 0x02 EMERGENCY DISARM
#                        · 0x03 waypoint · 0x04 PID gains)
#   [3]  payload 9 bytes (layout per command — see firmware/zola_failsafe.h)
#   [12] crc16   uint16 over bytes [0..11]
#   [14] EF AC   footer (uint16 LE = 0xACEF)
# THE BRIDGE OWNS THE CRC: the panel sends a semantic command over the
# WebSocket; the bridge is the single builder that stamps the canon.
CMD_FRAME_SIZE = 16
CMD_HEADER = 0xFECA    # wire bytes CA FE (LE)
CMD_FOOTER = 0xACEF    # wire bytes EF AC (LE)
CMD_CRC_SPAN = 12

CMD_HEARTBEAT = 0x00
CMD_ARM = 0x01
CMD_EMERGENCY_DISARM = 0x02
CMD_SET_WAYPOINT = 0x03
CMD_UPDATE_PID = 0x04
ARM_TOKEN = 0xA5


def build_command_frame(cmd_id: int, payload: bytes) -> bytes:
    """Build one 16-byte command frame (the bridge's canon-stamping job)."""
    if len(payload) != 9:
        raise ValueError(f"a command payload is exactly 9 bytes, got {len(payload)}")
    frame = struct.pack("<HB9s", CMD_HEADER, cmd_id, payload[:9])[:12]
    frame += struct.pack("<HH", zola_crc(frame), CMD_FOOTER)
    return frame


def parse_command_frame(frame: bytes):
    """Validate + unpack one 16-byte command frame. None = invalid."""
    if len(frame) != CMD_FRAME_SIZE:
        return None
    header, cmd_id, payload, crc, footer = struct.unpack("<HB9sHH", frame)
    if header != CMD_HEADER or footer != CMD_FOOTER:
        return None
    if zola_crc(frame[:CMD_CRC_SPAN]) != crc:
        return None
    return {"cmd_id": cmd_id, "payload": payload}


# ---- THE OTA FRAME CANON (zota_ota.h's wire format, built bridge-side):
#   [0F 0D][phase 1][seq u16][total u32][offset u32][len u16][payload][crc16]
#   the prefix before the payload is 15 bytes; the CRC covers the prefix + payload
PHASE_START, PHASE_DATA, PHASE_COMMIT, PHASE_ABORT = 0, 1, 2, 3
OTA_CHUNK_MAX = 200   # the ESP-NOW relay's MTU bounds the chunk size
_OTA_SEQ = itertools.count()


def build_ota_frame(phase: int, payload: bytes, total: int = 0, offset: int = 0) -> bytes:
    head = struct.pack("<2sBHIIH", b"\x0f\x0d", phase, next(_OTA_SEQ) & 0xFFFF, total, offset, len(payload))
    return head + payload + struct.pack("<H", zola_crc(head + payload))


def parse_ack_frame(frame: bytes):
    """The ACK canon (14 bytes: 'OK' + cmd_id + result + ts + mode + crc + '!!')."""
    if len(frame) != 14 or frame[:2] != b"OK" or frame[12:14] != b"!!":
        return None
    crc = struct.unpack_from("<H", frame, 10)[0]
    if zola_crc(frame[:10]) != crc:
        return None
    cmd_id, result = frame[2], frame[3]
    ts = struct.unpack_from("<I", frame, 4)[0]
    return {"cmd_id": cmd_id, "result": result, "timestamp_ms": ts, "mode": frame[8]}


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
        self.dump_bytes = 0
        self.stats_interval = stats_interval

    async def broadcast_ack(self, ack: dict):
        """The command's confirmation — the panel stops guessing."""
        message = json.dumps({"type": "ZOLA_COMMAND_ACK", "panel_id": "hil_telemetry_03",
                              "payload": ack})
        dead = []
        for ws in self.clients:
            try:
                await asyncio.wait_for(ws.send(message), timeout=0.02)
            except (asyncio.TimeoutError, Exception):
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def broadcast_pdb(self, data: dict):
        """The PDB variant's envelope — power, thermal, eRPM, the sag state."""
        message = json.dumps({
            "type": "ZOLA_PDB_TELEMETRY",
            "panel_id": "hil_telemetry_03",
            "payload": data,
        })
        dead = []
        for ws in self.clients:
            try:
                await asyncio.wait_for(ws.send(message), timeout=0.02)
            except (asyncio.TimeoutError, Exception):
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

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
        self.ser = ser  # the command path writes here (same event loop — no race)
        print(f"[Zola Bridge] reading {port_name} @ {BAUD_RATE}", flush=True)
        buffer = bytearray()
        while True:
            await asyncio.sleep(0.001)
            n = ser.in_waiting
            if not n:
                continue
            buffer.extend(ser.read(n))
            # THE DEMUX: three framings share this stream — the ACK canon
            # ('OK'...'!!', 14 bytes), the blackbox dump's chunks (FD 0D), and
            # the flight/PDB frames. Each goes to its own consumer.
            while len(buffer) >= 14 and buffer[0] == 0x4F and buffer[1] == 0x4B:
                ack = parse_ack_frame(bytes(buffer[:14]))
                if ack:
                    del buffer[:14]
                    self.frames_ok += 1
                    await self.broadcast_ack(ack)
                else:
                    del buffer[:2]
            # the blackbox dump's chunks (FD 0D) land in the observability
            # lake (Saved/blackbox/); the dump is USB-only by design
            while len(buffer) >= 12 and buffer[0] == 0xFD and buffer[1] == 0x0D:
                seq, off, clen = struct.unpack_from("<HIH", buffer, 2)
                if len(buffer) < 12 + clen:
                    break  # the chunk is still arriving
                chunk = bytes(buffer[10:10 + clen])
                crc = struct.unpack_from("<H", buffer, 10 + clen)[0]
                if zola_crc(bytes(buffer[:10 + clen])) == crc:
                    os.makedirs("Saved/blackbox", exist_ok=True)
                    with open("Saved/blackbox/dump.bin", "r+b" if os.path.exists("Saved/blackbox/dump.bin") else "wb") as f:
                        f.seek(off); f.write(chunk)
                    del buffer[:12 + clen]
                    self.dump_bytes += clen
                else:
                    del buffer[:2]  # a bad dump chunk: resync
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
                # THE TYPE TAG: the flight canon (FA FB) vs the PDB variant (FB FC)
                if frame[0] == 0xFB and frame[1] == 0xFC:
                    data = parse_pdb_frame(frame)
                    if data:
                        del buffer[:PACKET_SIZE]
                        self.frames_ok += 1
                        await self.broadcast_pdb(data)
                        continue
                    del buffer[:2]
                    continue
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
            async for raw in websocket:  # inbound: commands + OTA chunks
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                mtype = msg.get("type")
                if mtype == "ZOLA_COMMAND":
                    frame = build_command_frame(int(msg["cmd_id"]), bytes.fromhex(msg.get("payload_hex", "")))
                    self.forward_command(frame)
                elif mtype == "ZOTA_BEGIN":
                    # the OTA session opens: the START frame carries the total
                    # size; the digest + signature ride the COMMIT frame
                    self._ota = {
                        "size": int(msg["size"]),
                        "sha": bytes.fromhex(msg["sha256_hex"]),
                        "sig": bytes.fromhex(msg["sig_hex"]),
                    }
                    self.forward_ota(build_ota_frame(PHASE_START, struct.pack("<I", self._ota["size"])))
                elif mtype == "ZOTA_CHUNK":
                    if not self._ota:
                        continue  # a chunk without a session is dropped
                    data = bytes.fromhex(msg["data_hex"])
                    head = struct.pack("<I", msg["offset"])
                    self.forward_ota(build_ota_frame(PHASE_DATA, head + data))
                elif mtype == "ZOTA_COMMIT":
                    if not self._ota:
                        continue
                    commit_payload = self._ota["sha"] + self._ota["sig"]
                    # the commit exceeds one 240-byte frame? digest+sig = 96/64 — fits
                    self.forward_ota(build_ota_frame(PHASE_COMMIT, commit_payload))
                    self._ota = None
                elif mtype == "ZOTA_ABORT":
                    self.forward_ota(build_ota_frame(PHASE_ABORT, b""))
                    self._ota = None
        finally:
            self.clients.discard(websocket)

    def forward_ota(self, frame: bytes):
        """The OTA chunk's transport (the serial write). Logged sparsely."""
        ser = getattr(self, "ser", None)
        if ser is not None:
            ser.write(frame)

    def forward_command(self, frame: bytes):
        """The transport's write side: the serial lane writes the frame to the
        FC's COM port. Logged — an operator's kill-switch deserves a paper
        trail."""
        _, cmd_id, payload, _, _ = struct.unpack("<HB9sHH", frame)
        ser = getattr(self, "ser", None)
        if ser is not None:
            ser.write(frame)
        print(f"[Zola Bridge] command forwarded: id=0x{cmd_id:02X} payload={payload.hex()}",
              flush=True)

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
