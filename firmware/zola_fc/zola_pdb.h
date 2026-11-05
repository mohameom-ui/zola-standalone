// zola_pdb.h — THE SMART POWER DISTRIBUTION BOARD (module interface)
// Hall-effect current/power (the INA226 on the I2C bus), the ESCs' eRPM +
// temperature via the DShot telemetry wire, SAG-COMPENSATED throttle
// limiting, and the 85°C thermal interlock — all surfaced to Panel 3 in a
// SECOND packet variant (the flight canon stays untouched).
#pragma once
#include <Arduino.h>

namespace zola_pdb {

// ---- the PDB FRAME VARIANT (36 bytes — a SIBLING of the flight canon):
//   [0] FB FC   header (uint16 LE = 0xFCFB — wire bytes FB FC)
//   [2] seq     uint32
//   [6] current_mA   uint16 (the Hall-effect total)
//   [8] power_W      uint16 (centi-watts: 1 = 0.01 W)
//   [10] mAh_used    uint16 (the cumulative draw since boot)
//   [12] esc_temp_max_c  uint8
//   [13] sag_mv      uint16 (the instantaneous voltage sag under load)
//   [15] throttle_limit_pct uint8 (the sag limiter's current ceiling)
//   [16] erpm[4]     4 × uint16 (the ESCs' eRPM / 100)
//   [24] v_bus_mv    uint16
//   [26] flags       uint8 (bit0 thermal-brake, bit1 sag-limiting)
//   [27] THE STATE ANNEX (the reserved bytes, repurposed — one variant
//        carries BOTH the power story AND the flight state):
//        [27] mode (the FlightMode) · [28] sensor flags (bit0 flow, bit1
//        tof, bit2 mag, bit3 baro, bit4 bias, bit5 rth) · [29] wp_index ·
//        [30] wp_count · [31] leader_id · [32] live_peers · [33] braking
//   [34] crc16       over bytes 0..33
//   — 36 bytes, no footer needed: the header's position IS the type tag
static constexpr size_t PDB_FRAME_SIZE = 36;

bool init();                      // the INA226's bring-up
void poll(uint16_t v_bus_mv);     // called at ~50 Hz with the flight battery
void feed_esc_telemetry(uint8_t motor, uint32_t erpm, uint8_t temp_c);

// the SAG-COMPENSATED THROTTLE LIMITER: during a high-discharge transient
// the bus sags; the limiter scales the mixer's ceiling so the LiPo never
// hits its premature-cutoff voltage. Returns the max throttle (µs).
uint16_t sag_limited_max_us(uint16_t v_bus_mv, uint16_t nominal_max_us);

// THE THERMAL INTERLOCK: an ESC over 85°C flags the descent (the flight
// task initiates the failsafe-style descent when this returns true).
bool thermal_brake_required();
uint8_t esc_temp_max_c();

// the frame builder for Panel 3 (the bridge relays it verbatim) — the
// engine passes the flight state's snapshot for the annex
struct FlightStateAnnex {
    uint8_t mode; uint8_t sensor_flags; uint8_t wp_index; uint8_t wp_count;
    uint8_t leader_id; uint8_t live_peers; uint8_t braking;
};
size_t build_frame(uint8_t* out, FlightStateAnnex annex);

// the mirror-tested arithmetic
uint32_t erpm_from_telemetry(uint32_t gcr_value);  // the 21-bit period → eRPM
float mah_from_current(uint32_t current_ma, float dt_s, float mAh);

}  // namespace zola_pdb
