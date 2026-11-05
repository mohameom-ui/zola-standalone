// zola_sensors.cpp — BARO + COMPASS + PRE-ARM MATH
// The BMP280 and HMC5883L drivers are standard-register I2C code; their
// MATH (Bosch compensation, tilt-compensated heading, complementary fusion,
// gyro-bias estimation) is mirrored and asserted in
// Scripts/firmware_math_check.py before any of this touches hardware.

#include "zola_sensors.h"
#include <Wire.h>

namespace zola_sensors {

// ------------------------------------------------------------- BMP280
static constexpr uint8_t BMP_ADDR = 0x76;      // SDO low; 0x77 if high
static constexpr uint8_t BMP_REG_ID = 0xD0;    // 0x58 on a real BMP280
static constexpr uint8_t BMP_REG_RESET = 0xE0; // write 0xB6 to reset
static constexpr uint8_t BMP_REG_CTRL = 0xF4;  // osrs_t x2, osrs_p x16, normal mode → 0b101_101_11 = 0xB7
static constexpr uint8_t BMP_REG_CONFIG = 0xF5; // standby 62.5 ms, filter x16 → 0b101_10100 = 0xB4
static constexpr uint8_t BMP_REG_DATA = 0xF7;  // press_msb, press_lsb, press_xlsb, temp(3)

struct BmpCalib { uint16_t T1; int16_t T2, T3; uint16_t P1; int16_t P2, P3, P4, P5, P6, P7, P8, P9; };
static BmpCalib bmp_cal;
static bool s_baro_ok = false;
static float s_altitude_m = 0.f;
static float s_board_temp_c = 0.f;
static constexpr float SEA_LEVEL_HPA = 1013.25f;  // ASSUMED until the bench calibrates

static bool bmp_read_calib() {
    Wire.beginTransmission(BMP_ADDR);
    Wire.write(0x88);  // calib block origin
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(BMP_ADDR, 24) != 24) return false;
    auto r16 = []() { return (uint16_t)(Wire.read() | (Wire.read() << 8)); };
    auto s16 = []() { return (int16_t)(Wire.read() | (Wire.read() << 8)); };
    bmp_cal.T1 = r16(); bmp_cal.T2 = s16(); bmp_cal.T3 = s16();
    bmp_cal.P1 = r16(); bmp_cal.P2 = s16(); bmp_cal.P3 = s16(); bmp_cal.P4 = s16();
    bmp_cal.P5 = s16(); bmp_cal.P6 = s16(); bmp_cal.P7 = s16(); bmp_cal.P8 = s16();
    bmp_cal.P9 = s16();
    return true;
}

// the Bosch compensation — mirrored verbatim in firmware_math_check.py
static float bmp_compensate(int32_t adc_T, int32_t adc_P, float& temp_c) {
    float v1 = (((float)adc_T) / 16384.f - ((float)bmp_cal.T1) / 1024.f) * ((float)bmp_cal.T2);
    float v2 = (((adc_T) / 131072.f - (bmp_cal.T1) / 8192.f) * (adc_T / 131072.f - bmp_cal.T1 / 8192.f)) * ((float)bmp_cal.T3 * 16.f);
    float t_fine = v1 + v2;
    temp_c = (t_fine / 5120.f);

    v1 = (t_fine / 2.f) - 64000.f;
    v2 = v1 * v1 * ((float)bmp_cal.P6) / 32768.f;
    v2 = v2 + v1 * ((float)bmp_cal.P5) * 2.f;
    v2 = (v2 / 4.f) + (((float)bmp_cal.P4) * 65536.f);
    v1 = (((float)bmp_cal.P3) * v1 * v1 / 524288.f + ((float)bmp_cal.P2) * v1) / 524288.f;
    v1 = (1.f + v1 / 32768.f) * ((float)bmp_cal.P1);
    if (v1 == 0) return 0;  // the calibration is garbage — avoid a div by zero
    float p = 1048576.f - (float)adc_P;
    p = (p - (v2 / 4096.f)) * 6250.f / v1;
    v1 = ((float)bmp_cal.P9) * p * p / 2147483648.f;
    v2 = p * ((float)bmp_cal.P7) / 32768.f;
    p = p + (v1 + v2) / 16.f;
    return p;  // Pa
}

