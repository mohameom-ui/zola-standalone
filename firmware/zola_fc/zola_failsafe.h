// zola_failsafe.h — THE BIDIRECTIONAL COMMAND PARSER + FAILSAFE WATCHDOG
// The closed loop's return path: the ground station (Panel 10 / the master
// kill-switch) speaks to the FC in 16-byte command frames, and the FC's
// flight task ENFORCES the resulting mode every cycle.
#pragma once
#include <Arduino.h>

namespace zola_failsafe {

// ---------------------------------------------------------- the protocol
// 16 bytes, little-endian:
//   [0]  CA FE            header (uint16 LE = 0xFECA)
//   [2]  cmd_id           uint8
//   [3]  payload          9 bytes (layout per command, see below)
//   [12] crc16            uint16 — over bytes [0..11] (everything before it)
//   [14] EF AC            footer (uint16 LE = 0xACEF)
static constexpr size_t CMD_FRAME_SIZE = 16;
static constexpr size_t CMD_CRC_SPAN = 12;   // crc covers header+cmd+payload
static constexpr uint16_t CMD_HEADER = 0xFECA;  // wire bytes CA FE (LE)
static constexpr uint16_t CMD_FOOTER = 0xACEF;  // wire bytes EF AC (LE)

enum CommandId : uint8_t {
    CMD_HEARTBEAT         = 0x00,  // THE MERGE ADDITION — see below
    CMD_ARM               = 0x01,
    CMD_EMERGENCY_DISARM  = 0x02,
    CMD_SET_WAYPOINT      = 0x03,
    CMD_UPDATE_PID        = 0x04,
};

// FlightMode — the state machine the flight task OBEYS every cycle
enum class FlightMode : uint8_t {
    DISARMED = 0,          // motors idle; the boot state
    STABILIZED = 1,        // the cascade (level hold) at the hover throttle
    AUTONOMOUS_MESH = 2,   // waypoint accepted; the nav loop is the bench phase —
                           // flies as STABILIZED until then (documented honestly)
    FAILSAFE_LAND = 3,     // the controlled descent; ends in DISARMED
};

// the payload layouts (9 bytes each):
//   HEARTBEAT:          9 zero bytes (or a counter) — THE LINK'S PULSE
//   ARM:                byte0 MUST be 0xA5 (the interlock token — an
//                       accidental arm is a launch), bytes 1-8 zero
//   EMERGENCY_DISARM:   9 zero bytes — killing must be EASY, no token
//   SET_WAYPOINT:       int16 x_cm, int16 y_cm, int16 z_cm, int16 yaw_cdeg,
//                       byte8 = flags (bit0 orbit)
//   UPDATE_PID:         byte0 = axis mask (bit0 roll, bit1 pitch, bit2 yaw,
//                       0x7 = all), float kp, float ki (kd stays bench-only)
static constexpr uint8_t ARM_TOKEN = 0xA5;

/// THE MERGE ADDITION — a heartbeat command. The spec's failsafe kills the
/// flight 500 ms after the last command, but its own command list is
/// event-driven (arm/disarm/waypoint/gains): nothing flows in steady flight,
/// so EVERY flight would disarm 500 ms after arming. The heartbeat is the
/// link's pulse; the ground station sends it at ≥ 5 Hz.

// ------------------------------------------------------------ the state
FlightMode mode();               // atomic snapshot for any core
const char* mode_name();         // for the log lines
uint32_t ms_since_last_command();

// ---------------------------------------------------------- ingestion
/// Feed ONE 16-byte candidate frame (already resynced by the stream reader).
/// CRC-verified — a frame that fails is counted and IGNORED, never obeyed.
/// Returns true when the frame was valid (regardless of the command's effect).
bool ingest(const uint8_t* frame, size_t len);

/// The stream reader's sliding-window parser: feed raw bytes as they arrive
/// (serial OR UDP reassembly), it resyncs on noise and ingests full frames.
void feed_bytes(const uint8_t* data, size_t len);

/// The watchdog — the flight task calls this EVERY cycle. 500 ms without a
/// valid command while armed → FAILSAFE_LAND.
void check_watchdog(uint32_t now_ms);

/// THE ENFORCEMENT: how the flight task translates the mode into throttle.
///   DISARMED        → idle, PID reset
///   STABILIZED      → the cascade runs (returns false — not overridden)
///   AUTONOMOUS_MESH → the cascade runs (the nav loop is the bench phase)
///   FAILSAFE_LAND   → the controlled descent ramp; ends in DISARMED
/// Returns true when the mode OVERRIDES the cascade (the caller must not
/// run the mixer), writing idle/ramp throttles into out[4].
bool enforce(uint32_t now_ms, float hover_us, uint16_t out[4]);

/// The last waypoint (cm), for the nav phase — set by CMD_SET_WAYPOINT.
struct Waypoint { int16_t x_cm, y_cm, z_cm; int16_t yaw_cdeg; uint8_t flags; };
Waypoint waypoint();

/// The ENGINE fills these (the failsafe module owns neither the IMU nor the
/// PIDs): the arm gate ("may she arm right now?") and the gain setter (the
/// UPDATE_PID payload lands in the engine's PID objects).
void set_arm_gate(bool (*gate)());
void set_gain_hook(void (*hook)(const uint8_t* payload));

}  // namespace zola_failsafe
