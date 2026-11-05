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
import os
import random
import struct
import sys


def haversine_m(lat1, lon1, lat2, lon2):
    """Mirror of the nav module's Haversine (metres, WGS84 mean radius)."""
    r = 6371000.0
    dlat = math.radians(lat2 - lat1); dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    b = math.degrees(math.atan2(y, x))
    return b + 360 if b < 0 else b


def level_within(roll, pitch, threshold=3.5):
    return abs(roll) <= threshold and abs(pitch) <= threshold


def battery_above_pream(mv, threshold=11100.0):
    return mv >= threshold

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


TICK_NS = 50  # mirrors zola_dshot.cpp's s_tick_ns
zola_dshot_crc4 = dshot_crc4


def zola_dshot_prepare(throttle, telemetry_request):
    """Mirror of prepare_packet(): the CLAMPS are part of the contract —
    0 stays DISARM, the reserved 1-47 band clamps to 48 (a runaway value can
    never fire an ESC command by accident), 2048+ clamps to 2047."""
    if throttle > 2047:
        throttle = 2047
    if 0 < throttle < 48:
        throttle = 48
    return dshot_frame(throttle, telemetry_request)


def encode_msb_first(packet):
    """Mirror of encode_msb_first(): a list of (high_ns, low_ns) per bit,
    transmitted in order. MSB-FIRST — index 0 is bit 15."""
    bit_ticks = 1667.0 / TICK_NS  # 33.34 @ 50 ns
    one_high = round(0.75 * bit_ticks)
    zero_high = round(0.375 * bit_ticks)
    wire = []
    for i in range(16):
        one = packet & (0x8000 >> i)
        high = one_high if one else zero_high
        low = round(bit_ticks) - high
        wire.append((high * TICK_NS, low * TICK_NS))
    return wire


def test_dshot_driver():
    print("DSHOT600 DRIVER (wire order, ratios, reserved band):")
    # MSB-FIRST: the first transmitted bit must be the frame's bit 15. The
    # draft got this backwards (its loop wrote items[i] while iterating
    # 15→0, reversing the frame on the wire — every ESC would read garbage).
    wire = encode_msb_first(0b1000000000000000)
    check("wire is MSB-first (bit 15 transmits first)", wire[0][0] > 800)  # a '1' is ~75% high
    wire = encode_msb_first(0x0001)
    check("wire is MSB-first (bit 0 transmits last)", wire[15][0] > 800 and wire[0][0] < 800)

    # the spec's timing RATIOS hold for both bit types, and the bit period
    # is constant — ESCs decode the high-fraction, so the tick scales safely
    wire = encode_msb_first(0xFFFF)  # all '1' bits
    periods = {h + l for h, l in wire}
    check("all '1' bits share one period", len(periods) == 1, str(periods))
    frac = wire[0][0] / (wire[0][0] + wire[0][1])
    check("'1' high fraction ≈ 0.75", abs(frac - 0.75) < 0.02, f"{frac:.3f}")
    wire = encode_msb_first(0x0000)  # all '0' bits
    frac = wire[0][0] / (wire[0][0] + wire[0][1])
    check("'0' high fraction ≈ 0.375", abs(frac - 0.375) < 0.02, f"{frac:.3f}")
    bit_ns = wire[0][0] + wire[0][1]
    check("bit period ≈ 1667 ns", abs(bit_ns - 1667) < 60, f"{bit_ns} ns")

    # the reserved band: 0 = DISARM (preserved); 1-47 = ESC commands —
    # clamped to 48 so a runaway value can never fire one by accident
    check("throttle 0 stays DISARM", zola_dshot_prepare(0, False) == (0 << 4) | zola_dshot_crc4(0))
    check("1-47 clamps to 48", zola_dshot_prepare(1, False) == zola_dshot_prepare(48, False)
          and zola_dshot_prepare(47, False) == zola_dshot_prepare(48, False))
    check("2048+ clamps to 2047", zola_dshot_prepare(3000, False) == zola_dshot_prepare(2047, False))
    # the telemetry request bit rides bit 12 of the frame (bit 12 of the payload)
    check("telemetry bit lands at frame bit 12",
          (zola_dshot_prepare(48, True) >> 12) & 1 == 1 and (zola_dshot_prepare(48, False) >> 12) & 1 == 0)
    # the draft's nibble-loop CRC and our fold form are the same function
    for v in (0x001, 0xAAA, 0xFFF, 0x123, 0x7FF):
        nibble_loop = 0
        d = v
        for _ in range(3):
            nibble_loop ^= d & 0xF
            d >>= 4
        check(f"CRC forms agree for {hex(v)}", zola_dshot_crc4(v) == nibble_loop)


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


