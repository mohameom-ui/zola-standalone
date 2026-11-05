// zola_engine.cpp — PROJECT ZOLA FLIGHT CONTROLLER, V3
// (supersedes zola_flight.cpp — one flight core, one source of truth)
//
// V3 (the PID + mixer spec): the control law is now the CASCADE —
// angle loop (Madgwick euler → target rates) → RATE PID (the spec's exact
// equation on gyro rates) → the spec's QuadX mixer matrix, verbatim. The
// draft's cast-before-constrain bug (negative overshoot → FULL THROTTLE) is
// fixed; the mixer matrix's per-axis row sums are verified in the mirror.
//
// V2 upgrades (the sensor-fusion spec, merged with the packet canon):
//   1. SPI REGISTER BURSTING — the MPU-9250's accel+temp+gyro leave in ONE
//      CS-low transaction (14 bytes from 0x3B) at 10 MHz, instead of 14
//      single-register I2C reads. The sample is atomic (one instant) and the
//      bus time collapses. I2C on the same two pins stays as the boot-time
//      fallback if SPI bring-up fails.
//   2. MADGWICK orientation filter (gradient descent, 6-axis, beta 0.1) —
//      the canonical MadgwickAHRSupdateIMU form, mirrored 1:1 in
//      Scripts/firmware_math_check.py, which asserts convergence and the
//      level-pose quaternion BEFORE this firmware ever flashes.
//   3. FULL PID (P was the v1 baseline): per-axis PID with integral clamp
//      (anti-windup) and derivative-on-measurement. GAINS ASSUMED until the
//      bench sweep — hardware_calibrated: false.
//   4. THE CORE FLIP — this spec's allocation wins: flight control owns
//      CORE 1 (high priority, 500 Hz), telemetry/comms owns CORE 0 (100 Hz).
//
// Draft-code typos fixed en route: pdMS_TO_Ticks → pdMS_TO_TICKS,
// xGetTickCount → xTaskGetTickCount, and the draft's raw-struct Serial.write
// (which would have broken the 36-byte packet canon Panel 3 parses).
//
// THE PACKET CANON (36 bytes, little-endian, unchanged — the bridge and the
// panel parse this exactly):
//   [0] FA FB · [2] seq u32 · [6] ts_us u32 · [10] roll,pitch,yaw f32 DEG
//   [22] m1..m4 u16 µs · [30] battery_mv u16 · [32] crc16 (bytes 0..31,
//   reflected 0xA001 init 0xFFFF) · [34] FC FD

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include "esp32-hal.h"
#include "esp32-hal-rmt.h"
#include "zola_dshot.h"
#include "zola_udp.h"
#include "zola_failsafe.h"
#include "zola_sensors.h"
#include "zola_nav.h"
#include "zola_optical.h"
#include "zola_obstacle.h"
#include "zola_swarm.h"
#include "zola_blackbox.h"
#include "zola_pdb.h"
#include "zola_ota.h"
#include "zola_crc.h"
#include <esp_partition.h>

// THE WIRELESS FALLBACK: 1 = the telemetry task broadcasts every packet to
// the Wi-Fi mesh as well as USB (the two lanes are byte-identical by
// construction). 0 = a bench build that keeps the radio off.
#define ZOLA_UDP_TELEMETRY 1

// ------------------------------------------------------------------ config
static constexpr uint16_t PKT_HEADER   = 0xFBFA;  // wire bytes FA FB (LE)
static constexpr uint16_t PKT_FOOTER   = 0xFDFC;  // wire bytes FC FD (LE)
static constexpr uint32_t TELEMETRY_HZ = 100;     // the Panel 3 contract
static constexpr uint32_t FLIGHT_HZ    = 500;     // the spec's 2 ms flight loop
static constexpr uint32_t BAUD         = 921600;

// THE FLIGHT LOOP'S LOG STATICS (declared before the tasks that use them —
// the compile taught us: a static used at line 495 cannot live at line 515)
static uint8_t log_divider = 0, pdb_divider = 0;
static uint32_t s_log_seq = 0;

// THE BLACKBOX'S STORAGE BINDING: the "zolalog" partition (8 MB) when the
// partition CSV carries it, an in-RAM ring (128 KB) for the bench — the
// LOGIC is identical, only the backing store differs.
static uint8_t s_ram_log[128 * 1024];
static bool ram_write(uint32_t off, const uint8_t* d, size_t len) {
    if (off + len > sizeof(s_ram_log)) return false;
    memcpy(s_ram_log + off, d, len);
    return true;
}
static void ram_read(uint32_t off, uint8_t* out, size_t len) {
    if (off + len <= sizeof(s_ram_log)) memcpy(out, s_ram_log + off, len);
}
// the plain statics the blackbox binds (the compile's lesson: a capturing
// lambda cannot become the function pointer the bind API takes)
static const esp_partition_t* s_log_partition = nullptr;
static bool flash_write(uint32_t off, const uint8_t* d, size_t len) {
    return s_log_partition && esp_partition_write(s_log_partition, off, d, len) == ESP_OK;
}
static void flash_read(uint32_t off, uint8_t* out, size_t len) {
    if (s_log_partition) esp_partition_read(s_log_partition, off, out, len);
}

static void bind_persistent_storage() {
    s_log_partition = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_ANY, "zolalog");
    if (s_log_partition) {
        zola_blackbox::bind_storage(flash_write, s_log_partition->size);
        zola_blackbox::bind_reader(flash_read);
        Serial.printf("[Zola Blackbox] flash partition: %u KB\n",
                      (unsigned)(s_log_partition->size / 1024));
    } else {
        zola_blackbox::bind_storage(ram_write, sizeof(s_ram_log));
        zola_blackbox::bind_reader(ram_read);
        Serial.println("[Zola Blackbox] no 'zolalog' partition — the RAM ring serves the bench");
    }
}

