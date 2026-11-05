// zola_flight.cpp — PROJECT ZOLA FLIGHT CONTROLLER FIRMWARE
// Target: ESP32-S3 (dual-core 240 MHz) — the FC lane of the hardware tier.
//
// THE PACKET CANON (36 bytes, little-endian, 100 Hz over UART0 @ 921600):
//   [0]  FA FB            header  (uint16 LE = 0xFBFA)
//   [2]  sequence_id      uint32
//   [6]  timestamp_us     uint32
//   [10] roll,pitch,yaw   3 x float32, DEGREES
//   [22] m1..m4 throttle  4 x uint16, microseconds (1000-2000)
//   [30] battery_mv       uint16
//   [32] crc16            uint16 — over bytes [0..31], reflected poly 0xA001,
//                         init 0xFFFF (the MODBUS-style table; the spec called
//                         it CCITT — the ALGORITHM is the contract, both ends
//                         run the identical routine, see bridge/zola_bridge.py)
//   [34] FC FD            footer  (uint16 LE = 0xFDFC)
//
// MERGE NOTE: the draft firmware used 0xFBFB/0xFDFD — contradicting the
// spec's own packet table (FA FB / FC FD). The TABLE wins; both ends here
// implement the table.
//
// FreeRTOS: stabilization owns Core 0 (IMU + Mahony AHRS + DShot600 out at
// 1 kHz, priority high); telemetry owns Core 1 (100 Hz packing + UART,
// priority low). Attitude state crosses cores through a spinlock-guarded
// snapshot — the stabilizer never waits on telemetry, and telemetry never
// tears a frame.
//
// HARDWARE HONESTY: the DShot600 RMT waveform, the MPU range setup, and the
// battery divider constant are engineering-accurate but UNCALIBRATED until
// the bench runs — hardware_calibrated: false, same contract as Isaac.

#include <Arduino.h>
#include <Wire.h>
#include "esp32-hal.h"
#include "esp32-hal-rmt.h"

// ------------------------------------------------------------------ config
static constexpr uint16_t PKT_HEADER   = 0xFBFA;  // wire bytes FA FB (LE)
static constexpr uint16_t PKT_FOOTER   = 0xFDFC;  // wire bytes FC FD (LE)
static constexpr uint32_t TELEMETRY_HZ = 100;
static constexpr uint32_t STAB_HZ      = 1000;
static constexpr uint32_t BAUD         = 921600;

// THE PIN MAP (the spec's table — the single source for the wiring printout)
static constexpr int PIN_IMU_SDA   = 8;   // I2C bus for the MPU (SPI2 alt: 9)
static constexpr int PIN_IMU_SCL   = 9;
static constexpr int PIN_MOTOR_FL  = 5;   // motor 1, front-left
static constexpr int PIN_MOTOR_FR  = 18;  // motor 2, front-right
static constexpr int PIN_MOTOR_RR  = 19;  // motor 3, rear-right
static constexpr int PIN_MOTOR_RL  = 15;  // motor 4, rear-left
static constexpr int PIN_BATT_ADC  = 25;  // voltage divider tap

static constexpr float BATT_DIVIDER = 11.0f;   // (Rtop+Rbot)/Rbot — MEASURE ME
static constexpr uint16_t BATT_CUTOFF_MV = 10500;  // 3S: 3.5 V/cell floor
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
    float roll = 0.f, pitch = 0.f, yaw = 0.f;   // degrees (Mahony output)
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
// CRC], inverted on the wire (a '1' is a SHORT-high... no: a '1' is the LONG
// high pulse). Bit period 1.667 us; high time 1250 ns for '1', 625 ns for '0'
// (RMT ticks at 100 ns: 12/5 and 6/11 — the 12.5→12 rounding is inside the
// ESC's tolerance until the bench says otherwise).
static rmt_data_t dshot_symbols[16 * 2];

static uint16_t dshot_frame(uint16_t throttle_11bit, bool telemetry_req) {
    uint16_t value = (throttle_11bit << 1) | (telemetry_req ? 1 : 0);
    uint16_t crc = ((value ^ (value >> 4) ^ (value >> 8)) & 0xF) << 12;
    return value | crc;  // value already holds the CRC nibble here
}

static void dshot_encode(uint16_t frame) {
    for (int bit = 15; bit >= 0; bit--) {
        bool one = frame & (1 << bit);
        dshot_symbols[(15 - bit) * 2].duration0 = one ? 12 : 6;   // high ticks
        dshot_symbols[(15 - bit) * 2].level0 = 1;
        dshot_symbols[(15 - bit) * 2].duration1 = one ? 5 : 11;   // low ticks
        dshot_symbols[(15 - bit) * 2].level1 = 0;
    }
}