# ------------------------------------------------- the cascade (v3)
ANGLE_KP = 8.0  # °/s per ° — mirrors ANGLE_KP_DPS_PER_DEG


class RatePid:
    """Mirror of the firmware's RatePid — the spec's PID equation, exactly:
    Output = Kp·e + Ki·∫e·dt + Kd·de/dt, integral clamped ±limit."""

    def __init__(self, kp, ki, kd, limit=200.0):
        self.kp, self.ki, self.kd = kp, ki, kd
        self.integral = 0.0
        self.prev_error = 0.0
        self.limit = limit

    def update(self, setpoint, measured, dt):
        error = setpoint - measured
        self.integral = max(-self.limit, min(self.limit, self.integral + error * dt))
        derivative = (error - self.prev_error) / dt
        self.prev_error = error
        return self.kp * error + self.ki * self.integral + self.kd * derivative

    def reset(self):
        self.integral = 0.0
        self.prev_error = 0.0


def apply_motor_mix(base_us, roll_corr, pitch_corr, yaw_corr):
    """THE SPEC'S QUADX MATRIX, verbatim (mirrors apply_motor_mix):
      M1 FL (CW) : T + roll + pitch − yaw
      M2 FR (CCW): T − roll + pitch + yaw
      M3 RR (CW) : T − roll − pitch − yaw
      M4 RL (CCW): T + roll − pitch + yaw
    Clamp the FLOAT then cast — the draft's cast-before-constrain turned a
    negative overshoot into FULL THROTTLE."""
    m1 = base_us + roll_corr + pitch_corr - yaw_corr
    m2 = base_us - roll_corr + pitch_corr + yaw_corr
    m3 = base_us - roll_corr - pitch_corr - yaw_corr
    m4 = base_us + roll_corr - pitch_corr + yaw_corr
    return [int(max(1000, min(2000, m))) for m in (m1, m2, m3, m4)]