// THE PIN MAP — REASSIGNED (the sensor-stack spec's merge decision): the
// magnetometer/barometer live on I2C GPIO 8/9 "alongside the IMU" (this
// spec's requirement) — one pin cannot serve two buses, so the SPI IMU's
// SCK/MISO moved OFF 8/9 to 12/13 (MOSI 11, CS 10 unchanged). 8/9 are now
// I2C-ONLY: the BMP280 + HMC5883L always, and the IMU's I2C fallback path.
static constexpr int PIN_SPI_SCK   = 12;  // moved off 8 — see the reassignment note
static constexpr int PIN_SPI_MISO  = 13;
static constexpr int PIN_SPI_MOSI  = 11;
static constexpr int PIN_SPI_CS    = 10;
static constexpr int PIN_I2C_SDA   = 8;   // the spec's bus: mag + baro + IMU fallback
static constexpr int PIN_I2C_SCL   = 9;
static constexpr int PIN_GPS_RX    = 44;  // UART1: the M8N GPS @ 115200 (NMEA)
static constexpr int PIN_MOTOR_FL  = 5;   // motor 1, front-left
static constexpr int PIN_MOTOR_FR  = 18;  // motor 2, front-right
static constexpr int PIN_MOTOR_RR  = 19;  // motor 3, rear-right
static constexpr int PIN_MOTOR_RL  = 15;  // motor 4, rear-left
static constexpr int PIN_BATT_ADC  = 25;  // voltage divider tap

static constexpr float BATT_DIVIDER = 11.0f;      // (Rtop+Rbot)/Rbot — MEASURE ME
static constexpr uint16_t BATT_CUTOFF_MV = 10500; // 3S: 3.5 V/cell floor
static constexpr uint16_t THROTTLE_IDLE_US = 1000;
static constexpr uint16_t THROTTLE_HOVER_US = 1150;  // assumed until bench
static constexpr uint16_t THROTTLE_MAX_US  = 2000;

#pragma pack(push, 1)
struct ZolaTelemetryPacket {
    uint16_t header       = PKT_HEADER;
    uint32_t sequence_id  = 0;
    uint32_t timestamp_us = 0;
    float roll  = 0.f;   // degrees
    float pitch = 0.f;
    float yaw   = 0.f;
    uint16_t m1_throttle = THROTTLE_IDLE_US;  // FL
    uint16_t m2_throttle = THROTTLE_IDLE_US;  // FR
    uint16_t m3_throttle = THROTTLE_IDLE_US;  // RR
    uint16_t m4_throttle = THROTTLE_IDLE_US;  // RL
    uint16_t battery_mv  = 0;
    uint16_t crc16       = 0;
    uint16_t footer      = PKT_FOOTER;
};
#pragma pack(pop)
static_assert(sizeof(ZolaTelemetryPacket) == 36, "the packet canon is 36 bytes");

// ------------------------------------------------- cross-core flight state
struct FlightState {
    float roll = 0.f, pitch = 0.f, yaw = 0.f;   // degrees (Madgwick output)
    float q[4] = {1.f, 0.f, 0.f, 0.f};          // the raw quaternion, for the log
    uint16_t motors[4] = {THROTTLE_IDLE_US, THROTTLE_IDLE_US, THROTTLE_IDLE_US, THROTTLE_IDLE_US};
    uint16_t battery_mv = 0;
    bool imu_alive = false;
};
static FlightState g_flight;
static portMUX_TYPE g_state_mux = portMUX_INITIALIZER_UNLOCKED;

static inline FlightState snapshot_flight() {
    portENTER_CRITICAL(&g_state_mux);
    FlightState copy = g_flight;
    portEXIT_CRITICAL(&g_state_mux);
    return copy;
}
static inline void publish_flight(const FlightState& s) {
    portENTER_CRITICAL(&g_state_mux);
    g_flight = s;
    portEXIT_CRITICAL(&g_state_mux);
}

// ------------------------------------------------------------------- CRC16
// Reflected CRC-16, poly 0xA001 (0x8005 reversed), init 0xFFFF, no final xor.
uint16_t calculate_zola_crc(const uint8_t* data, size_t length) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < length; i++) {
        crc ^= data[i];
        for (uint8_t j = 0; j < 8; j++) {
            crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : (crc >> 1);
        }
    }
    return crc;
}

// ------------------------------------------------------------------- DShot
// The DShot600 driver lives in its own module now (zola_dshot.h/.cpp — the
// motor-driver spec): correct MSB-first wire order, ratio-encoded waveform,
// the reserved-command-band clamp. The engine's job is just the unit map:
// mixer microseconds (1000-2000) → DShot 11-bit (48-2047) per motor.
static const gpio_num_t MOTOR_PINS[4] = {  // the pin constants are ints — cast at the array
    (gpio_num_t)PIN_MOTOR_FL, (gpio_num_t)PIN_MOTOR_FR,
    (gpio_num_t)PIN_MOTOR_RR, (gpio_num_t)PIN_MOTOR_RL };

static void dshot_send_all(const uint16_t throttle_us[4]) {
    for (int m = 0; m < 4; m++) {
        uint16_t us = constrain(throttle_us[m], THROTTLE_IDLE_US, THROTTLE_MAX_US);
        uint16_t t11 = map(us, THROTTLE_IDLE_US, THROTTLE_MAX_US, zola_dshot::THROTTLE_MIN, zola_dshot::THROTTLE_MAX);
        zola_dshot::encode_msb_first(zola_dshot::prepare_packet(t11, false));
        zola_dshot::send(m);
    }
}