static void dshot_send_all(const uint16_t throttle_us[4]) {
    // microseconds (1000-2000) → DShot 11-bit (48-2047)
    for (int m = 0; m < 4; m++) {
        uint16_t us = throttle_us[m];
        us = constrain(us, THROTTLE_IDLE_US, THROTTLE_MAX_US);
        uint16_t t11 = map(us, THROTTLE_IDLE_US, THROTTLE_MAX_US, 48, 2047);
        dshot_encode(dshot_frame(t11, false));
        rmtWrite(m == 0 ? PIN_MOTOR_FL : m == 1 ? PIN_MOTOR_FR
                 : m == 2 ? PIN_MOTOR_RR : PIN_MOTOR_RL,
                 dshot_symbols, 32, RMT_WAIT_FOR_EVER);
    }
}

// --------------------------------------------------------------- MPU (I2C)
static constexpr uint8_t MPU_ADDR = 0x68;
static constexpr uint8_t MPU_WHO_AM_I = 0x75;
static constexpr uint8_t MPU_PWR_MGMT_1 = 0x6B;
static constexpr uint8_t MPU_ACCEL_XOUT = 0x3B;
static constexpr uint8_t MPU_GYRO_CFG = 0x1B;    // ±2000 dps  → 16.4 LSB/dps
static constexpr uint8_t MPU_ACCEL_CFG = 0x1C;   // ±4g        → 8192 LSB/g
static constexpr float GYRO_LSB_DPS = (1.f / 16.4f);
static constexpr float ACCEL_LSB_G = (1.f / 8192.f);

static bool mpu_read(float& gx, float& gy, float& gz, float& ax, float& ay, float& az) {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(MPU_ACCEL_XOUT);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(MPU_ADDR, 14) != 14) return false;
    auto r16 = []() { return (int16_t)((Wire.read() << 8) | Wire.read()); };
    r16(); r16(); r16();                    // accel temp skip → handled below
    int16_t axr = r16(); int16_t ayr = r16(); int16_t azr = r16();
    int16_t temp = r16(); (void)temp;
    int16_t gxr = r16(); int16_t gyr = r16(); int16_t gzr = r16();
    ax = axr * ACCEL_LSB_G; ay = ayr * ACCEL_LSB_G; az = azr * ACCEL_LSB_G;
    gx = gxr * GYRO_LSB_DPS; gy = gyr * GYRO_LSB_DPS; gz = gzr * GYRO_LSB_DPS;
    return true;
}

// ---------------------------------------------------------- Mahony AHRS
static float q0 = 1.f, q1 = 0.f, q2 = 0.f, q3 = 0.f;  // body→world quaternion
static float mahony_kp = 0.5f, mahony_ki = 0.f;
static float ix = 0.f, iy = 0.f, iz = 0.f;

static void mahony_update(float gx, float gy, float gz, float ax, float ay, float az, float dt) {
    // 6-axis Mahony: the gyro integrates; the accelerometer pulls the drift
    float norm = sqrtf(ax*ax + ay*ay + az*az);
    if (norm > 1e-6f) {
        ax /= norm; ay /= norm; az /= norm;
        float vx = q1*q3 - q0*q2, vy = q0*q1 + q2*q3, vz = q0*q0 - 0.5f + q3*q3;
        float ex = (ay*vz - az*vy), ey = (az*vx - ax*vz), ez = (ax*vy - ay*vx);
        ix += mahony_ki * ex * dt; iy += mahony_ki * ey * dt; iz += mahony_ki * ez * dt;
        gx += mahony_kp*ex + ix; gy += mahony_kp*ey + iy; gz += mahony_kp*ez + iz;
    }
    float qDot1 = 0.5f * (-q1*gx - q2*gy - q3*gz);
    float qDot2 = 0.5f * ( q0*gx + q2*gz - q3*gy);
    float qDot3 = 0.5f * ( q0*gy - q1*gz + q3*gx);
    float qDot4 = 0.5f * ( q0*gz + q1*gy - q2*gx);
    q0 += qDot1*dt; q1 += qDot2*dt; q2 += qDot3*dt; q3 += qDot4*dt;
    norm = sqrtf(q0*q0 + q1*q1 + q2*q2 + q3*q3);
    q0 /= norm; q1 /= norm; q2 /= norm; q3 /= norm;
}

