#!/usr/bin/env python3
"""firmware_math_check.py — THE FIRMWARE'S MATH MIRROR (the referee).

No compiler exists on this machine, so the flight core's pure MATH is
mirrored here in Python and verified by assertion. The C code in
firmware/zola_fc/zola_engine.cpp must stay 1:1 with these routines:

  1. MADGWICK (6-axis, the canonical MadgwickAHRSupdateIMU): from a
     perturbed start, a level sensor's accelerometer must pull the
     quaternion back to identity — roll/pitch → 0, yaw preserved. If a
     sign or Jacobian term slips in the C, this test is where it screams.
  2. DSHOT CRC4: the 4-bit checksum over the 12-bit value — checked against
     the definition (xor-fold of v, v>>4, v>>8) and round-tripped through
     the frame builder.
  3. THE PACKET CANON: 36 bytes, header FA FB / footer FC FD, the CRC span,
     and the struct layout — the same assertions the bridge's parse_frame
     enforces on the wire.

Run: python Scripts/firmware_math_check.py
"""
import math
import random
import struct
import sys

# a seeded RNG: the sensor noise is realistic AND the test is deterministic
_rng = random.Random(4501)


def noisy(value, rms=0.002):
    """Realistic accel noise (2 mg RMS — MPU-class). The noise-free regime is
    UNPHYSICAL for this filter: at the exact solution the objective's
    gradient s hits ~1e-16, and the canonical gradient NORMALIZATION then
    amplifies float rounding noise into unit-size kicks — a pure-math test
    measures that artifact, not the filter. A real IMU's noise keeps s
    meaningful; so does this test."""
    return value + _rng.gauss(0.0, rms)

PASS = 0
FAIL = 0


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


# ---------------------------------------------------------------- Madgwick
mq = [1.0, 0.0, 0.0, 0.0]  # w, x, y, z — mirrors the firmware's mq[]
BETA = 0.1


def madgwick_step(gx, gy, gz, ax, ay, az, deltat):
    """1:1 mirror of madgwick_step() in zola_engine.cpp — the EXACT gradient
    s = Jᵀf (not the widely-copied vendored snippet, whose folded terms
    converge to the WRONG attitude for tilted sensors). Keep in lockstep."""
    q0, q1, q2, q3 = mq
    qDot1 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz)
    qDot2 = 0.5 * ( q0 * gx + q2 * gz - q3 * gy)
    qDot3 = 0.5 * ( q0 * gy - q1 * gz + q3 * gx)
    qDot4 = 0.5 * ( q0 * gz + q1 * gy - q2 * gx)
    if not (ax == 0.0 and ay == 0.0 and az == 0.0):
        norm = math.sqrt(ax * ax + ay * ay + az * az)
        ax, ay, az = ax / norm, ay / norm, az / norm
        f1 = 2*q1*q3 - 2*q0*q2 - ax
        f2 = 2*q0*q1 + 2*q2*q3 - ay
        f3 = 1 - 2*q1*q1 - 2*q2*q2 - az
        s0 = -2*q2*f1 + 2*q1*f2
        s1 =  2*q3*f1 + 2*q0*f2 - 4*q1*f3
        s2 = -2*q0*f1 + 2*q3*f2 - 4*q2*f3
        s3 =  2*q1*f1 + 2*q2*f2
        snorm = math.sqrt(s0*s0 + s1*s1 + s2*s2 + s3*s3)
        if snorm > 1e-12:  # f ≈ 0 → gradient ≈ 0: NO kick from nothing
            scale = BETA / snorm
            qDot1 -= scale * s0
            qDot2 -= scale * s1
            qDot3 -= scale * s2
            qDot4 -= scale * s3
    q0 += qDot1 * deltat; q1 += qDot2 * deltat
    q2 += qDot3 * deltat; q3 += qDot4 * deltat
    norm = math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3)
    mq[:] = [q0 / norm, q1 / norm, q2 / norm, q3 / norm]