// ------------------------------------------ THE CASCADE (v3, the spec's)
// The real flight-controller architecture, two loops deep:
//   OUTER (angle):  Madgwick euler vs the target attitude (level hold for
//                   now) → TARGET RATES in °/s. P-only — the angle loop's
//                   output IS the rate setpoint.
//   INNER (rate):   the spec's PID equation on GYRO rates vs target rates —
//                   Output = Kp·e + Ki·∫e·dt + Kd·de/dt, integral clamped.
//                   This is the loop that talks to the motors, at 500 Hz.
//   MIXER:          the spec's QuadX matrix, verbatim (see below).
//
// THE SPEC'S RATE-PID EQUATION, implemented exactly (derivative on ERROR):
struct RatePid {
    // THE CONSTRUCTOR (the compile's lesson): with default member
    // initializers, the brace-init lists in the gains below need a real ctor
    RatePid(float p, float i, float d, float limit)
        : kp(p), ki(i), kd(d), integral(0.f), prev_error(0.f), integ_limit(limit) {}
    float kp, ki, kd;
    float integral = 0.f, prev_error = 0.f;
    float integ_limit;   // anti-windup clamp (±200 by the spec)
    float update(float setpoint, float measured, float dt) {
        float error = setpoint - measured;
        integral = constrain(integral + error * dt, -integ_limit, integ_limit);
        float derivative = (error - prev_error) / dt;
        prev_error = error;
        return kp * error + ki * integral + kd * derivative;
    }
    void reset() { integral = 0.f; prev_error = 0.f; }
};
// THE SPEC'S RATE GAINS (assumed until the bench sweep — hardware_calibrated: false)
static RatePid rate_roll  { 1.2f, 0.05f, 0.03f, 200.f };
static RatePid rate_pitch { 1.2f, 0.05f, 0.03f, 200.f };
static RatePid rate_yaw   { 2.5f, 0.10f, 0.00f, 200.f };
// THE ANGLE LOOP's gains (°/s of target rate per ° of attitude error) —
// ASSUMED; the bench sweep tunes these too. 8°/s per degree is a calm
// level-hold; a stunt tune would push this much higher.
static constexpr float ANGLE_KP_DPS_PER_DEG = 8.0f;

// --------------------------------------------------- THE QUADX MIXER
// The spec's matrix, VERBATIM — this is the canon now:
//   M1 front-left  (CW) : T + roll + pitch − yaw
//   M2 front-right (CCW): T − roll + pitch + yaw
//   M3 rear-right  (CW) : T − roll − pitch − yaw
//   M4 rear-left   (CCW): T + roll − pitch + yaw
// The row sums per axis are zero (+1−1−1+1 roll, +1+1−1−1 pitch, −1+1−1+1
// yaw) — net torque balanced, the property that makes it a mixer. Whether
// the CW/CCW labels match the physical prop rotation is a MOUNTING question
// (bench phase); the matrix is torque-balanced either way.
//
// THE DRAFT'S BUG, FIXED: constrain((uint16_t)m1, 1000, 2000) casts BEFORE
// clamping — a negative overshoot (−20.5) wraps to 65496 and clamps to
// 2000 µs = FULL THROTTLE, exactly when the motor should be at IDLE. Clamp
// the FLOAT, then cast.
static void apply_motor_mix(float base_us, float roll_corr, float pitch_corr, float yaw_corr,
                            float out[4]) {  // the cascade's array is float — the compile's lesson
    float m1 = base_us + roll_corr + pitch_corr - yaw_corr;  // front-left
    float m2 = base_us - roll_corr + pitch_corr + yaw_corr;  // front-right
    float m3 = base_us - roll_corr - pitch_corr - yaw_corr;  // rear-right
    float m4 = base_us + roll_corr - pitch_corr + yaw_corr;  // rear-left
    out[0] = constrain(m1, (float)THROTTLE_IDLE_US, (float)THROTTLE_MAX_US);
    out[1] = constrain(m2, (float)THROTTLE_IDLE_US, (float)THROTTLE_MAX_US);
    out[2] = constrain(m3, (float)THROTTLE_IDLE_US, (float)THROTTLE_MAX_US);
    out[3] = constrain(m4, (float)THROTTLE_IDLE_US, (float)THROTTLE_MAX_US);
}

// ------------------------------------------------- MPU-9250 over SPI burst
static SPIClass imu_spi(HSPI);
static constexpr uint8_t MPU_READ = 0x80;
static constexpr uint8_t MPU_WHO_AM_I_REG = 0x75;  // 0x71 on a real MPU-9250
static constexpr uint8_t MPU_PWR_MGMT_1 = 0x6B;
static constexpr uint8_t MPU_ACCEL_XOUT = 0x3B;    // burst origin: 14 bytes
static constexpr uint8_t MPU_GYRO_CFG = 0x1B;      // ±2000 dps → 16.4 LSB/dps
static constexpr uint8_t MPU_ACCEL_CFG = 0x1C;     // ±4g       → 8192 LSB/g
static constexpr float GYRO_LSB_DPS = 1.f / 16.4f;
static constexpr float ACCEL_LSB_G = 1.f / 8192.f;
static bool use_spi = false;

static void mpu_spi_write(uint8_t reg, uint8_t value) {
    digitalWrite(PIN_SPI_CS, LOW);
    imu_spi.transfer(reg);
    imu_spi.transfer(value);
    digitalWrite(PIN_SPI_CS, HIGH);
}

static uint8_t mpu_spi_read(uint8_t reg) {
    digitalWrite(PIN_SPI_CS, LOW);
    imu_spi.transfer(reg | MPU_READ);
    uint8_t out = imu_spi.transfer(0x00);
    digitalWrite(PIN_SPI_CS, HIGH);
    return out;
}

static bool mpu_spi_init() {
    pinMode(PIN_SPI_CS, OUTPUT);
    digitalWrite(PIN_SPI_CS, HIGH);
    imu_spi.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, -1);  // CS is manual
    if (mpu_spi_read(MPU_WHO_AM_I_REG) != 0x71) return false;
    mpu_spi_write(MPU_PWR_MGMT_1, 0x00);  // wake
    mpu_spi_write(MPU_GYRO_CFG, 0x18);    // ±2000 dps
    mpu_spi_write(MPU_ACCEL_CFG, 0x08);   // ±4g
    return true;
}

