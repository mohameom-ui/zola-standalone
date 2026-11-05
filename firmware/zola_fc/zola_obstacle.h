// zola_obstacle.h — THE DEPTH SENSING + EMERGENCY BRAKING (module interface)
// The OAK-D Lite streams obstacle detections (a compact 16-byte frame over
// UART2/USB — the dense disparity lives on the OAK-D itself); this module
// keeps the local occupancy grid and owns the 0.7 m emergency-brake override
// that outranks the mixer's corrections.
#pragma once
#include <Arduino.h>

namespace zola_obstacle {

// THE DETECTION FRAME (16 bytes, from the OAK-D's companion stream):
//   [0] 5A 5D · [2] bearing int16 (centi-degrees, 0 = dead ahead) ·
//   [4] distance uint16 (mm) · [6] height uint16 (mm) · [8] class uint8 ·
//   [9] flags uint8 · [10] seq uint16 · [12] crc16 (bytes 0..11) · [14] 5D 5A
static constexpr size_t DETECT_FRAME_SIZE = 16;

/// Feed raw bytes (the UART reader's stream) — resyncs on noise, verifies CRC.
void feed_bytes(const uint8_t* data, size_t len);

/// The braking override, called by the flight task BEFORE the mixer:
/// writes extra roll/pitch corrections (µs) that push AWAY from the
/// obstacle when it breaches the 0.7 m threshold; returns true when braking.
bool brake_override(float& roll_corr_us, float& pitch_corr_us);

/// The local costmap (5 m × 5 m at 0.5 m resolution, the 3 m frustum
/// populated) — the AI backend's pathfinder receives this over the mesh.
uint8_t costmap_cell(float forward_m, float lateral_m);  // 1 = occupied
void costmap_snapshot(uint8_t* out, size_t max);         // row-major 11×11

bool recently_seen(uint32_t within_ms);
bool brake_active();   // the braking override's current state (the telemetry annex)

}  // namespace zola_obstacle
