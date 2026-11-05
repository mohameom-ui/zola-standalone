#!/usr/bin/env python3
"""zola_udp_bridge.py — THE WIRELESS LANES' GROUND STATION (spec section 3, fixed).

Listens on UDP 8888 for the Zola flight controller's 36-byte packets (the
same canon as the serial lane — the FC broadcasts byte-identical frames on
both) and relays the DECODED telemetry into the panel over WebSocket
(ws://127.0.0.1:8003, the spec's port).

Fixes over the draft:
  * The draft forwarded only METADATA (source_ip, payload_size) — the panel
    would have received a size, not a flight. This bridge decodes with the
    SAME parse_frame/CRC routine the serial bridge uses (one canon, one
    parser) and forwards the full payload.
  * The draft bound one UDP socket PER websocket client — the second client
    would crash on the bind. ONE reader thread feeds an asyncio queue; the
    async side broadcasts to N clients.
  * Lost/corrupt datagrams are counted and reported — UDP loses packets by
    design; the sequence id exposes the gaps downstream.
  * --sim: a built-in fake-FC that SENDS spec-shaped datagrams, so the
    wireless lane is testable end-to-end before the FC exists.

Run:
  python bridge/zola_udp_bridge.py --sim    # fake FC + bridge, bench test
  python bridge/zola_udp_bridge.py          # real FC on the mesh
"""
import argparse
import asyncio
import os
import queue
import socket
import struct
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zola_bridge import Bridge, parse_frame, zola_crc  # the one canon, one parser

UDP_PORT = 8888
PACKET_SIZE = 36


def build_frame(seq, ts_us, roll, pitch, yaw, m1, m2, m3, m4, batt_mv):
    """The FC's packet builder (mirrors the firmware byte for byte) — used by
    --sim and by the test harness."""
    head = struct.pack("<HIIfffHHHHH", 0xFBFA, seq, ts_us, roll, pitch, yaw,
                       m1, m2, m3, m4, batt_mv)
    return head + struct.pack("<HH", zola_crc(head), 0xFDFC)


def udp_reader_thread(q: "queue.Queue", port: int, stop: threading.Event):
    """The ONE socket owner. Runs in a thread; pushes (data, addr) tuples
    into the asyncio queue via a thread-safe hand-off."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("0.0.0.0", port))
    except OSError as e:
        print(f"[Zola UDP Bridge] bind failed on :{port} — {e}", flush=True)
        return
    sock.settimeout(0.1)
    print(f"[Zola UDP Bridge] listening for flight telemetry on UDP :{port}...", flush=True)
    while not stop.is_set():
        try:
            data, addr = sock.recvfrom(PACKET_SIZE)
            q.put((data, addr[0]))
        except socket.timeout:
            continue
        except OSError:
            break
    sock.close()


class UdpBridge(Bridge):
    def __init__(self):
        super().__init__(source="udp", envelope_type="ZOLA_UDP_TELEMETRY")
        self.q: "queue.Queue" = queue.Queue()
        self.stop_event = threading.Event()

    async def udp_loop(self):
        threading.Thread(target=udp_reader_thread,
                         args=(self.q, UDP_PORT, self.stop_event), daemon=True).start()
        lost = 0
        last_seq = None
        while True:
            data, source_ip = await asyncio.get_event_loop().run_in_executor(
                None, self.q.get)
            if len(data) != PACKET_SIZE:
                self.frames_bad += 1
                continue
            decoded = parse_frame(data)
            if decoded is None:
                self.frames_bad += 1
                continue
            if last_seq is not None and decoded["sequence_id"] > last_seq + 1:
                lost += decoded["sequence_id"] - last_seq - 1  # UDP loses by design
            last_seq = decoded["sequence_id"]
            self.frames_ok += 1
            self.lost_datagrams = lost
            await self.broadcast(decoded, source_ip=source_ip)

    async def stats_loop(self):
        while True:
            await asyncio.sleep(self.stats_interval)
            print(f"[Zola UDP Bridge] {self.frames_ok / self.stats_interval:.0f} fps ok · "
                  f"{self.frames_bad} malformed · {getattr(self, 'lost_datagrams', 0)} lost · "
                  f"{len(self.clients)} client(s)", flush=True)
            self.frames_ok = 0
            self.frames_bad = 0


def fake_fc(stop: threading.Event, port: int, rate_hz: int = 100):
    """--sim's fake FC: spec-shaped datagrams, on the mesh at 100 Hz."""
    import math
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    seq = 0
    t0 = time.perf_counter()
    next_tick = t0 + 1.0 / rate_hz
    print(f"[Zola UDP Bridge] SIM fake-FC broadcasting 100 Hz to 127.0.0.1:{port}", flush=True)
    while not stop.is_set():
        now = time.perf_counter()
        if now < next_tick:
            time.sleep(min(0.002, next_tick - now))
            continue
        next_tick += 1.0 / rate_hz
        if next_tick < now - 0.05:
            next_tick = now + 1.0 / rate_hz
        t = now - t0
        seq += 1
        frame = build_frame(seq, int(t * 1_000_000),
                            5.0 * math.sin(t * 1.2), 4.0 * math.sin(t * 0.9), (t * 12.0) % 360.0,
                            1150, 1150, int(1148 + 6 * math.sin(t * 2.0)), 1152,
                            12450 - int(t * 2))
        sock.sendto(frame, ("127.0.0.1", port))
    sock.close()


async def main_loop(args):
    if websockets_missing():
        sys.exit("pip install websockets pyserial")
    bridge = UdpBridge()
    stop_event = bridge.stop_event
    if args.sim:
        threading.Thread(target=fake_fc, args=(stop_event, UDP_PORT), daemon=True).start()
    import websockets
    async with websockets.serve(bridge.handler, args.host, args.port):
        print(f"[Zola UDP Bridge] relaying to the panel on ws://{args.host}:{args.port}", flush=True)
        await asyncio.gather(bridge.udp_loop(), bridge.stats_loop())


def websockets_missing():
    try:
        import websockets  # noqa
        return False
    except ImportError:
        return True


def main():
    parser = argparse.ArgumentParser(description="Zola UDP (Wi-Fi) telemetry bridge")
    parser.add_argument("--sim", action="store_true", help="spawn a fake FC on localhost")
    parser.add_argument("--port", type=int, default=int(__import__("os").environ.get("ZOLA_WS_PORT", 8003)))
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    try:
        asyncio.run(main_loop(args))
    except KeyboardInterrupt:
        print("[Zola UDP Bridge] stopped", flush=True)


if __name__ == "__main__":
    main()