// THE BURST: one CS-low transaction reads accel+temp+gyro — 14 bytes from
// 0x3B in a single clocked sequence. The sample is atomic (all three sensors
// from the same instant) and the bus time collapses vs per-register reads.
static bool mpu_spi_burst(float& gx, float& gy, float& gz, float& ax, float& ay, float& az) {
    digitalWrite(PIN_SPI_CS, LOW);
    imu_spi.transfer(MPU_ACCEL_XOUT | MPU_READ);
    uint8_t raw[14];
    for (auto& b : raw) b = imu_spi.transfer(0x00);
    digitalWrite(PIN_SPI_CS, HIGH);
    auto s16 = [](uint8_t hi, uint8_t lo) { return (int16_t)((hi << 8) | lo); };
    ax = s16(raw[0], raw[1]) * ACCEL_LSB_G;
    ay = s16(raw[2], raw[3]) * ACCEL_LSB_G;
    az = s16(raw[4], raw[5]) * ACCEL_LSB_G;
    // raw[6..7] = temperature (unused for attitude)
    gx = s16(raw[8], raw[9]) * GYRO_LSB_DPS;
    gy = s16(raw[10], raw[11]) * GYRO_LSB_DPS;
    gz = s16(raw[12], raw[13]) * GYRO_LSB_DPS;
    return true;
}

// I2C fallback (the v1 path): the same two pins the SPI map lives on
static bool mpu_i2c_burst(float& gx, float& gy, float& gz, float& ax, float& ay, float& az) {
    Wire.beginTransmission(0x68);
    Wire.write(MPU_ACCEL_XOUT);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(0x68, 14) != 14) return false;
    auto r16 = []() { return (int16_t)((Wire.read() << 8) | Wire.read()); };
    ax = r16() * ACCEL_LSB_G; ay = r16() * ACCEL_LSB_G; az = r16() * ACCEL_LSB_G;
    r16();  // temperature
    gx = r16() * GYRO_LSB_DPS; gy = r16() * GYRO_LSB_DPS; gz = r16() * GYRO_LSB_DPS;
    return true;
}

// ------------------------------------------------- Madgwick (gradient descent)
// Madgwick's METHOD: gradient descent on the accelerometer's objective
// function. The gyro integrates the quaternion; the objective's gradient
// (s = Jᵀf, derived from eq. 25-26 of the report) pulls the estimate toward
// earth-down; beta weights the pull. NOTE: this is the EXACT Jacobian
// product, not the widely-copied vendored s0..s3 snippet — the mirror test's
// equilibrium analysis showed that snippet's folded terms converge to the
// WRONG attitude for tilted sensors (a true 20° roll settled at 63°). The
// exact gradient's equilibrium is provably f = 0 — the truth. Mirrored 1:1
// in Scripts/firmware_math_check.py, which asserts convergence BEFORE this
// firmware ever flashes.
static float mq[4] = {1.f, 0.f, 0.f, 0.f};  // w, x, y, z
static float madgwick_beta = 0.1f;

static void madgwick_step(float gx, float gy, float gz, float ax, float ay, float az, float deltat) {
    float q0 = mq[0], q1 = mq[1], q2 = mq[2], q3 = mq[3];
    float qDot1, qDot2, qDot3, qDot4;

    // rate of change of quaternion from the gyroscope (rad/s in, seconds in)
    qDot1 = 0.5f * (-q1 * gx - q2 * gy - q3 * gz);
    qDot2 = 0.5f * ( q0 * gx + q2 * gz - q3 * gy);
    qDot3 = 0.5f * ( q0 * gy - q1 * gz + q3 * gx);
    qDot4 = 0.5f * ( q0 * gz + q1 * gy - q2 * gx);

    if (!(ax == 0.f && ay == 0.f && az == 0.f)) {
        float recipNorm = 1.f / sqrtf(ax * ax + ay * ay + az * az);
        ax *= recipNorm; ay *= recipNorm; az *= recipNorm;

        // the objective (eq. 25, 6-axis) and its EXACT gradient s = Jᵀf:
        float f1 = 2.f*q1*q3 - 2.f*q0*q2 - ax;
        float f2 = 2.f*q0*q1 + 2.f*q2*q3 - ay;
        float f3 = 1.f - 2.f*q1*q1 - 2.f*q2*q2 - az;
        float s0 = -2.f*q2*f1 + 2.f*q1*f2;
        float s1 =  2.f*q3*f1 + 2.f*q0*f2 - 4.f*q1*f3;
        float s2 = -2.f*q0*f1 + 2.f*q3*f2 - 4.f*q2*f3;
        float s3 =  2.f*q1*f1 + 2.f*q2*f2;
        float sNorm = sqrtf(s0*s0 + s1*s1 + s2*s2 + s3*s3);
        if (sNorm > 1e-12f) {   // f ≈ 0 → gradient ≈ 0: NO kick from nothing
            float scale = madgwick_beta / sNorm;
            qDot1 -= scale * s0;
            qDot2 -= scale * s1;
            qDot3 -= scale * s2;
            qDot4 -= scale * s3;
        }
    }

    q0 += qDot1 * deltat; q1 += qDot2 * deltat;
    q2 += qDot3 * deltat; q3 += qDot4 * deltat;
    float recipNorm = 1.f / sqrtf(q0*q0 + q1*q1 + q2*q2 + q3*q3);
    mq[0] = q0 * recipNorm; mq[1] = q1 * recipNorm;
    mq[2] = q2 * recipNorm; mq[3] = q3 * recipNorm;
}

static void quat_to_euler_deg(float& roll, float& pitch, float& yaw) {
    float q0 = mq[0], q1 = mq[1], q2 = mq[2], q3 = mq[3];
    roll  = atan2f(2.f*(q0*q1 + q2*q3), 1.f - 2.f*(q1*q1 + q2*q2)) * 57.2958f;
    pitch = asinf(constrain(2.f*(q0*q2 - q3*q1), -1.f, 1.f)) * 57.2958f;
    yaw   = atan2f(2.f*(q0*q3 + q1*q2), 1.f - 2.f*(q2*q2 + q3*q3)) * 57.2958f;
}

