# Zola — Flight Controller Firmware & HIL Telemetry

The hardware tier's flight-control lane: a custom ESP32-S3 FC streaming
36-byte binary telemetry at 100 Hz into the panel. This lane is a **sibling**
of the MAVLink lane (`src/lib/pet/mavlink.ts` → the Matek F405) — one brain,
two flight-control languages.

## 1. Hardware & pin map

MCU: ESP32-S3 (dual-core 240 MHz) or STM32F405. IMU: MPU-9250/6050 (I2C
400 kHz; SPI2 on GPIO 9 is the alternate). Motors: DShot600 via the ESP32
RMT peripheral. Telemetry: UART0/USB-C **or** LoRa radio at 921,600 baud.

| Component | Pin / Bus | Function |
|---|---|---|
| IMU (I2C, SPI2 alt) | GPIO 8, 9 | gyro + accelerometer, high-rate bus |
| Motor 1 (front-left) | GPIO 5 | DShot600 digital ESC |
| Motor 2 (front-right) | GPIO 18 | DShot600 digital ESC |
| Motor 3 (rear-right) | GPIO 19 | DShot600 digital ESC |
| Motor 4 (rear-left) | GPIO 15 | DShot600 digital ESC |
| Battery monitor | GPIO 25 (ADC) | voltage divider — LiPo cutoff at 10.5 V (3S) |
| HIL telemetry | UART0 / USB | 36-byte binary frame @ 100 Hz |

## 2. The packet canon (36 bytes, little-endian)

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 2 | header `FA FB` | |
| 2 | 4 | sequence_id | uint32, monotonic |
| 6 | 4 | timestamp_us | uint32, `micros()` |
| 10 | 12 | roll, pitch, yaw | 3 × float32, **degrees** |
| 22 | 8 | m1–m4 throttle | 4 × uint16, **microseconds** (1000–2000) |
| 30 | 2 | battery_mv | uint16 |
| 32 | 2 | crc16 | over bytes 0–31; reflected poly `0xA001`, init `0xFFFF` |
| 34 | 2 | footer `FC FD` | |

**Merged decisions (where the draft spec disagreed with itself):**
- The draft's packet table said `FA FB`/`FC FD`; its C code used `0xFBFB`/
  `0xFDFD`. **The table wins** — wire bytes are `FA FB`/`FC FD` everywhere.
- The "CRC16-CCITT" routine was actually the reflected MODBUS-style table
  (poly 0xA001). The **algorithm is the contract** — firmware and bridge run
  the identical routine, so the misnomer is harmless and documented.
