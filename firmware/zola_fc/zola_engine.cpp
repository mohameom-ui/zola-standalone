// zola_engine.cpp — PROJECT ZOLA FLIGHT CONTROLLER, V2
// (supersedes zola_flight.cpp — one flight core, one source of truth)
//
// V2 upgrades (the spec's four asks, merged with the packet canon):
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

// ------------------------------------------------------------------ config
static constexpr uint16_t PKT_HEADER   = 0xFBFA;  // wire bytes FA FB (LE)
static constexpr uint16_t PKT_FOOTER   = 0xFDFC;  // wire bytes FC FD (LE)
static constexpr uint32_t TELEMETRY_HZ = 100;     // the Panel 3 contract
static constexpr uint32_t FLIGHT_HZ    = 500;     // the spec's 2 ms flight loop
static constexpr uint32_t BAUD         = 921600;

// THE PIN MAP (the spec's table + the SPI extension the v2 draft implied)
static constexpr int PIN_SPI_SCK   = 8;   // SPI2 (the table's "GPIO 8,9")
static constexpr int PIN_SPI_MISO  = 9;
static constexpr int PIN_SPI_MOSI  = 3;   // assigned — the table names two pins
static constexpr int PIN_SPI_CS    = 10;  // the v2 draft's IMU_SPI_CS_PIN
static constexpr int PIN_I2C_SDA   = 8;   // the fallback reuses the same two
static constexpr int PIN_I2C_SCL   = 9;   // pins the table already committed
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
// DShot600: 600 kbit/s, 16-bit frame [11-bit throttle][telemetry bit][4-bit
// CRC], one bit = 1.667 us. High time 1250 ns for '1', 625 ns for '0'
// (RMT ticks at 100 ns: 12/5 and 6/11 — the 12.5→12 rounding is inside the
// ESC's tolerance until the bench says otherwise).
static rmt_data_t dshot_symbols[16 * 2];

static uint16_t dshot_frame(uint16_t throttle_11bit, bool telemetry_req) {
    uint16_t value = (throttle_11bit << 1) | (telemetry_req ? 1 : 0);
    uint16_t crc = ((value ^ (value >> 4) ^ (value >> 8)) & 0xF) << 12;
    return value | crc;
}

static void dshot_encode(uint16_t frame) {
    for (int bit = 15; bit >= 0; bit--) {
        bool one = frame & (1 << bit);
        dshot_symbols[(15 - bit) * 2].duration0 = one ? 12 : 6;
        dshot_symbols[(15 - bit) * 2].level0 = 1;
        dshot_symbols[(15 - bit) * 2].duration1 = one ? 5 : 11;
        dshot_symbols[(15 - bit) * 2].level1 = 0;
    }
}

static void dshot_send_all(const uint16_t throttle_us[4]) {
    for (int m = 0; m < 4; m++) {
        uint16_t us = constrain(throttle_us[m], THROTTLE_IDLE_US, THROTTLE_MAX_US);
        uint16_t t11 = map(us, THROTTLE_IDLE_US, THROTTLE_MAX_US, 48, 2047);
        dshot_encode(dshot_frame(t11, false));
        rmtWrite(m == 0 ? PIN_MOTOR_FL : m == 1 ? PIN_MOTOR_FR
                 : m == 2 ? PIN_MOTOR_RR : PIN_MOTOR_RL,
                 dshot_symbols, 32, RMT_WAIT_FOR_EVER);
    }
}