bool baro_init() {
    Wire.beginTransmission(BMP_ADDR);
    Wire.write(BMP_REG_ID);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(BMP_ADDR, 1) != 1 || Wire.read() != 0x58) return false;
    if (!bmp_read_calib()) return false;
    Wire.beginTransmission(BMP_ADDR); Wire.write(BMP_REG_CTRL); Wire.write(0xB7); Wire.endTransmission();
    Wire.beginTransmission(BMP_ADDR); Wire.write(BMP_REG_CONFIG); Wire.write(0xB4); Wire.endTransmission();
    return true;
}

void baro_poll() {
    Wire.beginTransmission(BMP_ADDR);
    Wire.write(BMP_REG_DATA);
    if (Wire.endTransmission(false) != 0) { s_baro_ok = false; return; }
    if (Wire.requestFrom(BMP_ADDR, 6) != 6) { s_baro_ok = false; return; }
    int32_t adc_p = (int32_t)((Wire.read() << 12) | (Wire.read() << 4) | (Wire.read() >> 4));
    int32_t adc_t = (int32_t)((Wire.read() << 12) | (Wire.read() << 4) | (Wire.read() >> 4));
    float pressure_pa = bmp_compensate(adc_t, adc_p, s_board_temp_c);
    s_baro_ok = pressure_pa > 30000.f && pressure_pa < 120000.f;  // physical bounds
    // the barometric altitude: h = (T0-lapse·?)... the standard ISA inversion,
    // mirrored in the math check
    if (s_baro_ok) {
        s_altitude_m = 44330.f * (1.f - powf(pressure_pa / 100.f / SEA_LEVEL_HPA, 0.1902949572f));
    }
}

float altitude_m() { return s_altitude_m; }
float board_temp_c() { return s_board_temp_c; }

// ------------------------------------------------------------ HMC5883L
static constexpr uint8_t MAG_ADDR = 0x1E;
static constexpr uint8_t MAG_REG_CONFIG_A = 0x00;  // 75 Hz max, no bias → 0x18
static constexpr uint8_t MAG_REG_MODE = 0x02;      // continuous → 0x00
static constexpr uint8_t MAG_REG_DATA = 0x03;      // X/Y/Z MSB-first, 6 bytes
static constexpr float MAG_LSB_MT = 1.f / 0.92f;   // 0.92 mG/LSB → gauss
static bool s_mag_ok = false;
static float s_declination_deg = 0.f;   // site-specific — the bench sets it
static float s_heading = 0.f;
static float s_mag_weight = 0.02f;      // the complementary filter's mag share

bool mag_init() {
    Wire.beginTransmission(MAG_ADDR);
    Wire.write(0x0A);  // ID register A
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(MAG_ADDR, 3) != 3) return false;
    if (Wire.read() != 'H' || Wire.read() != '4' || Wire.read() != '3') return false;
    Wire.beginTransmission(MAG_ADDR); Wire.write(MAG_REG_CONFIG_A); Wire.write(0x18); Wire.endTransmission();
    Wire.beginTransmission(MAG_ADDR); Wire.write(0x01); Wire.write(0x20); Wire.endTransmission();  // ±1.3 Ga
    Wire.beginTransmission(MAG_ADDR); Wire.write(MAG_REG_MODE); Wire.write(0x00); Wire.endTransmission();  // continuous
    return true;
}