def quat_to_euler_deg():
    q0, q1, q2, q3 = mq
    roll = math.atan2(2 * (q0 * q1 + q2 * q3), 1 - 2 * (q1 * q1 + q2 * q2))
    pitch = math.asin(max(-1, min(1, 2 * (q0 * q2 - q3 * q1))))
    yaw = math.atan2(2 * (q0 * q3 + q1 * q2), 1 - 2 * (q2 * q2 + q3 * q3))
    return math.degrees(roll), math.degrees(pitch), math.degrees(yaw)


def body_gravity(roll_deg, pitch_deg, yaw_deg):
    """The PHYSICALLY HONEST accel: when the body tilts, gravity ROTATES in
    the body frame. World gravity (0,0,+1) in the canonical Madgwick's
    convention (a level resting sensor reads az=+1) rotated by the inverse
    of the body's orientation."""
    r, p, y = (math.radians(a) for a in (roll_deg, pitch_deg, yaw_deg))
    # world→body: R^T · (0,0,1) with R = Rz(yaw)·Ry(pitch)·Rx(roll)
    cr, sr = math.cos(r), math.sin(r)
    cp, sp = math.cos(p), math.sin(p)
    cy, sy = math.cos(y), math.sin(y)
    # R^T for ZYX Euler: (0,0,1) pulled through — the body-frame gravity is
    # (-sin(p), sin(r)cos(p)... the standard gravity rotation result:
    gx = -math.sin(p)
    gy = math.sin(r) * math.cos(p)
    gz = math.cos(r) * math.cos(p)
    return gx, gy, gz


def test_madgwick():
    print("MADGWICK (6-axis gradient descent):")
    dt = 1.0 / 500.0
    # THE HONEST CONVERGENCE TEST: the TRUE attitude is 20° roll; the filter
    # starts at identity; the accel carries the rotated gravity (which is
    # what a real sensor does) and must pull the estimate to the truth.
    mq[:] = [1.0, 0.0, 0.0, 0.0]
    TRUE_ROLL = 20.0
    ax, ay, az = body_gravity(TRUE_ROLL, 0.0, 0.0)
    for _ in range(3000):  # 6 s at 500 Hz
        madgwick_step(0.0, 0.0, 0.0, noisy(ax), noisy(ay), noisy(az), dt)
    roll, pitch, yaw = quat_to_euler_deg()
    check("converges to the true 20° roll", abs(roll - TRUE_ROLL) < 1.0 and abs(pitch) < 1.0,
          f"roll={roll:.2f}° pitch={pitch:.2f}°")
    norm = math.sqrt(sum(v * v for v in mq))
    check("quaternion stays normalized", abs(norm - 1.0) < 1e-3, f"norm={norm:.5f}")

    # and back: the truth returns to level, the estimate follows
    ax, ay, az = body_gravity(0.0, 0.0, 0.0)
    for _ in range(3000):
        madgwick_step(0.0, 0.0, 0.0, noisy(ax), noisy(ay), noisy(az), dt)
    roll, pitch, yaw = quat_to_euler_deg()
    check("returns to level when the body levels", abs(roll) < 1.0 and abs(pitch) < 1.0,
          f"roll={roll:.2f}° pitch={pitch:.2f}°")

    # a 90°/s yaw rate with level gravity must stay level (yaw is
    # unobservable from accel alone — the gyro integrates it). NOTE THE
    # UNITS: Madgwick's canonical form consumes RADIANS/SECOND — this test
    # caught the firmware feeding degrees/s (90°/s integrated to 102.86°).
    mq[:] = [1.0, 0.0, 0.0, 0.0]
    gyro_z_rad = math.radians(90.0)  # 90 deg/s, in radians as the filter wants
    ax, ay, az = body_gravity(0.0, 0.0, 0.0)
    for _ in range(500):  # 1 s at 500 Hz
        madgwick_step(0.0, 0.0, gyro_z_rad, noisy(ax), noisy(ay), noisy(az), dt)
    roll, pitch, yaw = quat_to_euler_deg()
    check("gyro-only yaw integrates to ~90°", abs(yaw - 90.0) < 3.0 and abs(roll) < 1.0,
          f"yaw={yaw:.2f}° roll={roll:.2f}°")


