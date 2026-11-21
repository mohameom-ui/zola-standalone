#!/usr/bin/env python3
"""ZOLA rangefinder readers — TF-Luna and LD06/LD19.

The relay owns the serial port, because it already owns the hardware side of
her body. Readings are parsed here and broadcast to the browser as JSON, where
`RangeSource`/`fuseRange` put them in the spatial map as measured evidence.

Standalone bench mode (no relay, no app):

    python3 range_sensor.py --port /dev/serial0 --sensor tf-luna
    python3 range_sensor.py --port /dev/ttyUSB0 --sensor ld06 --baud 230400

It prints one JSON object per line, which is also the format the relay sends.
"""

from __future__ import annotations

import argparse
import json
import math
import threading
import time

# TF-Luna sends distance in centimetres; LD06 in millimetres.
TF_LUNA_MAX_M = 8.0
LD06_MAX_M = 12.0


def _u16(lo: int, hi: int) -> int:
    return lo | (hi << 8)


def _normalise(rad: float) -> float:
    """Fold an angle into -pi..pi."""
    while rad > math.pi:
        rad -= 2 * math.pi
    while rad < -math.pi:
        rad += 2 * math.pi
    return rad


class TfLunaParser:
    """9-byte frames: 0x59 0x59 dist_lo dist_hi amp_lo amp_hi temp_lo temp_hi sum."""

    def __init__(self) -> None:
        self.buf = bytearray()

    def push(self, chunk: bytes, now: float | None = None) -> list[dict]:
        self.buf.extend(chunk)
        out: list[dict] = []
        while True:
            start = self.buf.find(b"\x59\x59")
            if start < 0:
                # keep the last byte: it may be half of a header
                del self.buf[:-1]
                break
            if start:
                del self.buf[:start]
            if len(self.buf) < 9:
                break
            frame = self.buf[:9]
            if (sum(frame[:8]) & 0xFF) != frame[8]:
                del self.buf[:1]  # resync
                continue
            cm = _u16(frame[2], frame[3])
            del self.buf[:9]
            if 0 < cm <= TF_LUNA_MAX_M * 100:
                out.append({"distance": cm / 100.0, "bearing": 0.0, "at": now if now is not None else time.time() * 1000.0})
        return out


def ld06_crc8(data: bytes, length: int) -> int:
    """CRC-8 used by LD06/LD19: polynomial 0x4D, init 0x00."""
    crc = 0
    for i in range(length):
        crc ^= data[i]
        for _ in range(8):
            crc = ((crc << 1) ^ 0x4D) & 0xFF if crc & 0x80 else (crc << 1) & 0xFF
    return crc


class Ld06Parser:
    """47-byte packets: 0x54 0x2C, 12 points, angles in 0.01 degrees, CRC8."""

    PACKET = 47

    def __init__(self) -> None:
        self.buf = bytearray()

    def push(self, chunk: bytes, now: float | None = None) -> list[dict]:
        self.buf.extend(chunk)
        out: list[dict] = []
        while True:
            start = self.buf.find(b"\x54\x2c")
            if start < 0:
                del self.buf[:-1]
                break
            if start:
                del self.buf[:start]
            if len(self.buf) < self.PACKET:
                break
            frame = self.buf[: self.PACKET]
            if ld06_crc8(frame, self.PACKET - 1) != frame[-1]:
                del self.buf[:1]
                continue

            # layout: 6..41 = 12 points, 42..43 end angle, 44..45 stamp, 46 CRC
            start_deg = _u16(frame[4], frame[5]) / 100.0
            end_deg = _u16(frame[42], frame[43]) / 100.0
            if end_deg < start_deg:
                end_deg += 360.0  # packet crosses north

            stamp = now if now is not None else time.time() * 1000.0
            span = end_deg - start_deg
            for i in range(12):
                base = 6 + i * 3
                mm = _u16(frame[base], frame[base + 1])
                if mm == 0:
                    continue  # no return
                if mm > LD06_MAX_M * 1000:
                    continue
                deg = start_deg + span * i / 11.0
                out.append({
                    "distance": mm / 1000.0,
                    "bearing": _normalise(math.radians(deg)),
                    "at": stamp,
                })
            del self.buf[: self.PACKET]
        return out


def make_parser(sensor: str):
    if sensor == "tf-luna":
        return TfLunaParser()
    if sensor == "ld06":
        return Ld06Parser()
    raise ValueError(f"unknown sensor {sensor!r} (expected tf-luna or ld06)")


class RangeReader(threading.Thread):
    """Reads one serial port and keeps the latest parsed points."""

    def __init__(self, port: str, sensor: str, baud: int = 115200) -> None:
        super().__init__(daemon=True, name="range-reader")
        self.port = port
        self.sensor = sensor
        self.baud = baud
        self._points: list[dict] = []
        self._at = 0.0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self.error: str | None = None

    def latest(self, max_age: float = 0.5) -> tuple[list[dict], float] | None:
        """Newest points, or None once they are older than max_age seconds."""
        with self._lock:
            if not self._points or time.time() * 1000.0 - self._at > max_age * 1000.0:
                return None
            return list(self._points), self._at

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        try:
            import serial  # pyserial — optional dependency, only needed here
        except ImportError:
            self.error = "pyserial is not installed (pip install pyserial)"
            print(f"[range] {self.error}")
            return

        parser = make_parser(self.sensor)
        try:
            with serial.Serial(self.port, self.baud, timeout=0.5) as port:
                print(f"[range] {self.sensor} reading {self.port} at {self.baud} baud")
                while not self._stop.is_set():
                    chunk = port.read(64)
                    if not chunk:
                        continue
                    points = parser.push(chunk)
                    if points:
                        with self._lock:
                            self._points = points
                            self._at = points[-1]["at"]
        except Exception as exc:  # serial errors must not kill the relay
            self.error = str(exc)
            print(f"[range] stopped: {exc}")


def main() -> int:
    ap = argparse.ArgumentParser(description="ZOLA rangefinder bench reader")
    ap.add_argument("--port", required=True, help="serial port, e.g. /dev/serial0 or COM5")
    ap.add_argument("--sensor", required=True, choices=["tf-luna", "ld06"])
    ap.add_argument("--baud", type=int, default=115200)
    args = ap.parse_args()

    reader = RangeReader(args.port, args.sensor, args.baud)
    reader.start()
    try:
        while True:
            latest = reader.latest()
            if latest:
                points, at = latest
                print(json.dumps({"t": "range", "sensor": args.sensor, "points": points, "at": at}), flush=True)
            if reader.error:
                return 1
            time.sleep(0.1)
    except KeyboardInterrupt:
        return 0
    finally:
        reader.stop()


if __name__ == "__main__":
    raise SystemExit(main())