// --------------------------------------- CORE 1: the flight-control task
static void flight_control_task(void*) {
    TickType_t last = xTaskGetTickCount();          // (the draft said xGetTickCount)
    const TickType_t period = pdMS_TO_TICKS(1000 / FLIGHT_HZ);  // (pdMS_TO_TICKS)
    float motors[4];
    for (;;) {
        float gx = 0, gy = 0, gz = 0, ax = 0, ay = 0, az = 0;
        bool alive = use_spi ? mpu_spi_burst(gx, gy, gz, ax, ay, az)
                             : mpu_i2c_burst(gx, gy, gz, ax, ay, az);
        // THE PRE-ARM GYRO BIAS: the calibrated zero-rate offsets come off
        // EVERY reading — a cold gyro's bias is a slow spin the level hold
        // cannot win against
        zola_sensors::apply_gyro_bias(gx, gy, gz);
        zola_sensors::feed_gyro(gx, gy, gz);   // feeds the 3-second boot calibration
        // THE UNIT CONTRACT: Madgwick's canonical form consumes RADIANS/SECOND
        // — the mirror test caught the degrees/s hand-off (a 90°/s yaw
        // integrated to 102.86°). The PID keeps degrees (its gains are in
        // µs/degree); the filter gets the radian conversion here.
        constexpr float DEG2RAD = 0.017453292519943295f;
        if (alive) madgwick_step(gx * DEG2RAD, gy * DEG2RAD, gz * DEG2RAD, ax, ay, az, 1.f / FLIGHT_HZ);

        // THE SUPPORT SENSORS: the baro at 50 Hz (every 10th flight cycle)
        // and the tilt-compensated compass every cycle — the fused heading
        // kills the long-term yaw drift the accel alone cannot see
        static uint8_t baro_divider = 0;
        if (++baro_divider >= 10) { baro_divider = 0; zola_sensors::baro_poll(); }
        zola_sensors::mag_poll(mq[0], mq[1], mq[2], mq[3], gz, 1.f / FLIGHT_HZ);
        zola_sensors::report_imu(alive);

        // THE VISION STACK: the optical flow + ToF velocity fusion needs the
        // GRAVITY-FREE acceleration. The measured accel is the SPECIFIC FORCE
        // f = a − g; the true acceleration is a = f + g_b, where g_b is the
        // body-frame gravity (rotated by the quaternion). SIGN CHECKED: a
        // nose-up rest reads f_x = −g·sinφ and g_b,x = +g·sinφ — they SUM to
        // zero (a hovering craft is not accelerating). The mirror asserts it.
        {
            const float q0 = mq[0], q1 = mq[1], q2 = mq[2], q3 = mq[3];
            const float gbx = 2.f*(q1*q3 - q0*q2)*(-9.81f);
            const float gby = 2.f*(q2*q3 + q0*q1)*(-9.81f);
            const float ax_lin = ax + gbx, ay_lin = ay + gby;
            zola_optical::poll(ax_lin, ay_lin, 1.f / FLIGHT_HZ);
        }

        FlightState s = snapshot_flight();
        s.imu_alive = alive;
        s.q[0] = mq[0]; s.q[1] = mq[1]; s.q[2] = mq[2]; s.q[3] = mq[3];
        if (alive) quat_to_euler_deg(s.roll, s.pitch, s.yaw);

        // battery: 12-bit ADC through the divider, over-sampled to denoise
        uint32_t raw = 0;
        for (int i = 0; i < 4; i++) raw += analogRead(PIN_BATT_ADC);
        s.battery_mv = (uint16_t)((raw / 4) * 3300 / 4095 * BATT_DIVIDER);

        // THE WATCHDOG: the link's death is checked here, on the flight core,
        // every cycle. THE TWO CLOCKS: 500 ms of silence → the controlled
        // descent (STABILIZED); in AUTONOMOUS_MESH the mission has a longer
        // fuse — > 2 s of mesh death engages the RTH (the nav module flies
        // her home instead of dropping her in a field).
        zola_failsafe::check_watchdog(millis());

        // THE MODE IS THE FIRST GATE — this is what the draft never wired:
        // a parsed command that nothing enforces is a decoration. The mode
        // can override the cascade outright (disarm / descent).
        uint16_t mode_throttle[4];  // the failsafe's override values (uint16 — the wire unit)
        if (zola_failsafe::enforce(millis(), (float)THROTTLE_HOVER_US, mode_throttle)) {
            for (int i = 0; i < 4; i++) { motors[i] = mode_throttle[i]; s.motors[i] = mode_throttle[i]; }
            rate_roll.reset(); rate_pitch.reset(); rate_yaw.reset();
            publish_flight(s);
            dshot_send_all(s.motors);
            vTaskDelayUntil(&last, period);
            continue;   // the cascade never ran this cycle — the mode owns it
        }

        // THE AUTONOMOUS MESH: when the mode is AUTONOMOUS_MESH, the nav
        // module's mission runs — the active waypoint (or the RTH target) is
        // computed here; the STEERING (bearing → rate setpoints) is the
        // bench phase, so the loop holds the level cascade meanwhile. The
        // mesh-alive fuse is the failsafe's clock: > 2 s silent → RTH.
        if (zola_failsafe::mode() == zola_failsafe::FlightMode::AUTONOMOUS_MESH) {
            static uint32_t last_nav_log = 0;
            zola_nav::Fix f = zola_nav::fix();
            if (f.valid) {
                const bool mesh_alive = zola_failsafe::ms_since_last_command() < 2000;
                auto t = zola_nav::step(f.lat, f.lon, mesh_alive);
                if (t.active && millis() - last_nav_log > 1000) {
                    last_nav_log = millis();
                    Serial.printf("[Zola Nav] target %.6f,%.6f dist %.1f m\n",
                                  t.lat, t.lon,
                                  zola_nav::haversine_m(f.lat, f.lon, t.lat, t.lon));
                }
            }
        }

        // THE CASCADE (v3): angle error → target rates → rate PID → mixer.
        // Level hold: the target attitude is 0°/0° (the bench phase adds a
        // real attitude setpoint); the yaw holds the MAG-FUSED heading (the
        // long-term drift the accel alone cannot see is now corrected).
        const float dt = 1.f / FLIGHT_HZ;
        // THE HOLD TARGETS are captured when she ENTERS a flight mode (arm or
        // the mission start) — NOT "once ever": a re-arm must capture the
        // new hover altitude and the new heading, not chase the old ones.
        static float alt_target = -1000.f, heading_target = 0.f;
        static zola_failsafe::FlightMode last_mode = zola_failsafe::FlightMode::DISARMED;
        auto now_mode = zola_failsafe::mode();
        if (now_mode != last_mode) {
            if (now_mode == zola_failsafe::FlightMode::STABILIZED ||
                now_mode == zola_failsafe::FlightMode::AUTONOMOUS_MESH) {
                alt_target = zola_sensors::altitude_m();      // hold HERE
                heading_target = zola_sensors::heading_deg(); // hold THIS heading
                zola_optical::capture_home();                 // hold THIS POSITION
            }
            // THE EVENT TAG: every mode transition is timestamped in the
            // blackbox — the post-flight FFT correlates against these marks
            const uint8_t mode_detail[8] = {(uint8_t)now_mode};
            zola_blackbox::log_event(
                now_mode == zola_failsafe::FlightMode::FAILSAFE_LAND
                    ? zola_blackbox::EVT_FAILSAFE : zola_blackbox::EVT_MODE_CHANGE,
                millis(), mode_detail);
            last_mode = now_mode;
        }
        // THE VISION POSITION HOLD: when the flow + ToF are healthy, the
        // angle setpoints come from the POSITION error (drift 0.5 m right →
        // bank left) instead of the hardcoded level — GPS-denied hovering
        float hold_roll = 0.f, hold_pitch = 0.f;
        if (alive && zola_optical::flow_healthy() && zola_optical::tof_healthy()) {
            zola_optical::position_hold_angles(hold_roll, hold_pitch);
        }
        float roll_target_rate  = alive ? ANGLE_KP_DPS_PER_DEG * (hold_roll  - s.roll)  : 0.f;
        float pitch_target_rate = alive ? ANGLE_KP_DPS_PER_DEG * (hold_pitch - s.pitch) : 0.f;
        // the heading hold through the SHORT ARC: a 350° → 10° error is +20°,
        // not −340° of spinning
        float heading_err = zola_sensors::heading_deg() - heading_target;
        if (heading_err > 180.f) heading_err -= 360.f;
        if (heading_err < -180.f) heading_err += 360.f;
        float yaw_target_rate = alive ? 4.0f * (0.f - heading_err) : 0.f;
        // THE ALTITUDE HOLD: the baro's error trims the hover throttle; the
        // gains are ASSUMED until the bench.
        float base_us = THROTTLE_HOVER_US;
        {
            float alt_err = alt_target - zola_sensors::altitude_m();
            base_us = constrain(THROTTLE_HOVER_US + 12.f * alt_err,
                                THROTTLE_IDLE_US + 50.f, THROTTLE_MAX_US);
        }
        // the INNER loop: gyro rates (deg/s) vs the target rates — the spec's
        // PID equation, the loop that actually talks to the motors
        float corrR = alive ? rate_roll .update(roll_target_rate,  gx, dt) : 0.f;
        float corrP = alive ? rate_pitch.update(pitch_target_rate, gy, dt) : 0.f;
        float corrY = alive ? rate_yaw  .update(yaw_target_rate,   gz, dt) : 0.f;
        // THE EMERGENCY BRAKE: the OAK-D's 0.7 m override OUTRANKS the PID —
        // its correction is added on top, pushing AWAY from the obstacle
        float brakeR = 0.f, brakeP = 0.f;
        if (zola_obstacle::brake_override(brakeR, brakeP)) {
            corrR += brakeR; corrP += brakeP;
        }
        apply_motor_mix(base_us, corrR, corrP, corrY, motors);

        // THE PDB at 50 Hz (every 10th flight cycle): the hall-effect
        // current/power, the sag tracking, the mAh integral, the thermal state
        if (++pdb_divider >= 10) { pdb_divider = 0; zola_pdb::poll(s.battery_mv); }
        // THE SAG LIMITER: the mixer's ceiling scales with the bus sag so
        // the loaded voltage never crosses the LiPo's premature-cutoff line
        const uint16_t sag_max_us = zola_pdb::sag_limited_max_us(s.battery_mv, THROTTLE_MAX_US);
        // THE THERMAL INTERLOCK: an ESC at 85°C+ brings her home — the PDB
        // says so, the failsafe descends, the blackbox tags the event
        if (zola_pdb::thermal_brake_required()) {
            static uint32_t last_thermal_log = 0;
            if (millis() - last_thermal_log > 2000) {
                last_thermal_log = millis();
                const uint8_t detail[8] = {zola_pdb::esc_temp_max_c()};
                zola_blackbox::log_event(zola_blackbox::EVT_THERMAL_BRAKE, millis(), detail);
                zola_failsafe::request_landing("ESC thermal limit reached");
            }
        }
        // THE LIPO FLOOR: below the cell floor, everything ramps to idle —
        // the battery is never murdered to hold a hover (the sag limiter
        // above already kept the ceiling honest under load)
        if (s.battery_mv && s.battery_mv < BATT_CUTOFF_MV) {
            for (auto& m : motors) m = THROTTLE_IDLE_US;
            rate_roll.reset(); rate_pitch.reset(); rate_yaw.reset();
        }
        const uint16_t ceiling = min(sag_max_us, THROTTLE_MAX_US);
        for (int i = 0; i < 4; i++) s.motors[i] = (uint16_t)constrain(motors[i], (float)THROTTLE_IDLE_US, (float)ceiling);
        publish_flight(s);
        dshot_send_all(s.motors);
        // THE BLACKBOX: the telemetry frame lands in the ring at 100 Hz
        // (every 5th flight cycle at 500 Hz) — events interleave separately
        if (++log_divider >= 5) {
            log_divider = 0;
            ZolaTelemetryPacket bp; bp.header = PKT_HEADER; bp.footer = PKT_FOOTER;
            bp.sequence_id = ++s_log_seq; bp.timestamp_us = micros();
            bp.roll = s.roll; bp.pitch = s.pitch; bp.yaw = s.yaw;
            bp.m1_throttle = s.motors[0]; bp.m2_throttle = s.motors[1];
            bp.m3_throttle = s.motors[2]; bp.m4_throttle = s.motors[3];
            bp.battery_mv = s.battery_mv; bp.crc16 = 0;
            zola_blackbox::log_telemetry((uint8_t*)&bp);
        }
        vTaskDelayUntil(&last, period);
    }
}