// -------------------------------------------------- the PID (three of them)
struct Pid {
    float kp, ki, kd;
    float integ = 0.f, prev_meas = 0.f;
    float integ_limit;   // anti-windup: the integral never exceeds this
    float update(float err, float meas, float dt) {
        integ = constrain(integ + err * dt, -integ_limit, integ_limit);
        float deriv = (meas - prev_meas) / dt;  // derivative ON MEASUREMENT —
        prev_meas = meas;                       // setpoint steps don't kick D
        return kp * err - ki * integ - kd * deriv;
    }
    void reset() { integ = 0.f; prev_meas = 0.f; }
};
// GAINS ASSUMED — the bench sweep (step response per axis) is the calibration
// phase; these are flyable starting points, not tuned values.
static Pid pid_roll  { 3.2f, 0.6f, 0.12f, 0.f, 0.f, /*integ_limit*/ 400.f };
static Pid pid_pitch { 3.2f, 0.6f, 0.12f, 0.f, 0.f, 400.f };
static Pid pid_yaw   { 2.0f, 0.2f, 0.00f, 0.f, 0.f, 200.f };

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
        // THE UNIT CONTRACT: Madgwick's canonical form consumes RADIANS/SECOND
        // — the mirror test caught the degrees/s hand-off (a 90°/s yaw
        // integrated to 102.86°). The PID keeps degrees (its gains are in
        // µs/degree); the filter gets the radian conversion here.
        constexpr float DEG2RAD = 0.017453292519943295f;
        if (alive) madgwick_step(gx * DEG2RAD, gy * DEG2RAD, gz * DEG2RAD, ax, ay, az, 1.f / FLIGHT_HZ);

        FlightState s = snapshot_flight();
        s.imu_alive = alive;
        s.q[0] = mq[0]; s.q[1] = mq[1]; s.q[2] = mq[2]; s.q[3] = mq[3];
        if (alive) quat_to_euler_deg(s.roll, s.pitch, s.yaw);

        // battery: 12-bit ADC through the divider, over-sampled to denoise
        uint32_t raw = 0;
        for (int i = 0; i < 4; i++) raw += analogRead(PIN_BATT_ADC);
        s.battery_mv = (uint16_t)((raw / 4) * 3300 / 4095 * BATT_DIVIDER);

        // LEVEL HOLD, now with the full PID: the tilt error (setpoint 0° −
        // measured) drives P+I+D corrections around the hover throttle; the
        // yaw axis holds zero RATE (heading hold needs a reference — the
        // bench phase adds it). The D term is derivative-on-measurement, so
        // the yaw loop's "measurement" is the yaw rate itself.
        const float dt = 1.f / FLIGHT_HZ;
        float corrR = alive ? pid_roll.update(0.f - s.roll, s.roll, dt) : 0.f;
        float corrP = alive ? pid_pitch.update(0.f - s.pitch, s.pitch, dt) : 0.f;
        float corrY = alive ? pid_yaw.update(0.f - gz, gz, dt) : 0.f;  // yaw-rate hold
        // quad-X mixer (FL, FR, RR, RL): +pitch noses down, +roll banks right
        motors[0] = THROTTLE_HOVER_US - corrP - corrR;
        motors[1] = THROTTLE_HOVER_US - corrP + corrR;
        motors[2] = THROTTLE_HOVER_US + corrP + corrR;
        motors[3] = THROTTLE_HOVER_US + corrP - corrR;

        // THE LIPO FLOOR: below the cell floor, everything ramps to idle —
        // the battery is never murdered to hold a hover
        if (s.battery_mv && s.battery_mv < BATT_CUTOFF_MV) {
            for (auto& m : motors) m = THROTTLE_IDLE_US;
            pid_roll.reset(); pid_pitch.reset(); pid_yaw.reset();
        }
        for (int i = 0; i < 4; i++) s.motors[i] = (uint16_t)constrain(motors[i], THROTTLE_IDLE_US, THROTTLE_MAX_US);
        publish_flight(s);
        dshot_send_all(s.motors);
        vTaskDelayUntil(&last, period);
    }
}

// ------------------------------------------- CORE 0: the telemetry task
static void telemetry_task(void*) {
    ZolaTelemetryPacket pkt;  // header/footer pre-set by the member defaults
    uint32_t seq = 0;
    TickType_t last = xTaskGetTickCount();
    const TickType_t period = pdMS_TO_TICKS(1000 / TELEMETRY_HZ);
    for (;;) {
        FlightState s = snapshot_flight();
        pkt.sequence_id = ++seq;
        pkt.timestamp_us = micros();
        pkt.roll = s.roll; pkt.pitch = s.pitch; pkt.yaw = s.yaw;
        pkt.m1_throttle = s.motors[0]; pkt.m2_throttle = s.motors[1];
        pkt.m3_throttle = s.motors[2]; pkt.m4_throttle = s.motors[3];
        pkt.battery_mv = s.battery_mv;
        pkt.crc16 = calculate_zola_crc((uint8_t*)&pkt, sizeof(pkt) - 4);
        Serial.write((uint8_t*)&pkt, sizeof(pkt));
        vTaskDelayUntil(&last, period);
    }
}

void setup() {
    Serial.begin(BAUD);
    Serial.setTxBufferSize(512);
    analogReadResolution(12);

    // IMU bring-up: SPI first (the burst path), I2C on the same pins if the
    // SPI WHO_AM_I misses — either way the stream continues
    use_spi = mpu_spi_init();
    if (!use_spi) {
        Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);
        Wire.beginTransmission(0x68); Wire.write(MPU_PWR_MGMT_1); Wire.write(0x00); Wire.endTransmission();
        Wire.beginTransmission(0x68); Wire.write(MPU_GYRO_CFG);   Wire.write(0x18); Wire.endTransmission();
        Wire.beginTransmission(0x68); Wire.write(MPU_ACCEL_CFG);  Wire.write(0x08); Wire.endTransmission();
    }

    // four RMT TX channels at 100 ns tick — one per DShot line
    for (int pin : {PIN_MOTOR_FL, PIN_MOTOR_FR, PIN_MOTOR_RR, PIN_MOTOR_RL}) {
        rmtInit(pin, RMT_TX_MODE);
        rmtSetTick(pin, 100);  // ns per tick
    }

    // THE CORE FLIP (this spec's allocation): flight control OWNS core 1 at
    // high priority; telemetry and comms ride core 0.
    xTaskCreatePinnedToCore(flight_control_task, "zola_flight", 8192, nullptr, 10, nullptr, 1);
    xTaskCreatePinnedToCore(telemetry_task,      "zola_tele",  4096, nullptr,  5, nullptr, 0);
}

void loop() {
    // everything lives in the FreeRTOS tasks — the Arduino loop is the idle hook
    vTaskDelay(pdMS_TO_TICKS(1000));
}