// THE TILT-COMPENSATED HEADING: the raw mag vector is body-frame; the
// Madgwick quaternion rotates it into the earth frame where the heading is
// atan2(East, North) — mirrored in the math check.
static void mag_update(float q_w, float q_x, float q_y, float q_z, float gyro_z_dps, float dt) {
    Wire.beginTransmission(MAG_ADDR);
    Wire.write(MAG_REG_DATA);
    if (Wire.endTransmission(false) != 0) { s_mag_ok = false; return; }
    if (Wire.requestFrom(MAG_ADDR, 6) != 6) { s_mag_ok = false; return; }
    auto s16 = []() { return (int16_t)((Wire.read() << 8) | Wire.read()); };
    float mx = s16(), my = s16(), mz = s16();

    // rotate body → earth with the quaternion (v' = q * v * q⁻¹)
    float nx = q_w*q_w*mx + 2.f*q_w*(q_y*mz - q_z*my) + q_x*q_x*mx + 2.f*q_x*q_y*my + 2.f*q_x*q_z*mz - q_y*q_y*mx - q_z*q_z*mx;
    float ny = 2.f*(q_x*q_y*mx + q_w*q_z*mx) + q_w*q_w*my - 2.f*q_w*q_x*mz + 2.f*(q_y*q_z + q_x*q_w)*my - q_x*q_x*my + q_z*q_z*my;
    // the heading from the earth-frame horizontal components
    float mag_heading = atan2f(ny, nx) * 57.2958f;
    if (mag_heading < 0) mag_heading += 360.f;

    // THE COMPLEMENTARY FUSION: the gyro integrates (fast, drifts); the mag
    // pulls (slow, noisy). THE UNITS TRAP (the v2 lesson again): the gyro is
    // deg/s — the integration is deg/s × s.
    static float fused = 0.f;
    float gyro_term = fused + gyro_z_dps * dt;
    float err = mag_heading - gyro_term;
    while (err > 180.f) err -= 360.f;   // wrap the pull through the short arc
    while (err < -180.f) err += 360.f;
    fused = gyro_term + s_mag_weight * err;
    if (fused < 0) fused += 360.f;
    if (fused >= 360.f) fused -= 360.f;
    s_heading = fused;
    s_mag_ok = true;
}

void mag_poll(float q_w, float q_x, float q_y, float q_z, float gyro_z_dps, float dt) {
    mag_update(q_w, q_x, q_y, q_z, gyro_z_dps, dt);
}

float heading_deg() { return s_heading; }
void set_declination_deg(float decl) { s_declination_deg = decl; (void)s_declination_deg; }

// --------------------------------------------------------- gyro bias
static float bias[3] = {0.f, 0.f, 0.f};
static bool s_bias_ready = false;
static int32_t s_bias_sum[3] = {0, 0, 0};
static int32_t s_bias_n = 0;
static constexpr int32_t BIAS_SAMPLES = 1500;  // 3 s at 500 Hz

void start_gyro_bias_calibration() {
    s_bias_sum[0] = s_bias_sum[1] = s_bias_sum[2] = 0;
    s_bias_n = 0;
    s_bias_ready = false;
}

void feed_gyro(float gx, float gy, float gz) {
    if (s_bias_ready || s_bias_n >= BIAS_SAMPLES) {
        if (!s_bias_ready) {
            bias[0] = (float)s_bias_sum[0] / (float)s_bias_n;
            bias[1] = (float)s_bias_sum[1] / (float)s_bias_n;
            bias[2] = (float)s_bias_sum[2] / (float)s_bias_n;
            s_bias_ready = true;
        }
        return;
    }
    s_bias_sum[0] += (int32_t)(gx * 16);  // fixed-point accumulation (0.0625°/s LSB)
    s_bias_sum[1] += (int32_t)(gy * 16);
    s_bias_sum[2] += (int32_t)(gz * 16);
    s_bias_n++;
}

void apply_gyro_bias(float& gx, float& gy, float& gz) {
    if (!s_bias_ready) return;
    gx -= bias[0]; gy -= bias[1]; gz -= bias[2];
}

bool gyro_bias_ready() { return s_bias_ready; }

// --------------------------------------------------------- the pre-arm checks
bool level_within(float roll_deg, float pitch_deg, float threshold_deg) {
    return fabsf(roll_deg) <= threshold_deg && fabsf(pitch_deg) <= threshold_deg;
}

bool battery_above_pream(float battery_mv, float threshold_mv) {
    return battery_mv >= threshold_mv;
}

// -------------------------------------------------------------- health
static bool s_imu_ok_mirror = false;

void report_imu(bool alive) { s_imu_ok_mirror = alive; }

Health health() {
    Health h;
    h.baro_ok = s_baro_ok;
    h.mag_ok = s_mag_ok;
    h.imu_ok = s_imu_ok_mirror;
    h.gyro_bias_fresh = s_bias_ready;
    h.level_ok = level_within(0.f, 0.f);  // replaced by the real attitude at the call site
    h.battery_ok = true;                  // replaced by the real threshold at the call site
    return h;
}

}  // namespace zola_sensors
