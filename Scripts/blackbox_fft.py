#!/usr/bin/env python3
"""blackbox_fft.py — THE POST-FLIGHT SPECTRAL ANALYZER (spec section 1).

Reads a dumped Zola blackbox log (the ring's records: [type][36-byte
payload], events interleaved), extracts the gyro time series, runs the FFT
(numpy), identifies the MECHANICAL RESONANCE peaks, and proposes the
dynamic notch-filter frequencies — the classic tuning loop: fly, dump,
analyze, notch, repeat.

Usage:
    python Scripts/blackbox_fft.py <dumped_log.bin> [--top 4]
    python Scripts/blackbox_fft.py --demo      # a synthetic resonance test
"""
import argparse
import struct
import sys

import numpy as np

RECORD_BYTES = 37   # 1 type + 36 payload
REC_TELEMETRY = 0x01
REC_EVENT = 0x02

# the telemetry payload layout (the flight canon's body): seq(4) ts(4)
# roll/pitch/yaw (12) motors (8) batt (2) crc (2) footer (2)
GYRO_RATE_HZ = 100.0  # the blackbox logs at the control loop's 100 Hz


def load_records(path):
    """[(type, payload_bytes)] in log order."""
    raw = open(path, "rb").read()
    records = []
    for off in range(0, len(raw) - RECORD_BYTES + 1, RECORD_BYTES):
        records.append((raw[off], raw[off + 1: off + RECORD_BYTES]))
    return records


def extract_gyro_series(records):
    """The gyro channels aren't IN the 36-byte canon (the FC logs the euler
    + motors + battery) — the RATE series is DERIVED from the euler channels
    (the finite difference), which is what the FFT actually needs. Returns
    (t, roll_rate, pitch_rate, yaw_rate) and the event marks."""
    t, roll, pitch, yaw, marks = [], [], [], [], []
    t0 = None
    for i, (rtype, payload) in enumerate(records):
        if rtype == REC_TELEMETRY:
            ts = struct.unpack_from("<I", payload, 4)[0]
            r, p, y = struct.unpack_from("<fff", payload, 8)
            if t0 is None:
                t0 = ts
            t.append((ts - t0) / 1e6)
            roll.append(r); pitch.append(p); yaw.append(y)
        elif rtype == REC_EVENT:
            ms = struct.unpack_from("<I", payload, 1)[0]
            marks.append((ms / 1000.0, payload[0]))
    t = np.array(t)
    if len(t) < 10:
        return None, None, marks
    rate = 1.0 / np.median(np.diff(t)) if len(t) > 1 else GYRO_RATE_HZ
    return t, {
        "roll": np.gradient(np.array(roll), t),
        "pitch": np.gradient(np.array(pitch), t),
        "yaw": np.gradient(np.array(yaw), t),
    }, marks


def analyze(series, rate_hz, top=4):
    """The FFT + the resonance peaks per axis → the notch proposals."""
    out = {}
    for axis, sig in series.items():
        sig = sig - np.mean(sig)
        windowed = sig * np.hanning(len(sig))
        spectrum = np.abs(np.fft.rfft(windowed))
        freqs = np.fft.rfftfreq(len(sig), 1.0 / rate_hz)
        # the peaks: the top-N local maxima above 5 Hz (below that is the
        # controller's own work, not mechanics)
        mask = freqs > 5.0
        idx = np.argsort(spectrum[mask])[::-1][:top]
        peaks = [(float(freqs[mask][i]), float(spectrum[mask][i])) for i in idx]
        out[axis] = peaks
    return out


def report(peaks, marks):
    print("=== the resonance report ===")
    for axis, plist in peaks.items():
        line = ", ".join(f"{f:.1f} Hz" for f, amp in plist[:3])
        print(f"  {axis:5s}: dominant peaks at {line}")
    print("  proposed dynamic notches (the top peaks, deduped, ±3 Hz windows):")
    seen = []
    for plist in peaks.values():
        for f, amp in plist:
            if 8.0 < f < 400.0 and all(abs(f - s) > 3.0 for s in seen):
                seen.append(f)
    for f in sorted(seen)[:4]:
        print(f"    notch at {f:.1f} Hz (window ±3 Hz)")
    if marks:
        print(f"  event marks in this log: {len(marks)} (the FFT windows can be "
              f"cut around them)")


def demo():
    """A synthetic log with a KNOWN resonance at 137 Hz — the analyzer must
    find exactly that (the test of the tool, not of a flight)."""
    import io
    dt = 1.0 / 100.0
    t = np.arange(0, 4.0, dt)
    # a roll signal: smooth control work + a 31 Hz mechanical resonance.
    # THE NYQUIST BOUNDARY (honest, documented): the blackbox logs at the
    # control loop's 100 Hz — the analyzable band ends at 50 Hz; a 137 Hz
    # resonance ALIASES (to 37 Hz) and is invisible here. Resonances above
    # 50 Hz need a faster log rate (the bench's high-speed logger).
    roll = 2.0 * np.sin(2 * np.pi * 1.5 * t) + 0.6 * np.sin(2 * np.pi * 31.0 * t)
    buf = io.BytesIO()
    for i in range(len(t)):
        payload = struct.pack("<IIfffHHHHHHH", i + 1, int(t[i] * 1e6),
                              roll[i], 0.0, 0.0, 1150, 1150, 1148, 1152, 12450, 0, 0xFDFC)[:36]
        buf.write(bytes([REC_TELEMETRY]) + payload[:36].ljust(36, b"\0"))
    open("Saved/blackbox-demo.bin", "wb").write(buf.getvalue())
    records = load_records("Saved/blackbox-demo.bin")
    t_arr, series, marks = extract_gyro_series(records)
    peaks = analyze(series, 100.0)
    top_roll = [f for f, _ in peaks["roll"][:2]]
    found = any(abs(f - 31.0) < 3.0 for f in top_roll)
    print(f"demo: the roll axis's top peaks: {[f'{f:.1f}' for f, _ in peaks['roll'][:3]]}")
    if not found:
        print("BLACKBOX-FFT FAIL: the 31 Hz resonance was not found")
        sys.exit(1)
    print("BLACKBOX-FFT PASS — the 31 Hz synthetic resonance was found (the Nyquist ceiling is 50 Hz at this log rate)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("log", nargs="?", help="the dumped blackbox log")
    parser.add_argument("--top", type=int, default=4)
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()
    if args.demo:
        demo()
        return
    if not args.log:
        sys.exit("usage: blackbox_fft.py <log> | --demo")
    records = load_records(args.log)
    t, series, marks = extract_gyro_series(records)
    if series is None:
        sys.exit("the log has too few telemetry records to analyze")
    peaks = analyze(series, 100.0, args.top)
    report(peaks, marks)


if __name__ == "__main__":
    main()
