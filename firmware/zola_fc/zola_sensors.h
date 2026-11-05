// zola_sensors.h — THE SUPPORT SENSOR STACK (baro + compass + pre-arm math)
// I2C on GPIO 8/9 @ 400 kHz — the spec's bus. THE PIN REASSIGNMENT (merge
// decision): v2 put the SPI IMU's SCK/MISO on 8/9, which this spec needs
// for the magnetometer/barometer — one pin cannot serve two buses. The SPI
// IMU moved to 12/13/11/10 (SCK/MISO/MOSI/CS); 8/9 are I2C-only, serving
// the BMP280 + HMC5883L always, and the IMU's I2C fallback path too.
#pragma once
#include <Arduino.h>

namespace zola_sensors {

/// the engine mirrors its imu_alive here (the health readout is one call)
void report_imu(bool alive);

// ------------------------------------------------------------ health
struct Health {
    bool baro_ok = false;
    bool mag_ok = false;
    bool imu_ok = false;       // mirrored from the engine's imu_alive
    bool gyro_bias_fresh = false;
    bool level_ok = false;     // the ±3.5° pre-arm tilt check
    bool battery_ok = false;   // the ≥ 11.1 V pre-arm threshold
};
Health health();

// ------------------------------------------------------------ barometer
// BMP280 @ 50 Hz: real-time pressure → altitude, temperature-compensated by
// the BMP280's own die temperature (the Bosch compensation is self-contained).
// The ABSOLUTE altitude needs the sea-level pressure constant — an assumed
// 1013.25 hPa until the bench calibrates it against a reference.
bool baro_init();
void baro_poll();                      // call at ~50 Hz from the flight loop
float altitude_m();                    // the temperature-compensated estimate
float board_temp_c();                  // the ambient reading, for bias correction

// ------------------------------------------------------------ compass
// HMC5883L: the raw magnetometer heading, TILT-COMPENSATED by the Madgwick
// quaternion (a tilted compass lies), then fused with the gyro-z via a
// complementary filter: the gyro carries the short term, the mag corrects
// the long-term drift.
bool mag_init();
void mag_poll(float q_w, float q_x, float q_y, float q_z, float gyro_z_dps, float dt);
float heading_deg();                   // the fused heading (0-360, declination-corrected)
void set_declination_deg(float decl);

// --------------------------------------------------------- pre-arm math
/// Gyro bias: the zero-rate offset from a stationary sample window. THE
/// SPEC'S 3-SECOND STARTUP: call calibrate_gyro_bias() in setup() while the
/// vehicle MUST be still; the offsets then subtract from every reading.
void start_gyro_bias_calibration();
bool gyro_bias_ready();
void feed_gyro(float gx, float gy, float gz);   // raw deg/s, during calibration
void apply_gyro_bias(float& gx, float& gy, float& gz);

/// The level check: |tilt| within ±3.5° before arming is permitted.
bool level_within(float roll_deg, float pitch_deg, float threshold_deg = 3.5f);

/// The pre-arm battery threshold: the SPEC's 11.1 V (3.7 V/cell) — stricter
/// than the in-flight 10.5 V floor; arming demands the stricter number.
bool battery_above_pream(float battery_mv, float threshold_mv = 11100.f);

}  // namespace zola_sensors
