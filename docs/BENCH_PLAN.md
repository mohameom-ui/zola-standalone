# Zola — The Bench Campaign (the path to `hardware_calibrated: true`)

Everything in the firmware stack is built and verified at the MATH level
(the 122-assertion mirror) and the COMPILER level (PlatformIO, zero errors).
What remains is physics: every constant below is an ASSUMED value until the
bench measures it. This document is the procedure — each item names its
tool, its method, and its acceptance test.

## The prerequisites

```powershell
pip install platformio          # done — the build is proven: pio run = SUCCESS
pio run -d firmware/zola_fc -e zola_fc        # compiles clean (verified)
pio run -d firmware/zola_fc -e zola_fc -t upload     # needs the board on USB
```

The firmware expects the **ESP32-S3 DevKitC** (or equivalent) wired per
docs/HIL.md §1. The `zolalog` + dual-bank partitions come from
`firmware/zola_fc/partitions_zola.csv` (wired in platformio.ini).

## The campaign — in order

| # | Item | Tool | Method | Acceptance |
|---|---|---|---|---|
| B-01 | battery divider | bench PSU + multimeter | 12.00 V across the divider vs the ADC's report; tune `zola_cal::BATT_DIVIDER` | \|error\| < 50 mV across 10-13 V |
| B-02 | hover throttle | the tethered hover test | raise until she neither climbs nor sinks for 10 s; `THROTTLE_HOVER_US` | ±2 cm over 10 s |
| B-03 | rate-PID gains | the step sweep | 10°/s rate steps per axis: kp until one ring, kd until settled, ki for the residual | no oscillation, < 5% steady error |
| B-04 | angle-loop gain | the lean-and-release test | 8°/s per ° default; raise until the hold is firm without hunting | settles < 1 s |
| B-05 | sea-level pressure | a reference weather station | set `SEA_LEVEL_HPA` to the current site value | the baro agrees with a known altitude ±2 m |
| B-06 | compass declination | WMM / the local chart | `DECLINATION_DEG` for the flight site | the fused heading matches a compass rose ±3° |
| B-07 | optical-flow scale | a known-speed slide | the sensor over a moving surface at a known height; tune `FLOW_RAD_PER_COUNT` | ±5% across 0.2-2 m/s |
| B-08 | INA226 shunt | the measured shunt + a known load | set the calibration register from the ACTUAL shunt ohms | ±2% vs the bench meter at 2/5/8 A |
| B-09 | key provisioning | the TPM 2.0 vault | per-node OTA + mesh keys; DEV keys retire | KEYS_PROVISIONED = true; the git history carries no production key |
| B-10 | DShot600 waveform | an oscilloscope | verify the bit period (1667 ns) + the pulse ratios on all 4 lines | the ratios 75%/37.5% ±2% |
| B-11 | ESC telemetry capture | RMT-RX + the scope | the GCR reply on the DShot wire after a telemetry request | the eRPM decode matches the bench tacho ±5% |
| B-12 | the VL53L1X full sequence | the ST ultra-lite init | the simplified bring-up → the full calibration | the ranging matches a tape measure ±2 cm to 4 m |
| B-13 | nav steering | the tethered mission | bearing → rate setpoints; the waypoint chase on a tether | the 2 m boundary crossed, RTH lands within 3 m of HOME |

## The order of flight

1. **B-01, B-05, B-08** with the motors UNPLUGGED (power only).
2. **B-02** tethered (props off first, then props + a tether).
3. **B-03, B-04** tethered.
4. **B-06, B-07, B-11, B-12** bench sensors.
5. **B-09, B-10** provisioning + scope.
6. **B-13** the first free flight, over soft ground, RTH armed.

## The rule

One variable at a time. Every value lands in `firmware/zola_fc/calibration.h`
with its measurement date — the file is the bench's lab notebook, and the
commit that flips `hardware_calibrated: true` carries the whole campaign's
numbers.