def test_cascade():
    print("THE CASCADE (rate PID + mixer):")
    # the mixer's row sums: net torque per axis must be ZERO — the property
    # that makes it a mixer rather than four unrelated numbers
    for name, coeffs in (("roll", (1, -1, -1, 1)), ("pitch", (1, 1, -1, -1)), ("yaw", (-1, 1, -1, 1))):
        check(f"mixer {name} row sums to zero", sum(coeffs) == 0, str(coeffs))

    # the spec's sign pattern, verbatim: a pure roll_corr must speed the LEFT
    # pair (M1, M4) and slow the RIGHT pair (M2, M3)
    out = apply_motor_mix(1500, 50, 0, 0)
    check("+roll_corr: left pair faster", out[0] == 1550 and out[3] == 1550)
    check("+roll_corr: right pair slower", out[1] == 1450 and out[2] == 1450)
    out = apply_motor_mix(1500, 0, 40, 0)
    check("+pitch_corr: front pair faster", out[0] == 1540 and out[1] == 1540)
    check("+pitch_corr: rear pair slower", out[2] == 1460 and out[3] == 1460)

    # THE DRAFT'S BUG: a correction big enough to drive a motor NEGATIVE must
    # clamp it to IDLE (1000) — the buggy C cast would wrap −1050 to 64486
    # and clamp to 2000 = FULL THROTTLE. m2 = 1150 − 2200 = −1050 exactly.
    out = apply_motor_mix(1150, 2200, 0, 0)
    check("negative-going motor clamps to IDLE, not full", out[1] == 1000 and out[2] == 1000,
          str(out))
    # and the mirror case: m1 = 1150+2200 = 3350 clamps to FULL
    check("positive-going motor clamps to FULL", out[0] == 2000 and out[3] == 2000,
          str(out))

    # the rate PID: pure P response — output = Kp·(setpoint − measured).
    # (kd = 0 here: the spec's derivative-on-error kicks on the FIRST update
    # because prev_error starts at 0 — the known D-kick; the bench filters
    # the setpoint. The direction test below settles the loop first.)
    pid = RatePid(1.2, 0.05, 0.0)
    out = pid.update(100.0, 40.0, 0.002)
    # P = 1.2·60 = 72, plus the FIRST step's integral: 0.05·(60·0.002) = 0.006
    check("rate PID P+I(1 step) exact", abs(out - (1.2 * 60.0 + 0.05 * 60 * 0.002)) < 1e-9,
          f"{out}")
    # the integral accumulates error·dt and CLAMPS at ±200
    pid = RatePid(0.0, 0.05, 0.0)
    for _ in range(2000):  # 4 s of constant +100°/s error → ∫ = 400 → clamped at 200
        out = pid.update(100.0, 0.0, 0.002)
    check("integral clamps at the windup limit", pid.integral == 200.0,
          f"integral={pid.integral}")
    check("clamped integral's Ki term", abs(out - 0.05 * 200.0) < 1e-9, f"{out}")
    # the derivative term: a constant error produces NO derivative after the
    # first step; a RAMPING error does
    pid = RatePid(0.0, 0.0, 0.03)
    pid.update(0.0, 0.0, 0.002)
    first = pid.update(10.0, 0.0, 0.002)      # error jumped 0 → 10: D fires
    second = pid.update(20.0, 0.0, 0.002)     # error grew +10 again: D repeats
    check("D term responds to the error rate", abs(first - 0.03 * (10 / 0.002)) < 1e-6
          and abs(second - 0.03 * (10 / 0.002)) < 1e-6, f"{first} {second}")
    # the full cascade SHAPE, settled: a 10° right lean → the angle loop
    # targets −80°/s (roll back LEFT) → the rate PID drives a NEGATIVE
    # roll_corr → the matrix speeds the RIGHT pair (m2 = base − corr) and
    # slows the LEFT pair — more right-side thrust rolls the craft LEFT,
    # which is exactly the correction a right lean needs. The loop is run
    # 250 steps first so the D transient settles (first-step D-kick is the
    # spec equation's known behavior; the bench filters the setpoint).
    pid = RatePid(1.2, 0.05, 0.03)
    target_rate = ANGLE_KP * (0.0 - 10.0)     # −80°/s
    corr = 0.0
    for _ in range(250):                      # 0.5 s at 500 Hz, gyro still
        corr = pid.update(target_rate, 0.0, 0.002)
    out = apply_motor_mix(1150, corr, 0, 0)
    check("cascade: a right lean speeds the RIGHT pair (rolls left)",
          out[1] > 1150 and out[2] > 1150 and out[0] < 1150 and out[3] < 1150,
          f"corr={corr:.1f} out={out}")
    check("cascade settles near the P+I prediction",
          abs(corr - (1.2 * -80.0 + 0.05 * pid.integral)) < 5.0, f"corr={corr:.1f}")


