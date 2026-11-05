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
| Firmware | `firmware/zola_fc/zola_flight.cpp` (+ `platformio.ini`) | FreeRTOS: stabilization owns core 0 at 1 kHz (I2C IMU → Mahony AHRS → quad-X mixer → DShot600/RMT); telemetry rides core 1 at 100 Hz; state crosses cores through a spinlock snapshot. LiPo floor ramps motors to idle below 10.5 V. |
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

## 5. Honest boundaries

- `hardware_calibrated: false` — same contract as Isaac: the DShot600 RMT
  tick rounding (12.5 → 12), the mixer gains (`Kp_deg = 4.0`), the hover
  throttle, and the battery divider ratio are engineering-accurate and
  **uncalibrated** until the bench runs.
- The firmware's stabilization is a level-hold baseline (P-only), not a
  tuned flight controller — the tuning campaign is the bench phase.
- The websockets 14.2 timer distortion we measured on Windows (a
  sleep-governed loop hit 21,000 fps with an active reader, 64 fps without)
  is why the bridge's sim rate is **clock-gated** — the rate cannot run away.