// ------------------------------------------- CORE 0: the telemetry task
// TWO SINKS, ONE PACKET: the USB serial line is primary; the Wi-Fi UDP
// broadcast is the fallback/second lane (zola_udp) — byte-identical frames
// on both, so any ground station hears the same truth. The UDP send is
// fire-and-forget: a dead radio can never stall the 100 Hz schedule.
static uint8_t pdb_frame_divider = 0;  // (log/pdb dividers live up top — the compile's lesson)

static void telemetry_task(void*) {
    ZolaTelemetryPacket pkt;  // header/footer pre-set by the member defaults
    uint32_t seq = 0;
    TickType_t last = xTaskGetTickCount();
    const TickType_t period = pdMS_TO_TICKS(1000 / TELEMETRY_HZ);
    uint8_t rxBuf[128];
    for (;;) {
        // THE RETURN PATH: read the ground station's commands — USB serial
        // and the UDP socket both, feeding the same parser (core 0 owns I/O)
        size_t n = 0;
        while (Serial.available() && n < sizeof(rxBuf)) rxBuf[n++] = Serial.read();
        if (n) {
            // THREE parsers share the inbound stream, each owning its own
            // header: the command canon (CA FE), the OTA chunks (0F 0D),
            // and the swarm's OTA relay — the LEADER rebroadcasts the
            // ground's chunks to the fleet while its session is live
            zola_failsafe::feed_bytes(rxBuf, n);
            if (zola_ota::streaming() && zola_swarm::is_leader()) {
                zola_swarm::enqueue_ota_relay(rxBuf, n);
            }
            zola_ota::feed_bytes(rxBuf, n);
        }
        // THE ACK DRAIN: every command gets CONFIRMED back to the ground —
        // inference from telemetry is not confirmation
        uint8_t ack[zola_failsafe::ACK_FRAME_SIZE];
        size_t ack_len;
        while ((ack_len = zola_failsafe::pop_ack(ack)) > 0) {
            Serial.write(ack, ack_len);
#if ZOLA_UDP_TELEMETRY
            zola_udp::broadcast(ack, ack_len);
#endif
        }
        // THE OAK-D's DETECTION STREAM: UART2 feeds the obstacle parser
        while (Serial2.available()) {
            uint8_t ob = (uint8_t)Serial2.read();
            zola_obstacle::feed_bytes(&ob, 1);
        }
        // THE SWARM: the state vector broadcast at 50 Hz (the telemetry task
        // owns the mesh — core 0)
        zola_swarm::publish_local(zola_optical::position_x(), zola_optical::position_y(),
                                  zola_sensors::altitude_m(), zola_sensors::heading_deg(),
                                  zola_nav::waypoint_index(), pkt.battery_mv);
        zola_swarm::poll(millis());
        // THE GPS: line-based NMEA off UART1 (100 Hz is far more than the
        // M8N's update rate — nothing is missed)
        while (Serial1.available()) {
            char c = (char)Serial1.read();
            if (c == '\n') continue;
            if (c == '\r') {
                rxBuf[n] = 0;
                if (n > 0) { zola_nav::feed_nmea_line((char*)rxBuf); n = 0; }
                continue;
            }
            if (n < sizeof(rxBuf) - 1) rxBuf[n++] = c;
        }
#if ZOLA_UDP_TELEMETRY
        uint8_t dgram[64];
        size_t dgram_len;
        while ((dgram_len = zola_udp::poll_inbound(dgram, sizeof(dgram))) > 0) {
            zola_failsafe::feed_bytes(dgram, dgram_len);
        }
#endif
        FlightState s = snapshot_flight();
        pkt.sequence_id = ++seq;
        pkt.timestamp_us = micros();
        pkt.roll = s.roll; pkt.pitch = s.pitch; pkt.yaw = s.yaw;
        pkt.m1_throttle = s.motors[0]; pkt.m2_throttle = s.motors[1];
        pkt.m3_throttle = s.motors[2]; pkt.m4_throttle = s.motors[3];
        pkt.battery_mv = s.battery_mv;
        pkt.crc16 = calculate_zola_crc((uint8_t*)&pkt, sizeof(pkt) - 4);
        Serial.write((uint8_t*)&pkt, sizeof(pkt));
#if ZOLA_UDP_TELEMETRY
        zola_udp::broadcast((uint8_t*)&pkt, sizeof(pkt));
#endif

        // THE PDB FRAME (2 Hz): power/thermal data is not flight-critical —
        // a second packet variant (header FB FC) carries it; the canon is
        // untouched, the bridge and the panel know the type by its header.
        // THE STATE ANNEX rides bytes 27-33: the mode, the sensor health,
        // the waypoint progress, and the swarm role — one frame, both stories
        if (++pdb_frame_divider >= 50) {
            pdb_frame_divider = 0;
            uint8_t sensor_flags = 0;
            if (zola_optical::flow_healthy()) sensor_flags |= 1;
            if (zola_optical::tof_healthy()) sensor_flags |= 2;
            if (zola_sensors::health().mag_ok) sensor_flags |= 4;
            if (zola_sensors::health().baro_ok) sensor_flags |= 8;
            if (zola_sensors::gyro_bias_ready()) sensor_flags |= 16;
            uint8_t pdb_frame[zola_pdb::PDB_FRAME_SIZE];
            const size_t n = zola_pdb::build_frame(pdb_frame, {
                (uint8_t)zola_failsafe::mode(), sensor_flags,
                zola_nav::waypoint_index(), zola_nav::waypoint_count(),
                zola_swarm::leader_id(), zola_swarm::live_peer_count(),
                (uint8_t)zola_obstacle::brake_active()
            });
            Serial.write(pdb_frame, n);
#if ZOLA_UDP_TELEMETRY
            zola_udp::broadcast(pdb_frame, n);
#endif
        }

        // THE BLACKBOX DUMP (post-flight only — the command refuses while armed):
        if (zola_blackbox::dump_active()) {
            uint8_t chunk[256];
            const size_t n = zola_blackbox::dump_next(chunk, sizeof(chunk));
            if (n) Serial.write(chunk, n);
        }

        vTaskDelayUntil(&last, period);
    }
}