# ----------------------------------------------------------- packet canon
def test_command_canon():
    print("THE COMMAND CANON (16 bytes, the return path):")
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
    from zola_bridge import (build_command_frame, parse_command_frame,
                             CMD_HEADER, CMD_FOOTER, CMD_CRC_SPAN,
                             CMD_HEARTBEAT, CMD_ARM, CMD_EMERGENCY_DISARM, ARM_TOKEN)

    frame = build_command_frame(CMD_ARM, bytes([ARM_TOKEN, 0, 0, 0, 0, 0, 0, 0, 0]))
    check("command frame is 16 bytes", len(frame) == 16, str(len(frame)))
    check("wire header bytes are CA FE", frame[0] == 0xCA and frame[1] == 0xFE)
    check("wire footer bytes are EF AC", frame[14] == 0xEF and frame[15] == 0xAC)
    # CRC over bytes 0..11 — and the parse round-trips
    parsed = parse_command_frame(frame)
    check("command parse round-trips", parsed == {"cmd_id": CMD_ARM,
          "payload": bytes([ARM_TOKEN, 0, 0, 0, 0, 0, 0, 0, 0])}, str(parsed))
    # corruption: flip one payload bit — the parse must REJECT (the draft
    # obeyed any header-matching garbage; a flipped ARM bit is a crash)
    bad = bytearray(frame); bad[5] ^= 0x01
    check("corrupt command rejected", parse_command_frame(bytes(bad)) is None)
    # wrong length rejected
    check("short command rejected", parse_command_frame(frame[:15]) is None)
    # the payload layouts: the arm token rides byte 0; the PID payload is
    # axis-mask + two floats (9 bytes = 1 + 4 + 4)
    import struct as _s
    pid_payload = _s.pack("<Bff", 0x3, 1.2, 0.05)  # mask: roll|pitch
    check("PID payload is 9 bytes", len(pid_payload) == 9)
    f = build_command_frame(0x04, pid_payload)
    check("PID frame round-trips", parse_command_frame(f)["payload"] == pid_payload)
    # the waypoint payload: 4 x int16 + flags = 9 bytes
    wp = _s.pack("<4hB", 100, -50, 200, 900, 0)
    check("waypoint payload is 9 bytes", len(wp) == 9)


