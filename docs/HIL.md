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
| Math referee | `Scripts/firmware_math_check.py` | the firmware's pure math mirrored in Python and asserted BEFORE flashing: Madgwick convergence, gyro-only yaw integration, DShot CRC4 + **the driver's wire order / timing ratios / reserved band**, the 36-byte packet layout, the mixer matrix, and the cascade's direction. **48 assertions.** |
| DShot driver | `firmware/zola_fc/zola_dshot.h/.cpp` | the motor-driver module: MSB-first wire order, ratio-encoded waveform ('1' ≈ 75% high, '0' ≈ 37.5%, equal bit periods — ESCs decode the ratio), one RMT TX channel per motor, throttle 0 = DISARM preserved, the reserved 1–47 band clamped to 48, 2048+ clamped. |
| Bridge | `bridge/zola_bridge.py` | ONE serial reader broadcasts to N WebSocket clients on `ws://127.0.0.1:8002`; CRC-verified, byte-exact resync on framing errors; `--sim` mode generates spec-shaped frames so the whole pipeline runs before the FC exists. |
| Panel | `src/lib/pet/hilTelemetry.ts` | the validated WS client (`useHilTelemetry` hook): rejects foreign/malformed traffic, keeps the latest frame + live fps. Data is 100 Hz; the paint is 10 Hz. |

## 4. Run it

```powershell
# the pipeline, right now, no hardware:
node Scripts/hil-test.mjs          # spins the sim bridge, asserts 100 Hz + schema + monotonic seq

# the bridges standalone:
python bridge/zola_bridge.py --sim # bench frames on ws://127.0.0.1:8002 (USB lane)
python bridge/zola_bridge.py       # real FC (auto-detects the port; ZOLA_FC_PORT overrides)
python bridge/zola_udp_bridge.py --sim   # the WIRELESS lane: fake FC + UDP :8888 → ws :8003
python bridge/zola_udp_bridge.py         # the real FC's Wi-Fi broadcast → the panel

# the firmware (needs PlatformIO + the ESP32-S3):
pio run -e zola_fc -t upload       # in firmware/zola_fc/
pio device monitor -b 921600       # the raw 100 Hz binary stream
```

## 5. The wireless lane (Wi-Fi/UDP fallback)

When the USB-C serial line isn't there — outdoor flight, mesh monitoring —
she broadcasts the SAME 36-byte packets over her own air-gapped Wi-Fi AP:

| Piece | File | Role |
|---|---|---|
| Firmware sink | `firmware/zola_fc/zola_udp.h/.cpp` | softAP `Zola_Flight_Mesh` + UDP socket :8888; the telemetry task drives BOTH sinks (USB primary, UDP fallback) — byte-identical frames by construction; fire-and-forget: a dead radio can never stall the 100 Hz schedule; `ZOLA_UDP_TELEMETRY=0` builds a radio-less bench binary |
| Ground bridge | `bridge/zola_udp_bridge.py` | UDP :8888 → WebSocket :8003; decodes with the SAME parse/CRC canon as the serial bridge; ONE reader thread → N clients (the draft bound one socket per client); lost datagrams counted (UDP loses by design — the sequence id exposes the gaps) |
| Panel | `hilTelemetry.ts` | accepts BOTH lanes' envelopes — `ZOLA_TELEMETRY_UPDATE` and `ZOLA_UDP_TELEMETRY`; one truth, two transports |
| Proof | `Scripts/hil-udp-test.mjs` | spins the sim bridge, then blasts its OWN independent datagrams (values the sim never generates) — proving the bridge PARSES rather than echoes; asserts per-source sequence monotonicity, source_ip identity, ~100 fps per FC — PASS |

## 6. The closed loop (commands in, failsafe out)

The return path completes the cycle — the panel (and the master kill-switch)
speak to the FC in **16-byte command frames**:

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | header `CA FE` |
| 2 | 1 | cmd_id — 0x00 heartbeat · 0x01 arm · 0x02 EMERGENCY DISARM · 0x03 waypoint · 0x04 PID gains |
| 3 | 9 | payload (layout per command — see `zola_failsafe.h`) |
| 12 | 2 | crc16 over bytes 0–11 |
| 14 | 2 | footer `EF AC` |

**Merge decisions (what the draft needed to function at all):**
- **CRC enforced** — the draft obeyed any header-matching garbage; a flipped
  ARM bit is a crash. Every frame is verified first (asserted in the mirror).