- Attitude units: degrees (the draft's sample values were degrees).

## 3. The three layers

| Layer | File | Role |
|---|---|---|
| Firmware | `firmware/zola_fc/zola_engine.cpp` (+ `platformio.ini`) — **V3** | FreeRTOS per the v2 core flip: flight control owns **core 1 at 500 Hz** (MPU-9250 over **SPI burst** — 14 bytes, one CS-low transaction, 10 MHz, with I2C fallback on the same pins → **Madgwick** gradient-descent AHRS → **THE CASCADE**: angle loop (euler → target rates, 8°/s per °) → **rate PID** (the spec's exact equation, integral clamp ±200) → **the spec's QuadX mixer matrix verbatim** (M1 +R+P−Y · M2 −R+P+Y · M3 −R−P−Y · M4 +R−P+Y) → DShot600/RMT); telemetry owns **core 0** at 100 Hz; state crosses cores through a spinlock snapshot. LiPo floor ramps motors to idle below 10.5 V. |
| Math referee | `Scripts/firmware_math_check.py` | the firmware's pure math mirrored in Python and asserted BEFORE flashing: Madgwick convergence to the true attitude, gyro-only yaw integration, DShot CRC4 vectors, the 36-byte packet layout, the mixer matrix, and the cascade's direction. **33 assertions.** |
| Bridge | `bridge/zola_bridge.py` | ONE serial reader broadcasts to N WebSocket clients on `ws://127.0.0.1:8002`; CRC-verified, byte-exact resync on framing errors; `--sim` mode generates spec-shaped frames so the whole pipeline runs before the FC exists. |
| Panel | `src/lib/pet/hilTelemetry.ts` | the validated WS client (`useHilTelemetry` hook): rejects foreign/malformed traffic, keeps the latest frame + live fps. Data is 100 Hz; the paint is 10 Hz. |

## 4. Run it

```powershell
# the pipeline, right now, no hardware:
node Scripts/hil-test.mjs          # spins the sim bridge, asserts 100 Hz + schema + monotonic seq

# the bridge standalone:
python bridge/zola_bridge.py --sim # bench frames on ws://127.0.0.1:8002
python bridge/zola_bridge.py       # real FC (auto-detects the port; ZOLA_FC_PORT overrides)

# the firmware (needs PlatformIO + the ESP32-S3):
pio run -e zola_fc -t upload       # in firmware/zola_fc/
pio device monitor -b 921600       # the raw 100 Hz binary stream
```

## 5. What the math mirror caught (the v2 war story)

Two real bugs, found by `Scripts/firmware_math_check.py` before any flash:

1. **The unit hand-off**: Madgwick's canonical form consumes gyro in
   RADIANS/second; the firmware pipeline produced degrees/second. A 90°/s
   yaw integrated to 102.86°. The firmware now converts at the filter's
   door; the PID keeps degrees (its gains are µs/degree).
2. **The vendored gradient snippet is wrong for tilted sensors**: the
   widely-copied `s0..s3` block (with its folded az terms) has an equilibrium
   that is provably NOT the true attitude — a true 20° roll settled at
   **63.18°**, matching the analytical prediction exactly. The firmware now
   uses the exact gradient `s = Jᵀf` (equilibrium provably f = 0) and skips
   the step entirely when the gradient vanishes (no kicks from nothing).

## 7. The v3 merge notes (the PID + mixer spec)

- **The draft's cast-before-constrain bug**: `constrain((uint16_t)m1, 1000,
  2000)` casts first — a negative overshoot (−1050 µs) wraps to 64486 and
  clamps to **2000 = FULL THROTTLE**, exactly when the motor must idle. The
  firmware clamps the float, then casts; the mirror asserts both edges.
- **The mixer matrix is the canon, verbatim** — and its per-axis row sums
  (+1−1−1+1 roll, +1+1−1−1 pitch, −1+1−1+1 yaw) are asserted to be zero in
  the mirror: that balance is the property that makes it a mixer.
- **The rate PID is the spec's exact equation** (Kp·e + Ki∫e + Kd·de/dt,
  derivative on ERROR). Known behavior, documented: the first update after
  reset produces a D-kick from the zero-initialized prev_error — the bench
  phase filters the setpoint; the mirror's cascade test settles the loop
  before asserting direction.
- **The cascade direction is asserted end to end**: a 10° right lean →
  −80°/s target rate → negative roll_corr → the RIGHT pair speeds up →
  the craft rolls left. That assertion is the loop's soul.

## 8. Honest boundaries

- `hardware_calibrated: false` — same contract as Isaac: the DShot600 RMT
  tick rounding (12.5 → 12), the rate-PID gains (1.2/0.05/0.03 roll+pitch,
  2.5/0.1/0.0 yaw — the spec's values, assumed until the bench sweep), the
  angle-loop gain (8°/s per °), the hover throttle, and the battery divider
  ratio are engineering-accurate and **uncalibrated** until the bench runs.
- The firmware's stabilization is a level-hold baseline with zero-rate yaw
  (heading hold needs a reference — the bench phase adds it).
- The websockets 14.2 timer distortion we measured on Windows (a
  sleep-governed loop hit 21,000 fps with an active reader, 64 fps without)
  is why the bridge's sim rate is **clock-gated** — the rate cannot run away.