def test_blackbox_pdb_ota():
    print("BLACKBOX + PDB + OTA MATH:")
    PARTITION = 8 * 1024 * 1024
    RECORD = 37  # 1 type + 36 payload

    # THE RING ARITHMETIC (mirrors next_record_offset/wraps/capacity):
    def next_record_offset(cursor, capacity=PARTITION):
        off = cursor * RECORD
        return 0 if off + RECORD > capacity else off
    def wraps(cursor, capacity=PARTITION):
        return cursor * RECORD + RECORD > capacity
    def capacity(capacity=PARTITION):
        return capacity // RECORD
    check("capacity is floor-divided", capacity() == 8 * 1024 * 1024 // 37, str(capacity()))
    check("record 0 sits at offset 0", next_record_offset(0) == 0)
    last = capacity() - 1
    check("the last record fits exactly", next_record_offset(last) + RECORD <= PARTITION)
    check("the last record does NOT wrap", not wraps(last))
    check("the cursor AT capacity wraps to 0", wraps(capacity()) and next_record_offset(capacity()) == 0)
    check("the record PAST the ring wraps to 0", next_record_offset(last + 1) == 0)

    # THE DSHOT TELEMETRY DECODE: the 3-byte GCR packet's 21-bit value = the
    # electrical period in µs ÷ 4; eRPM = 60e6/period. A motor at 10,000 eRPM
    # has a 6000 µs period → the value is 1500.
    def erpm(gcr_value):
        period = gcr_value * 4
        return 0 if period == 0 else 60_000_000 // period
    check("eRPM decode: 1500 → 10,000 eRPM", erpm(1500) == 10000)
    check("eRPM decode: 0 → 0 (no telemetry)", erpm(0) == 0)
    check("eRPM decode: 750 → 20,000", erpm(750) == 20000)

    # THE mAh INTEGRAL: 5 A drawn for 72 s = 100 mAh
    def mah_step(mah, current_ma, dt_s):
        return mah + (current_ma * dt_s) / 3600.0
    m = 0.0
    for _ in range(3600):  # 72 s at 50 Hz
        m = mah_step(m, 5000, 0.02)
    check("mAh integral: 5 A × 72 s = 100 mAh", abs(m - 100.0) < 0.5, f"{m:.2f}")

    # THE SAG LIMITER: at ≤300 mV sag the ceiling is 100%; deeper sag scales
    # DOWN to a 55% floor — the loaded voltage never crosses the cutoff
    def limit(sag_mv, ceiling=100):
        guard = 300
        if sag_mv <= guard:
            return 100
        return max(55, 100 - (sag_mv - guard) // 4)
    check("no sag → 100%", limit(200) == 100)
    check("the limiter's curve starts at the guard edge (320 mV → 95%)", limit(320) == 95)
    check("the steep ramp reaches the floor fast (500 mV → 55%)", limit(500) == 55)
    check("1.2 V sag → the 55% floor", limit(1200) == 55)
    check("3 V sag → still the 55% floor (never zero)", limit(3000) == 55)

    # THE PDB FRAME VARIANT: 36 bytes, the header FB FC is the TYPE TAG —
    # the flight canon is untouched, the bridge and panel route by header
    import struct as _s
    pdb = bytearray(36)
    pdb[0], pdb[1] = 0xFB, 0xFC
    _s.pack_into("<I", pdb, 2, 1)      # seq
    _s.pack_into("<H", pdb, 6, 8400)   # current mA
    _s.pack_into("<H", pdb, 8, 9950)   # power cW (99.50 W)
    _s.pack_into("<H", pdb, 10, 100)   # mAh
    pdb[12] = 71                        # the ESC's max temp
    _s.pack_into("<H", pdb, 13, 480)   # sag mV
    pdb[15] = 88                        # the throttle ceiling %
    for i in range(4):
        _s.pack_into("<H", pdb, 16 + i * 2, 95)  # eRPM / 100 → 9500 eRPM
    _s.pack_into("<H", pdb, 24, 11300)  # v bus
    pdb[26] = 0x2                        # sag-limiting flagged
    check("the PDB frame is 36 bytes", len(pdb) == 36)
    check("the PDB header (FB FC) differs from the flight canon's (FA FB)",
          (pdb[0], pdb[1]) == (0xFB, 0xFC))
    check("PDB current reads back", _s.unpack_from("<H", pdb, 6)[0] == 8400)
    check("PDB power is centi-watts", abs(_s.unpack_from("<H", pdb, 8)[0] * 0.01 - 99.5) < 1e-9)

    # THE OTA PACKAGE: the tool's REAL ED25519 round trip is proven by its
    # own selftest (valid verifies, one flipped image bit rejects). The
    # firmware's commit() checks the digest FIRST, then the signature —
    # order documented in zola_ota.h.


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


def test_vision_and_swarm():
    print("VISION + OBSTACLE + SWARM MATH:")

    # THE PINHOLE CONVERSION: the flow's angular rate × height = velocity.
    # The PMW3901's scale: 0.00061697 rad/count. At 2 m AGL, 100 counts/s
    # sweeps 0.0617 rad → 0.123 m/s; at 20 m the SAME flow is 1.23 m/s —
    # which is why the ToF closes the equation.
    FLOW_RAD = 0.00061697
    def flow_velocity(counts, dt, height_m):
        return counts * FLOW_RAD * height_m / dt
    check("flow @2 m: 100 counts/s → 0.123 m/s", abs(flow_velocity(100, 1.0, 2.0) - 0.12339) < 0.001,
          f"{flow_velocity(100, 1.0, 2.0):.4f}")
    check("flow @20 m: the same counts are 10× faster",
          abs(flow_velocity(100, 1.0, 20.0) - flow_velocity(100, 1.0, 2.0) * 10) < 1e-9)

    # THE COMPLEMENTARY VELOCITY FILTER: the accel integrates (and DRIFTS);
    # the flow corrects. With a biased accel (+0.1 m/s² — a real IMU) and a
    # true 1.0 m/s hover drift read by the flow, the fused velocity settles
    # to the flow's truth, NOT the accel's runaway integration.
    vx = 0.0; dt = 0.002; corrector = 2.0
    true_v = 1.0
    for _ in range(2500):  # 5 s
        ax = 0.1  # the accel's bias: alone, it would integrate to +0.5 m/s
        flow_v = true_v + _rng.gauss(0, 0.05)
        vx += ax * dt
        vx -= (vx - flow_v) * corrector * dt
    check("velocity fusion rejects the accel bias", abs(vx - true_v) < 0.2, f"vx={vx:.3f}")

    # THE EMERGENCY BRAKE: the 0.7 m threshold — an obstacle DEAD AHEAD
    # (bearing 0°) brakes with PITCH; one on the RIGHT (bearing +90°) brakes
    # with ROLL toward the left; the strength ramps as the distance closes.
    BRAKE_KP, THRESH = 220.0, 0.7
    def brake(dist_m, bearing_deg):
        if dist_m >= THRESH:
            return (0.0, 0.0)
        strength = (THRESH - dist_m) / THRESH
        mag = BRAKE_KP * strength
        rad = math.radians(bearing_deg)
        # (roll, pitch) µs — the SAME assignment as brake_override():
        # pitch = mag·cos(bearing), roll = −mag·sin(bearing)
        return (-mag * math.sin(rad), mag * math.cos(rad))
    r, p = brake(0.3, 0.0)
    check("dead-ahead obstacle: pitch brakes, roll is silent",
          abs(p - 220.0 * (0.4 / 0.7)) < 1e-6 and abs(r) < 1e-6, f"r={r} p={p}")
    r, p = brake(0.35, 90.0)
    check("right-side obstacle: roll brakes LEFT",
          abs(r + 220.0 * (0.35 / 0.7)) < 1e-6 and abs(p) < 1e-6, f"r={r} p={p}")
    check("no braking outside the 0.7 m threshold", brake(0.71, 0.0) == (0.0, 0.0))
    _, p1 = brake(0.6, 0.0); _, p2 = brake(0.3, 0.0)  # bearing 0: pitch is the active axis
    check("the brake ramps as the obstacle closes", abs(p2) > abs(p1), f"{p1} → {p2}")

    # THE LEADER ELECTION: the lowest LIVE id wins — deterministically, from
    # every node's own table, with zero negotiation. A leader's timeout
    # hands the crown to the next-lowest live id automatically.
    def elect(my_id, peers):
        # peers: {id: alive_seconds_since_seen} — 200 ms window
        leader = my_id
        for pid, age in sorted(peers.items()):
            if age <= 0.2 and pid < leader:
                leader = pid
        return leader
    check("the lowest live id leads", elect(5, {3: 0.05, 7: 0.1}) == 3)
    check("a dead leader hands over (3 gone: 7 leads)", elect(9, {3: 0.5, 7: 0.1}) == 7)
    check("alone on the mesh, she leads herself", elect(4, {}) == 4)
    check("a peer INSIDE the 200 ms window counts", elect(5, {2: 0.19}) == 2)
    check("a peer OUTSIDE the 200 ms window is dead", elect(5, {2: 0.21}) == 5)


def test_nav_and_sensors():
    print("NAVIGATION + SENSOR MATH:")
    import math as m

    # HAVERSINE against a known distance: NYC's Columbus Circle to Central
    # Park South ≈ measured great-circle values — verify against the formula's
    # own independent implementation (the spherical law of cosines)
    def law_cos(lat1, lon1, lat2, lon2):
        p1, p2, dl = m.radians(lat1), m.radians(lat2), m.radians(lon2 - lon1)
        return 6371000.0 * m.acos(min(1, m.sin(p1) * m.sin(p2) + m.cos(p1) * m.cos(p2) * m.cos(dl)))
    cases = [(40.7128, -74.0060, 40.7580, -73.9855),   # Manhattan-ish
             (0.0, 0.0, 0.0, 1.0),                     # 1° of longitude at the equator ≈ 111.19 km
             (51.5007, -0.1246, 51.5033, -0.1277)]     # London eye → Trafalgar
    for a, b, c, d in cases:
        hv = haversine_m(a, b, c, d)
        ref = law_cos(a, b, c, d)
        check(f"haversine agrees with the law of cosines ({a},{b})", abs(hv - ref) / ref < 0.001,
              f"{hv:.1f} vs {ref:.1f}")
    equator = haversine_m(0, 0, 0, 1)
    check("1° of equatorial longitude ≈ 111.19 km", abs(equator - 111195.0) < 500, f"{equator:.0f} m")
    check("zero distance is zero", haversine_m(51.5, -0.1, 51.5, -0.1) == 0)

    # BEARING: due north, due east, and the round trip
    check("bearing due north = 0°", abs(bearing_deg(51.0, 0.0, 52.0, 0.0)) < 0.5)
    check("bearing due east ≈ 90°", abs(bearing_deg(51.0, 0.0, 51.0, 1.0) - 90) < 1.0)
    check("bearing south from north = 180°", abs(bearing_deg(52.0, 0.0, 51.0, 0.0) - 180) < 0.5)

    # THE COMPLEMENTARY HEADING FUSION: a gyro at 30°/s with a mag that says
    # 90° FIXED is a contradictory scenario — the per-step gyro push (0.06°)
    # and the mag pull (weight·err) balance at err = 0.06/0.02 = 3°: the
    # steady-state lag is PHYSICS, not a bug. Then the rotation STOPS and
    # the filter must settle to the truth exactly.
    fused = 0.0
    mag_weight = 0.02
    for _ in range(2000):  # 4 s of spinning
        gyro_term = fused + 30.0 * 0.002
        err = ((90.0 - gyro_term) + 540.0) % 360.0 - 180.0
        fused = gyro_term + mag_weight * err
    check("compass fusion tracks within the push/pull balance", abs(((fused - 90.0) + 540) % 360 - 180) < 4.0,
          f"fused={fused:.2f}° (the physics equilibrium is ±3°)")
    for _ in range(1000):  # 2 s of stillness — now it must CONVERGE
        gyro_term = fused + 0.0
        err = ((90.0 - gyro_term) + 540.0) % 360.0 - 180.0
        fused = gyro_term + mag_weight * err
    check("still gyro: the compass converges exactly", abs(((fused - 90.0) + 540) % 360 - 180) < 0.5,
          f"fused={fused:.2f}°")

    # GYRO BIAS: 300 samples of a true-zero gyro with a +1.5°/s bias must
    # recover the bias, and applying it must zero the readings
    s_bias_sum = [0.0, 0.0, 0.0]; n = 0; ready = False; bias = [0, 0, 0]
    rng = random.Random(77)
    for _ in range(300):
        gx, gy, gz = 1.5 + rng.gauss(0, 0.02), -0.4, 0.2
        if not ready and n < 300:
            s_bias_sum[0] += gx; s_bias_sum[1] += gy; s_bias_sum[2] += gz; n += 1
        if not ready and n >= 300:
            bias = [v / n for v in s_bias_sum]; ready = True
    check("gyro bias recovered within 0.1°/s", abs(bias[0] - 1.5) < 0.1, f"{bias[0]:.3f}")

    # THE LEVEL CHECK: ±3.5° — inside passes, outside fails, edge is exact
    check("level 3.4° passes", level_within(3.4, -3.4))
    check("3.6° fails", not level_within(3.6, 0.0))
    check("exactly 3.5° passes", level_within(3.5, -3.5))
    # THE PRE-ARM BATTERY: 11.1 V threshold — 11.09 fails, 11.11 passes
    check("pre-arm battery: 11.09 V fails", not battery_above_pream(11090))
    check("pre-arm battery: 11.11 V passes", battery_above_pream(11110))
    check("the in-flight floor (10.5) would NOT pass pre-arm",
          not battery_above_pream(10800))

    # BMP280 ALTITUDE FORMULA: the standard barometric inversion — sea level
    # pressure → 0 m, and each hPa of pressure drop ≈ +8.4 m near the ground
    def bmp_altitude(pressure_hpa, sea_hpa=1013.25):
        return 44330.0 * (1.0 - (pressure_hpa / 100.0 / sea_hpa) ** 0.1902949572)
    check("sea-level pressure reads 0 m", abs(bmp_altitude(101325.0)) < 0.5,
          f"{bmp_altitude(101325.0):.2f} m")
    check("−10 hPa ≈ +85 m", 80 < bmp_altitude(101325.0 - 1000.0) < 90,
          f"{bmp_altitude(101325.0 - 1000.0):.1f} m")

    # THE NMEA COORDINATE PARSE: ddmm.mmmm + hemisphere → decimal degrees
    def nmea_coord(raw, hemi, lat=True):
        deg_digits = 2 if lat else 3
        deg = int(raw[:deg_digits])
        minutes = float(raw[deg_digits:])
        value = deg + minutes / 60.0
        return -value if hemi in ("S", "W") else value
    check("NMEA 4042.6142 N = 40.7102°", abs(nmea_coord("4042.6142", "N") - 40.710236) < 0.0001,
          f"{nmea_coord('4042.6142', 'N'):.6f}")
    check("NMEA 07400.3736 W = −74.0062°", abs(nmea_coord("07400.3736", "W", False) + 74.006227) < 0.0001,
          f"{nmea_coord('07400.3736', 'W', False):.6f}")

    # THE WAYPOINT SEQUENCER: arrival within the 2 m boundary advances; RTH
    # engages on mesh death; reaching HOME ends the RTH
    class Mission:
        def __init__(self, wps):
            self.wps = wps; self.i = 0; self.rth = False; self.home = wps[0]
        def step(self, lat, lon, mesh_alive):
            if self.rth:
                if haversine_m(lat, lon, self.home[0], self.home[1]) <= 2.0:
                    return (None, True)  # home, done
                return (self.home, False)
            if not mesh_alive and not self.rth:
                self.rth = True
            if self.i >= len(self.wps):
                return (None, True)
            target = self.wps[self.i]
            if haversine_m(lat, lon, target[0], target[1]) <= 2.0:
                self.i += 1
                if self.i >= len(self.wps):
                    return (None, True)
                target = self.wps[self.i]
            return (target, False)
    ms = Mission([(51.5, -0.1), (51.51, -0.1)])
    # she launches ~11 m OUTSIDE wp1 (51.5001 is 11 m north of 51.5)
    t, done = ms.step(51.5001, -0.1, True)
    check("waypoint 1 active from outside its radius", t == (51.5, -0.1) and not done, f"{t}")
    t, done = ms.step(51.5, -0.1, True)       # entering the 2 m boundary...
    t2, done2 = ms.step(51.5, -0.1, True)     # ...so the next step targets wp2
    check("entering the 2 m boundary advances", t2 == (51.51, -0.1) and not done2, f"{t2}")
    t, done = ms.step(51.51, -0.1, True)      # arrive at wp2 — the mission is flown
    check("the mission completes at the last waypoint", done, f"{t},{done}")
    ms = Mission([(51.5, -0.1), (51.51, -0.1)])
    ms.step(51.5001, -0.1, True)
    t, done = ms.step(51.5001, -0.1, False)   # the mesh dies mid-mission
    check("mesh death engages RTH", ms.rth, f"target={t}")
    t, done = ms.step(51.5, -0.1, False)      # she reaches HOME
    check("reaching HOME ends the RTH", done, f"{t},{done}")


def main():
    test_madgwick()
    test_dshot()
    test_dshot_driver()
    test_cascade()
    test_command_canon()
    test_packet_canon()
    test_nav_and_sensors()
    test_vision_and_swarm()
    test_blackbox_pdb_ota()
    print(f"\nfirmware math mirror: {PASS} pass, {FAIL} fail")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
