// zola_optical.cpp — PMW3901 FLOW + VL53L1X ToF + THE VELOCITY FUSION
//
// THE PHYSICS (mirrored in firmware_math_check.py): the PMW3901 reports
// ANGULAR flow — a pinhole camera's pixel displacement per frame. The
// linear velocity is angular_flow (rad) × height (m) / dt: the same ground
// texture sweeping 2° across the sensor is 0.7 m/s at 20 m altitude and
// 0.07 m/s at 2 m — WHICH IS THE WHOLE POINT: the flow alone cannot tell
// you how fast you move; the ToF's height above ground closes the equation.
//
// ILLUMINATION COMPENSATION (the spec's surface-lighting item): the
// PMW3901 auto-manages its shutter; the driver READS the shutter and
// quality — a maxed shutter (dark floor) or a low SQUAL means the flow
// this frame is noise, and the fusion REJECTS it instead of drinking it.
// Honest rejection beats confident garbage.

#include "zola_optical.h"
#include <SPI.h>
#include <Wire.h>

namespace zola_optical {

// ---- PMW3901 (SPI: the IMU's bus, its own CS — GPIO 14) ----
static constexpr uint8_t OPT_CS = 14;
static constexpr uint8_t PMW_PRODUCT_ID = 0x7A;   // 0x49 on a real PMW3901MB
static constexpr uint8_t PMW_MOTION_BURST = 0x16; // 12 bytes: dx, dy, quality, shutter
static constexpr float FLOW_RAD_PER_COUNT = 0.00061697f;  // the sensor's angular scale
static SPIClass& flow_spi = SPI;                  // shares the IMU's bus, own CS
static bool s_flow_ok = false;

// ---- VL53L1X (I2C 0x29) ----
static constexpr uint8_t TOF_ADDR = 0x29;
static constexpr uint16_t TOF_MODEL_ID_REG = 0x010F;  // 0xEACC on a real VL53L1X
static bool s_tof_ok = false;

// ---- the fused state ----
static float s_vx = 0.f, s_vy = 0.f;         // m/s, body frame
static float s_px = 0.f, s_py = 0.f;         // m, from the hold origin
static float s_home_x = 0.f, s_home_y = 0.f;
static float s_agl_m = 0.f;                  // height above ground (ToF)
static bool s_flow_healthy = false;
static float s_corrector = 2.0f;             // the complementary filter's rate

static bool spi_read_reg(uint8_t reg, uint8_t* out, size_t n) {
    digitalWrite(OPT_CS, LOW);
    flow_spi.transfer(reg);
    for (size_t i = 0; i < n; i++) out[i] = flow_spi.transfer(0x00);
    digitalWrite(OPT_CS, HIGH);
    return true;
}

static bool pmw_init() {
    pinMode(OPT_CS, OUTPUT);
    digitalWrite(OPT_CS, HIGH);
    uint8_t id = 0;
    spi_read_reg(PMW_PRODUCT_ID, &id, 1);
    if (id != 0x49) return false;
    // the power-up sequence (the vendor's wake writes)
    digitalWrite(OPT_CS, LOW); flow_spi.transfer(0x3A); flow_spi.transfer(0x5A); digitalWrite(OPT_CS, HIGH);
    digitalWrite(OPT_CS, LOW); flow_spi.transfer(0x77); flow_spi.transfer(0x33); digitalWrite(OPT_CS, HIGH);
    digitalWrite(OPT_CS, LOW); flow_spi.transfer(0x41); flow_spi.transfer(0x04); digitalWrite(OPT_CS, HIGH);
    digitalWrite(OPT_CS, LOW); flow_spi.transfer(0x60); flow_spi.transfer(0x27); digitalWrite(OPT_CS, HIGH);
    digitalWrite(OPT_CS, LOW); flow_spi.transfer(0x62); flow_spi.transfer(0x27); digitalWrite(OPT_CS, HIGH);
    digitalWrite(OPT_CS, LOW); flow_spi.transfer(0x63); flow_spi.transfer(0x7F); digitalWrite(OPT_CS, HIGH);
    digitalWrite(OPT_CS, LOW); flow_spi.transfer(0x64); flow_spi.transfer(0x08); digitalWrite(OPT_CS, HIGH);
    digitalWrite(OPT_CS, LOW); flow_spi.transfer(0x66); flow_spi.transfer(0x30); digitalWrite(OPT_CS, HIGH);
    digitalWrite(OPT_CS, LOW); flow_spi.transfer(0x67); flow_spi.transfer(0x43); digitalWrite(OPT_CS, HIGH);
    return true;
}

static bool tof_init() {
    Wire.beginTransmission(TOF_ADDR);
    Wire.write(TOF_MODEL_ID_REG & 0xFF);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(TOF_ADDR, 2) != 2) return false;
    const uint16_t id = (Wire.read() << 8) | Wire.read();
    if (id != 0xEACC) return false;
    // the simplified bring-up: the bench verifies the full ST sequence
    Wire.beginTransmission(TOF_ADDR); Wire.write(0x0025 & 0xFF); Wire.write(0x00); Wire.endTransmission();  // placeholder for the timing config
    Wire.beginTransmission(TOF_ADDR); Wire.write(0x0081 & 0xFF); Wire.write(0x3F); Wire.endTransmission();
    Wire.beginTransmission(TOF_ADDR); Wire.write(0x0087 & 0xFF); Wire.write(0x01); Wire.endTransmission();  // start ranging
    return true;
}

