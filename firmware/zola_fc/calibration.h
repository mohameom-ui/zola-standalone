// calibration.h — THE BENCH CALIBRATION CONSTANTS
// hardware_calibrated: false UNTIL these are filled by the bench campaign
// (docs/BENCH_PLAN.md is the procedure; every entry names its tool and its
// acceptance test). The compiled defaults are the ASSUMED values — a build
// that flies on defaults is a build that has not earned its wings.
//
// The format is deliberately one line per value: CAL_ID, value, // source
#pragma once

namespace zola_cal {

// ---- B-01 THE BATTERY DIVIDER (bench multimeter vs the ADC reading) ----
// measure: a known 12.00 V across the divider → the ADC's reported voltage;
// calibrate BATT_DIVIDER until |reported − true| < 50 mV
inline constexpr float BATT_DIVIDER = 11.0f;          // B-01: (Rtop+Rbot)/Rbot — MEASURED: ___

// ---- B-02 THE HOVER THROTTLE (she neither climbs nor sinks) ----
// measure: hover 10 s; if she climbs, decrease; the value where she holds
inline constexpr uint16_t THROTTLE_HOVER_US = 1150;   // B-02: MEASURED: ___

// ---- B-03 THE RATE-PID GAINS (the step-response sweep) ----
// measure: 10° rate steps per axis; tune kp until the response rings once,
// then kd until it settles, then ki for the steady error
inline constexpr float RATE_KP_ROLL = 1.2f;           // B-03: MEASURED: ___
inline constexpr float RATE_KI_ROLL = 0.05f;
inline constexpr float RATE_KD_ROLL = 0.03f;
inline constexpr float RATE_KP_PITCH = 1.2f;
inline constexpr float RATE_KI_PITCH = 0.05f;
inline constexpr float RATE_KD_PITCH = 0.03f;
inline constexpr float RATE_KP_YAW = 2.5f;            // B-03: MEASURED: ___
inline constexpr float RATE_KI_YAW = 0.10f;

// ---- B-04 THE ANGLE-LOOP GAIN (°/s per °) ----
inline constexpr float ANGLE_KP_DPS_PER_DEG = 8.0f;   // B-04: MEASURED: ___

// ---- B-05 THE BARO's SEA-LEVEL PRESSURE (the day's + the site's) ----
inline constexpr float SEA_LEVEL_HPA = 1013.25f;      // B-05: from a reference station

// ---- B-06 THE COMPASS DECLINATION (the site's magnetic declination) ----
inline constexpr float DECLINATION_DEG = 0.0f;        // B-06: from WMM/the local chart

// ---- B-07 THE OPTICAL FLOW SCALE (a known-speed slide at a known height) ----
inline constexpr float FLOW_RAD_PER_COUNT = 0.00061697f;  // B-07: the vendor's value until B-07

// ---- B-08 THE INA226's SHUNT CALIBRATION (the measured shunt + the clamp) ----
inline constexpr float INA_SHUNT_OHMS = 0.002f;       // B-08: MEASURED: ___
inline constexpr float INA_MAX_AMPS = 8.0f;

// ---- B-09 THE OTA + MESH KEYS (provisioned from the vault, NEVER committed) ----
// the DEV keys compile for the bench; production keys are flashed per node
// from the TPM 2.0 vault at provisioning time — the git history must never
// carry a production key
inline constexpr bool KEYS_PROVISIONED = false;       // B-09: true after the vault

// ---- B-10 THE DSHOT600 RMT TICK (the scope's verdict on the waveform) ----
inline constexpr uint32_t RMT_TICK_NS = 50;           // B-10: scope-verified: ___

}  // namespace zola_cal