static void quat_to_euler_deg(float& roll, float& pitch, float& yaw) {
    roll  = atan2f(2*(q0*q1 + q2*q3), 1 - 2*(q1*q1 + q2*q2)) * 57.2958f;
    pitch = asinf(constrain(2*(q0*q2 - q3*q1), -1.f, 1.f)) * 57.2958f;
    yaw   = atan2f(2*(q0*q3 + q1*q2), 1 - 2*(q2*q2 + q3*q3)) * 57.2958f;
}

// ------------------------------------------------- Core 0: the stabilizer
static void stabilization_task(void*) {
    TickType_t last = xTaskGetTickCount();
    const TickType_t period = pdMS_TO_TICKS(1000 / STAB_HZ);
    float motors[4];
    for (;;) {
        float gx, gy, gz, ax, ay, az;
        bool alive = mpu_read(gx, gy, gz, ax, ay, az);
        if (alive) mahony_update(gx, gy, gz, ax, ay, az, 1.f / STAB_HZ);

        FlightState s = snapshot_flight();
        s.imu_alive = alive;
        if (alive) quat_to_euler_deg(s.roll, s.pitch, s.yaw);

        // battery: 12-bit ADC through the divider, over-sample to denoise
        uint32_t raw = 0;
        for (int i = 0; i < 4; i++) raw += analogRead(PIN_BATT_ADC);
        s.battery_mv = (uint16_t)((raw / 4) * 3300 / 4095 * BATT_DIVIDER);

        // THE LEVEL-HOLD BASELINE: hover throttle + P-only angle correction.
        // P gains are ASSUMED until the bench sweep — hardware_calibrated: false.
        constexpr float Kp_deg = 4.0f;  // us per degree of tilt
        float corr_roll  = alive ? -Kp_deg * s.roll  : 0.f;
        float corr_pitch = alive ? -Kp_deg * s.pitch : 0.f;
        // quad-X mixer (FL, FR, RR, RL)
        motors[0] = THROTTLE_HOVER_US + corr_pitch + corr_roll;
        motors[1] = THROTTLE_HOVER_US + corr_pitch - corr_roll;
        motors[2] = THROTTLE_HOVER_US - corr_pitch - corr_roll;
        motors[3] = THROTTLE_HOVER_US - corr_pitch + corr_roll;

        // THE LIPO FLOOR: below the cell floor, everything ramps to idle —
        // the battery is never murdered to hold a hover
        if (s.battery_mv && s.battery_mv < BATT_CUTOFF_MV) {
            for (auto& m : motors) m = THROTTLE_IDLE_US;
        }
        for (int i = 0; i < 4; i++) s.motors[i] = (uint16_t)constrain(motors[i], THROTTLE_IDLE_US, THROTTLE_MAX_US);
        publish_flight(s);
        dshot_send_all(s.motors);
        vTaskDelayUntil(&last, period);
    }
}

// ------------------------------------------------ Core 1: the telemetrarian
static void telemetry_task(void*) {
    ZolaTelemetryPacket pkt;  // header/footer pre-set by the defaults
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
    Wire.begin(PIN_IMU_SDA, PIN_IMU_SCL, 400000);

    // MPU wake + ranges (failures leave imu_alive=false — the stream continues)
    Wire.beginTransmission(MPU_ADDR); Wire.write(MPU_PWR_MGMT_1); Wire.write(0x00); Wire.endTransmission();
    Wire.beginTransmission(MPU_ADDR); Wire.write(MPU_GYRO_CFG);   Wire.write(0x18); Wire.endTransmission();
    Wire.beginTransmission(MPU_ADDR); Wire.write(MPU_ACCEL_CFG);  Wire.write(0x08); Wire.endTransmission();

    // four RMT TX channels at 100 ns tick — one per DShot line
    for (int pin : {PIN_MOTOR_FL, PIN_MOTOR_FR, PIN_MOTOR_RR, PIN_MOTOR_RL}) {
        rmtInit(pin, RMT_TX_MODE);
        rmtSetTick(pin, 100);  // ns per tick
    }

    // the stabilizer OWNS core 0 at high priority; telemetry rides core 1
    xTaskCreatePinnedToCore(stabilization_task, "zola_stab", 8192, nullptr, 10, nullptr, 0);
    xTaskCreatePinnedToCore(telemetry_task,   "zola_tele", 4096, nullptr,  5, nullptr, 1);
}

void loop() {
    // everything lives in the FreeRTOS tasks — the Arduino loop is the idle hook
    vTaskDelay(pdMS_TO_TICKS(1000));
}