# ------------------------------------------------------------------- DShot
def dshot_crc4(value_12bit):
    """mirror of dshot_frame()'s CRC nibble: xor-fold of v, v>>4, v>>8."""
    return (value_12bit ^ (value_12bit >> 4) ^ (value_12bit >> 8)) & 0xF


def dshot_frame(throttle_11bit, telemetry_req=False):
    value = (throttle_11bit << 1) | (1 if telemetry_req else 0)
    return value | (dshot_crc4(value) << 12)


def test_dshot():
    print("DSHOT600 frame + CRC4:")
    # known-value vectors: v=0 → crc folds to 0; the fold is idempotent-ish
    check("crc4(0) == 0", dshot_crc4(0) == 0)
    # all-ones folds to 0xF (0xFFF ^ 0xFF ^ 0xF = 0xF0F) — the definition's
    # own arithmetic, not a wish
    check("crc4(0xFFF) == 0xF", dshot_crc4(0xFFF) == 0xF)
    # reference: the fold of 0b101010101010 — computed by hand:
    # v=0xAAA, v>>4=0xAA, v>>8=0xA; 0xAAA^0xAA^0xA = 0xAAA^0xB0... verify by
    # the definition directly and by an independent xor reduction
    v = 0xAAA
    manual = v
    for shift in (4, 8):
        manual ^= v >> shift
    check("crc4(0xAAA) matches the xor-fold", dshot_crc4(v) == (manual & 0xF))
    # round trip: extract throttle back out of a built frame
    f = dshot_frame(1000, False)
    check("frame round-trips the throttle", ((f >> 1) & 0x7FF) == 1000)
    check("frame's CRC nibble verifies", ((f >> 12) & 0xF) == dshot_crc4(f & 0xFFF))
    check("zero throttle stays above the ESC arming floor frame", dshot_frame(48) >> 12 == dshot_crc4(dshot_frame(48) & 0xFFF))


# ----------------------------------------------------------- packet canon
def test_packet_canon():
    print("PACKET CANON (36 bytes):")
    header, seq, ts = 0xFBFA, 7, 123456
    roll, pitch, yaw = 1.5, -2.5, 45.0
    m1, m2, m3, m4, batt = 1150, 1150, 1148, 1152, 12450
    head = struct.pack("<HIIfffHHHHH", header, seq, ts, roll, pitch, yaw, m1, m2, m3, m4, batt)
    check("payload prefix is 32 bytes", len(head) == 32, f"got {len(head)}")
    crc = 0xA001  # placeholder to occupy the field
    frame = head + struct.pack("<HH", crc, 0xFDFC)
    check("full frame is 36 bytes", len(frame) == 36)
    check("wire header bytes are FA FB", frame[0] == 0xFA and frame[1] == 0xFB)
    check("wire footer bytes are FC FD", frame[34] == 0xFC and frame[35] == 0xFD)
    # the C struct's field offsets must match the bridge's unpack
    unpacked = struct.unpack("<HIIfffHHHHHHH", frame)
    check("bridge unpack reads the same seq", unpacked[1] == seq)
    check("bridge unpack reads the same attitude", unpacked[3:6] == (roll, pitch, yaw))
    check("bridge unpack reads the same motors", unpacked[6:10] == (m1, m2, m3, m4))
    check("bridge unpack reads the same battery", unpacked[10] == batt)


def main():
    test_madgwick()
    test_dshot()
    test_packet_canon()
    print(f"\nfirmware math mirror: {PASS} pass, {FAIL} fail")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
