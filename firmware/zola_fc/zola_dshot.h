// zola_dshot.h — THE DSHOT600 DRIVER (module interface)
// One RMT channel per motor line (the ESP32-S3 has 8 TX channels; we use 4)
// as rmt_obj_t handles — the compile taught us the wrapper's true shape.
// The pulse timing lives entirely in the RMT hardware — the CPU's only job
// per frame is building 32 rmt symbols, so the 500 Hz flight loop never
// stalls on wire timing and the pulses carry no software jitter.
#pragma once
#include <Arduino.h>

namespace zola_dshot {

// the protocol constants (the spec's timing table, encoded as RATIOS —
// see .cpp for why ratios, not absolute nanoseconds, are the contract)
constexpr uint16_t BIT_NS = 1667;          // DShot600 bit period
constexpr float    ONE_HIGH_FRACTION = 0.75f;  // logic '1'  ≈ 1250/1667
constexpr float    ZERO_HIGH_FRACTION = 0.375f;// logic '0'  ≈ 625/1667
constexpr uint16_t THROTTLE_MIN = 48;      // the reserved band 1-47 ends here
constexpr uint16_t THROTTLE_MAX = 2047;

/// Build the 16-bit DShot frame: [11-bit throttle][telemetry bit][CRC4].
/// Throttle 0 = DISARM (a real command, preserved); 1-47 = the reserved
/// command band (beeps, direction, 3D) — clamped to 48 so a runaway value
/// can never fire an ESC command by accident.
uint16_t prepare_packet(uint16_t throttle, bool telemetry_request);

/// The 4-bit XOR checksum over the 12-bit payload (nibble-wise xor of
/// v, v>>4, v>>8 — identical to the fold form).
uint16_t crc4(uint16_t payload_12bit);

/// Encode the frame MSB-FIRST into RMT symbols and latch them.
/// The ratio-encoded waveform: a '1' is ~75% high, a '0' is ~37.5% high,
/// both bits the same total period — ESCs sample the ratio, so the actual
/// tick duration scales the whole waveform without breaking the decode.
void encode_msb_first(uint16_t packet);

/// One-shot init per motor (index 0-3, its GPIO). Call once in setup().
bool init(int motor_index, gpio_num_t motor_pin);

/// Write the current encoded frame to one motor's channel.
void send(int motor_index);

}  // namespace zola_dshot