void setup() {
    Serial.begin(BAUD);
    Serial.setTxBufferSize(512);
    analogReadResolution(12);
#if ZOLA_UDP_TELEMETRY
    zola_udp::init();  // the Wi-Fi mesh + the UDP socket (non-fatal if it fails)
#endif

    // THE SUPPORT SENSOR BUS FIRST: I2C 8/9 @ 400 kHz is the mag + baro's
    // home (and the IMU's fallback path — same bus, no conflict now)
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);
    const bool baro_ok = zola_sensors::baro_init();
    const bool mag_ok = zola_sensors::mag_init();
    Serial.printf("[Zola Sensors] baro %s · mag %s\n",
                  baro_ok ? "OK" : "MISSING", mag_ok ? "OK" : "MISSING");

    // IMU bring-up: SPI first (the burst path), I2C on the same bus if the
    // SPI WHO_AM_I misses — either way the stream continues
    use_spi = mpu_spi_init();
    if (!use_spi) {
        Wire.beginTransmission(0x68); Wire.write(MPU_PWR_MGMT_1); Wire.write(0x00); Wire.endTransmission();
        Wire.beginTransmission(0x68); Wire.write(MPU_GYRO_CFG);   Wire.write(0x18); Wire.endTransmission();
        Wire.beginTransmission(0x68); Wire.write(MPU_ACCEL_CFG);  Wire.write(0x08); Wire.endTransmission();
    }

    // THE BLACKBOX + THE PDB + THE OTA ROLLBACK GATE: the log's storage is
    // bound (the "zolalog" partition when the CSV carries it, the RAM ring
    // for the bench), the dump command is wired, the PDB's hall-effect
    // front end comes up, and THIS boot's sensor handshake decides whether
    // a freshly OTA'd bank sticks (the 10 s rollback backstop arms inside)
    bind_persistent_storage();
    zola_failsafe::set_dump_hook([]() { zola_blackbox::start_dump(); });
    zola_pdb::init();
    zola_ota::boot_health_gate(baro_ok || use_spi);

    // THE GYRO BIAS CALIBRATION (the spec's 3-second stationary startup):
    // the flight task's first 1500 cycles ARE the calibration — she must be
    // STILL (the pre-arm level check is the operator's promise)
    zola_sensors::start_gyro_bias_calibration();

    // THE GPS: UART1 @ 115200, the M8N's NMEA stream (the nav module parses)
    Serial1.begin(115200, SERIAL_8N1, PIN_GPS_RX, -1);
    // THE VISION STACK + THE OAK-D's DETECTION STREAM (UART2) + THE SWARM
    zola_optical::init();
    Serial2.begin(115200, SERIAL_8N1, 16, 17);  // the OAK-D's obstacle frames
    zola_swarm::set_node_id(1);
    zola_swarm::init();

    // four RMT TX channels — one per DShot line (the module owns the tick:
    // 50 ns, ratio-encoded — the bench scope verifies the absolute rate)
    for (int m = 0; m < 4; m++) zola_dshot::init(m, MOTOR_PINS[m]);

    // THE FAILSAFE'S HOOKS: the arm gate is now the FULL PRE-ARM DIAGNOSTIC
    // (the sensor-health spec): a live IMU, the gyro bias calibrated, the
    // chassis LEVEL within ±3.5°, and the battery above the SPEC'S 11.1 V
    // pre-arm threshold (stricter than the 10.5 V in-flight floor). The
    // gate reads the PUBLISHED state — the SPI bus belongs to core 1 alone.
    zola_failsafe::set_arm_gate([]() -> bool {
        FlightState s = snapshot_flight();
        if (!s.imu_alive) return false;
        if (!zola_sensors::gyro_bias_ready()) return false;
        if (!zola_sensors::level_within(s.roll, s.pitch)) return false;
        if (s.battery_mv != 0 && !zola_sensors::battery_above_pream(s.battery_mv)) return false;
        return true;
    });
    zola_failsafe::set_gain_hook([](const uint8_t* p) {
        const uint8_t axis_mask = p[0] & 0x7;
        float kp, ki;
        memcpy(&kp, p + 1, 4);
        memcpy(&ki, p + 5, 4);
        if (axis_mask & 0x1) { rate_roll.kp = kp; rate_roll.ki = ki; }
        if (axis_mask & 0x2) { rate_pitch.kp = kp; rate_pitch.ki = ki; }
        if (axis_mask & 0x4) { rate_yaw.kp = kp; rate_yaw.ki = ki; }
        Serial.printf("[Zola Tune] rate gains updated (mask 0x%X): kp=%.3f ki=%.3f\n", axis_mask, kp, ki);
    });

    // THE CORE FLIP (this spec's allocation): flight control OWNS core 1 at
    // high priority; telemetry and comms ride core 0.
    xTaskCreatePinnedToCore(flight_control_task, "zola_flight", 8192, nullptr, 10, nullptr, 1);
    xTaskCreatePinnedToCore(telemetry_task,      "zola_tele",  4096, nullptr,  5, nullptr, 0);
}

void loop() {
    // everything lives in the FreeRTOS tasks — the Arduino loop is the idle hook
    vTaskDelay(pdMS_TO_TICKS(1000));
}
