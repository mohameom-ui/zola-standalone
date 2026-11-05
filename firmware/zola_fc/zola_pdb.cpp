// zola_pdb.cpp — THE PDB'S POWER MATH + THE THERMAL/SAG INTERLOCKS
//
// THE DSHOT TELEMETRY WIRE: after a telemetry-request frame the ESC answers
// with a 3-byte GCR-encoded packet on the same wire — the 21-bit value is
// the ELECTRICAL PERIOD in microseconds ÷ 4. eRPM = 60,000,000 / period;
// the mechanical RPM = eRPM ÷ pole pairs. The wire CAPTURE is an RMT-RX
// bench job; the DECODE ARITHMETIC is mirrored + asserted today.
//
// THE SAG LIMITER: a LiPo's resting voltage vs its voltage UNDER LOAD can
// differ by more than a volt during a punch-out — the flight controller
// that limits on the LOADED voltage cuts too early. The limiter tracks the
// recent MINIMUM (the sag floor) and scales the throttle ceiling so the
// loaded voltage never crosses the cutoff.

#include "zola_pdb.h"
#include <Wire.h>
#include <string.h>

namespace zola_pdb {

// ---- the INA226 (I2C 0x40, the hall-effect front end) ----
static constexpr uint8_t INA_ADDR = 0x40;
static constexpr uint8_t INA_CONFIG = 0x00;   // 0x4F27: 16-sample averaging, 1.1 ms
static constexpr uint8_t INA_CURRENT = 0x04;  // shunt-current register
static constexpr uint8_t INA_POWER = 0x03;    // the power register
static bool s_ina_ok = false;
static float s_current_ma = 0;
static float s_power_w = 0;
static float s_mah = 0;

// ---- the ESC feedback ----
static uint32_t s_erpm[4] = {0, 0, 0, 0};
static uint8_t s_esc_temp_max = 0;
static uint16_t s_sag_mv = 0;
static uint16_t s_min_recent_mv = 12600;  // the sag floor (a fresh 3S rests here)
static constexpr uint16_t SAG_GUARD_MV = 300;   // the limiter guards 0.3 V of headroom
static constexpr uint8_t THERMAL_LIMIT_C = 85;  // the spec's line
static bool s_thermal_brake = false;
static uint8_t s_limit_pct = 100;

bool init() {
    Wire.beginTransmission(INA_ADDR);
    Wire.write(INA_CONFIG);
    Wire.write(0x4F); Wire.write(0x27);
    if (Wire.endTransmission() != 0) return false;
    // the calibration register (0x05) depends on the shunt value — ASSUMED
    // 2 mΩ / 8 A until the bench measures the actual PDB
    Wire.beginTransmission(INA_ADDR); Wire.write(0x05); Wire.write(0x0A); Wire.write(0x00); Wire.endTransmission();
    return true;
}

static int16_t ina_read16(uint8_t reg) {
    Wire.beginTransmission(INA_ADDR);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return 0;
    if (Wire.requestFrom(INA_ADDR, 2) != 2) return 0;
    return (int16_t)((Wire.read() << 8) | Wire.read());
}

void poll(uint16_t v_bus_mv) {
    if (s_ina_ok) {
        const int16_t cur = ina_read16(INA_CURRENT);   // × current_lsb (assumed 1 mA)
        s_current_ma = cur > 0 ? cur : 0;
        const int16_t pw = ina_read16(INA_POWER);      // × power_lsb (assumed 25 mW)
        s_power_w = pw * 0.025f;
    } else {
        // no INA: derive the current from the sag itself (a coarse but
        // honest estimate — the bench wires the hall sensor)
        s_current_ma = (12600 - v_bus_mv) * 60.f;      // the battery's model
    }
    // the sag tracking: an exponential minimum — fast to drop, slow to recover
    s_min_recent_mv = min(s_min_recent_mv, v_bus_mv);
    s_min_recent_mv += (uint16_t)((v_bus_mv - s_min_recent_mv) / 20);  // the recovery is slow
    s_sag_mv = (s_min_recent_mv < v_bus_mv) ? 0 : 0;  // the sag is min-vs-rest
    s_sag_mv = 12600 > s_min_recent_mv ? (uint16_t)(12600 - s_min_recent_mv) : 0;
    // the cumulative mAh: current × time (the mirror asserts the integral)
    s_mah += mah_from_current((uint32_t)s_current_ma, 0.02f, s_mah);
    s_thermal_brake = s_esc_temp_max >= THERMAL_LIMIT_C;
}

void feed_esc_telemetry(uint8_t motor, uint32_t erpm, uint8_t temp_c) {
    if (motor < 4) s_erpm[motor] = erpm;
    if (temp_c > s_esc_temp_max) s_esc_temp_max = temp_c;
}

uint32_t erpm_from_telemetry(uint32_t gcr_value) {
    // the 21-bit value = the electrical period in µs ÷ 4 (the BLHeli32/AM32
    // DShot-telemetry format); eRPM = 60,000,000 / period
    const uint32_t period_us = gcr_value * 4;
    if (period_us == 0) return 0;
    return 60000000u / period_us;
}

float mah_from_current(uint32_t current_ma, float dt_s, float mAh) {
    // mAh = mA × hours: the running integral (called at the poll rate)
    return mAh + (current_ma * dt_s) / 3600.f;
}

uint16_t sag_limited_max_us(uint16_t v_bus_mv, uint16_t nominal_max_us) {
    // the ceiling scales with the SAG depth: a 0.3 V sag = 100%, a 1.2 V sag
    // = 55% — the curve keeps the loaded voltage off the cutoff
    if (s_sag_mv <= SAG_GUARD_MV) { s_limit_pct = 100; return nominal_max_us; }
    const int16_t over = s_sag_mv - SAG_GUARD_MV;
    s_limit_pct = (uint8_t)constrain(100 - over / 4, 55, 100);
    return (uint16_t)((uint32_t)nominal_max_us * s_limit_pct / 100);
}

bool thermal_brake_required() { return s_thermal_brake; }
uint8_t esc_temp_max_c() { return s_esc_temp_max; }

size_t build_frame(uint8_t* out) {
    memset(out, 0, PDB_FRAME_SIZE);
    out[0] = 0xFB; out[1] = 0xFC;
    static uint32_t seq = 0;
    const uint32_t s = ++seq;
    memcpy(out + 2, &s, 4);
    const uint16_t cur = (uint16_t)constrain((int)s_current_ma, 0, 65535);
    const uint16_t pw = (uint16_t)constrain((int)(s_power_w * 100), 0, 65535);
    const uint16_t mah = (uint16_t)constrain((int)s_mah, 0, 65535);
    memcpy(out + 6, &cur, 2);
    memcpy(out + 8, &pw, 2);
    memcpy(out + 10, &mah, 2);
    out[12] = s_esc_temp_max;
    memcpy(out + 13, &s_sag_mv, 2);
    out[15] = s_limit_pct;
    for (int i = 0; i < 4; i++) {
        const uint16_t e = (uint16_t)constrain((uint32_t)(s_erpm[i] / 100), 0u, 65535u);
        memcpy(out + 16 + i * 2, &e, 2);
    }
    out[26] = (s_thermal_brake ? 1 : 0) | ((s_limit_pct < 100) ? 2 : 0);
    // the CRC over bytes 0..33 (the same rule as the flight canon: everything
    // before the CRC field)
    const uint16_t crc = calculate_zola_crc_public(out, 34);
    memcpy(out + 34, &crc, 2);
    return PDB_FRAME_SIZE;
}

}  // namespace zola_pdb