- **THE MODE IS ENFORCED** — the draft's parser wrote `current_flight_mode`
  and nothing ever read it: "EMERGENCY DISARM" disarmed nothing. The flight
  task's FIRST gate is now `enforce()`: DISARMED → idle, FAILSAFE_LAND →
  the 3-second controlled descent ramp → DISARMED, and only
  STABILIZED/AUTONOMOUS run the cascade. **She boots DISARMED** — the
  pre-failsafe firmware flew at hover with no operator at all.
- **CMD_HEARTBEAT (0x00) added** — the spec's command list is event-driven;
  with nothing periodic, EVERY flight would disarm 500 ms after arming. The
  panel pulses the heartbeat automatically while connected.
- **The arm interlock** — the ARM payload must carry 0xA5; an accidental arm
  is a launch. Disarm takes NO token: killing must be easy. Arming is also
  GATED (a live IMU, a battery above the cutoff) — she never arms blind or
  on a dying cell.
- **The failsafe recovery** — the draft's FAILSAFE_LAND had no exit (only a
  power cycle could fly again). The descent ends in DISARMED; arm works from
  there.
- **The command routes**: panel semantics (`ZOLA_COMMAND` over WS) → the
  bridge stamps the canon frame (the bridge owns the CRC — the panel never
  ships raw bytes) → the serial bridge writes it to the COM port; the UDP
  bridge flies it back to the address the FC's telemetry came from — the
  mesh's return route, zero configuration. The FC parses commands from both
  USB and UDP through the same sliding-window parser.

## 7. What the math mirror caught (the v2 war story)

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

## 8. The v3 merge notes (the PID + mixer spec)

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

## 9. The navigation + sensor tier (the fourth spec)

| Piece | File | Role |
|---|---|---|
| Sensors | `firmware/zola_fc/zola_sensors.h/.cpp` | BMP280 baro @ 50 Hz (Bosch temperature compensation, the ISA altitude inversion) + HMC5883L compass, tilt-compensated by the Madgwick quaternion, fused with the gyro-z via the complementary filter (the long-term yaw drift dies); the 3-second stationary gyro-bias calibration; the pre-arm math (±3.5° level, ≥ 11.1 V) |
| Navigation | `firmware/zola_fc/zola_nav.h/.cpp` | the M8N GPS on UART1 @ 115200 (checksum-verified NMEA GGA/RMC), Haversine distance + bearing, the waypoint sequencer with the 2 m arrival boundary, and the RTH: mesh death > 2 s in AUTONOMOUS_MESH flies her HOME (the 500 ms descent remains the manual-mode response — the two clocks protect different modes) |
| The pin reassignment | `zola_engine.cpp` | THE MERGE DECISION: this spec needs I2C 8/9 for the mag/baro "alongside the IMU" — one pin cannot serve two buses, so the SPI IMU moved to 12/13/11/10; 8/9 are I2C-only (mag + baro always, the IMU's fallback too) |
| The pre-arm gate | `zola_failsafe` + the engine | the FULL diagnostic before ARM may fire: live IMU · gyro bias calibrated · level within ±3.5° · battery ≥ 11.1 V (stricter than the 10.5 V in-flight floor) |

## 10. Honest boundaries

- `hardware_calibrated: false` — same contract as Isaac: the DShot600 RMT
  tick rounding, the rate-PID gains (1.2/0.05/0.03 roll+pitch, 2.5/0.1/0.0
  yaw — the spec's values, assumed until the bench sweep), the angle-loop
  gain (8°/s per °), the baro altitude-hold gain (12 µs per metre), the sea-
  level pressure constant (1013.25 hPa), the compass declination, the hover
  throttle, and the battery divider ratio are engineering-accurate and
  **uncalibrated** until the bench runs.
- The AUTONOMOUS_MESH mode stores waypoints, computes the target and logs
  it, but the NAV STEERING (bearing → rate setpoints) is the bench phase —
  she flies the level hold meanwhile. Honest, stated, not hidden.
- The magnetometer's tilt compensation uses the Madgwick quaternion —
  during a fast tumble the heading readout degrades (the mag is a slow
  sensor); the gyro carries those instants.
- The firmware's stabilization is a level-hold baseline with zero-rate yaw
  (heading hold needs a reference — the bench phase adds it).
- The websockets 14.2 timer distortion we measured on Windows (a
  sleep-governed loop hit 21,000 fps with an active reader, 64 fps without)
  is why the bridge's sim rate is **clock-gated** — the rate cannot run away.