static uint16_t tof_read_mm() {
    Wire.beginTransmission(TOF_ADDR);
    Wire.write(0x0089 & 0xFF);  // the range status register
    if (Wire.endTransmission(false) != 0) return 0;
    if (Wire.requestFrom(TOF_ADDR, 1) != 1) return 0;
    const uint8_t status = Wire.read();
    if (!(status & 0x01)) return 0;  // not ready this cycle
    Wire.beginTransmission(TOF_ADDR);
    Wire.write(0x0096 & 0xFF);  // the range data, mm
    if (Wire.endTransmission(false) != 0) return 0;
    if (Wire.requestFrom(TOF_ADDR, 2) != 2) return 0;
    return (uint16_t)((Wire.read() << 8) | Wire.read());
}

bool init() {
    s_flow_ok = pmw_init();
    s_tof_ok = tof_init();
    return s_flow_ok || s_tof_ok;
}

void poll(float ax_mps2, float ay_mps2, float dt) {
    if (dt <= 0) return;

    // THE ToF HEIGHT: the pinhole conversion's missing half
    if (s_tof_ok) {
        const uint16_t mm = tof_read_mm();
        if (mm > 30 && mm < 4000) s_agl_m = mm / 1000.f;  // the spec's 4 m range
    }

    // THE FLOW FRAME: angular displacement this frame — trusted only when
    // the sensor says the surface tracking was real
    if (s_flow_ok) {
        uint8_t burst[12];
        spi_read_reg(PMW_MOTION_BURST, burst, 12);
        const int16_t dx = (int16_t)((burst[2] << 8) | burst[3]);
        const int16_t dy = (int16_t)((burst[4] << 8) | burst[5]);
        const uint8_t quality = burst[7];
        const uint16_t shutter = (uint16_t)((burst[8] << 8) | burst[9]);
        // THE ILLUMINATION VERDICT: quality ≥ 50 AND the shutter not maxed —
        // a maxed shutter is a dark floor; motion blur would lie to us
        s_flow_healthy = quality >= 50 && shutter < 0xFFF0;

        if (s_flow_healthy && s_agl_m > 0.1f) {
            // THE PINHOLE CONVERSION: angular flow × height = linear velocity
            const float flow_vx = (dx * FLOW_RAD_PER_COUNT) * s_agl_m / dt;
            const float flow_vy = (dy * FLOW_RAD_PER_COUNT) * s_agl_m / dt;

            // THE COMPLEMENTARY VELOCITY FILTER: the accelerometer integrates
            // (smooth, drifts); the flow's velocity is absolute-ish (noisy).
            // The corrector pulls the integrated velocity toward the flow.
            s_vx += ax_mps2 * dt;
            s_vy += ay_mps2 * dt;
            s_vx -= (s_vx - flow_vx) * s_corrector * dt;
            s_vy -= (s_vy - flow_vy) * s_corrector * dt;
        }
    } else {
        // no flow: pure inertial dead reckoning — it drifts, honestly
        s_vx += ax_mps2 * dt;
        s_vy += ay_mps2 * dt;
    }

    s_px += s_vx * dt;
    s_py += s_vy * dt;
}

void capture_home() { s_home_x = s_px; s_home_y = s_py; }

void position_hold_angles(float& roll_deg, float& pitch_deg) {
    // P on the position error, expressed as the ANGLE setpoints the cascade
    // tracks: drift 0.5 m right → bank left. The gain is ASSUMED (bench).
    constexpr float KP_POS_DEG_PER_M = 10.f;
    roll_deg  = -KP_POS_DEG_PER_M * (s_px - s_home_x);
    pitch_deg = -KP_POS_DEG_PER_M * (s_py - s_home_y);
    roll_deg = constrain(roll_deg, -12.f, 12.f);
    pitch_deg = constrain(pitch_deg, -12.f, 12.f);
}

bool flow_healthy() { return s_flow_healthy; }
bool tof_healthy() { return s_tof_ok; }
float height_agl_m() { return s_agl_m; }
float velocity_x() { return s_vx; }
float velocity_y() { return s_vy; }
float position_x() { return s_px; }
float position_y() { return s_py; }

}  // namespace zola_optical
