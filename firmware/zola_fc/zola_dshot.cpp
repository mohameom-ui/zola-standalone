// zola_dshot.cpp — THE DSHOT600 RMT DRIVER
// (the motor-driver spec, merged; supersedes the draft's inline code)
//
// THREE DRAFT BUGS FIXED:
//   1. MSB-FIRST: the draft's loop wrote items[i] while iterating i = 15..0,
//      so the MSB landed in the LAST transmitted slot — the frame went out
//      LSB-first, backwards on the wire. Every ESC would have read garbage.
//   2. THE TICK MATH: the draft's clk_div=2 with 75-tick pulses is 1875 ns,
//      not the spec's 1250 ns — and the bit period summed to 2500 ns, not
//      1667. This driver encodes the spec's RATIOS (0.75 / 0.375 high
//      fraction, equal bit periods) at a fixed tick; ESCs decode the RATIO,
//      so the absolute tick scales harmlessly — and the bench scope still
//      verifies the absolute rate (hardware_calibrated: false).
//   3. THE API: the draft used the IDF-v4 legacy rmt_config/rmt_write_items
//      API. This codebase standardizes on the Arduino-ESP32 RMT wrapper
//      (rmtInit/rmtSetTick/rmtWrite) — one API across the whole firmware.
//      NOTE (the compile's lesson): the wrapper wants rmt_obj_t HANDLES —
//      one per motor line — not bare GPIO numbers.
//
// PROTOCOL NOTES:
//   * Throttle 0 is the DISARM command — preserved, never clamped.
//   * 1-47 is the reserved command band (beeps, direction, 3D mode) —
//     clamped to 48 so a runaway value can never fire an ESC command.
//   * ESCs expect CONTINUOUS frames; a silent wire disarms them. The flight
//     loop re-sends every cycle (500 Hz) — that cadence is the keep-alive.

#include "zola_dshot.h"
#include "esp32-hal-rmt.h"

namespace zola_dshot {

uint16_t crc4(uint16_t payload_12bit) {
    return (payload_12bit ^ (payload_12bit >> 4) ^ (payload_12bit >> 8)) & 0xF;
}

uint16_t prepare_packet(uint16_t throttle, bool telemetry_request) {
    if (throttle > THROTTLE_MAX) throttle = THROTTLE_MAX;
    if (throttle > 0 && throttle < THROTTLE_MIN) throttle = THROTTLE_MIN;
    uint16_t payload = (throttle << 1) | (telemetry_request ? 1 : 0);  // 12 bits
    return (payload << 4) | crc4(payload);
}

// the waveform: RMT symbol pairs (high ticks, low ticks) at the configured
// tick — one pair per bit, 16 bits = 32 symbols, MSB transmitted first
static rmt_data_t symbols[16 * 2];
static rmt_obj_t* s_rmt[4] = {nullptr, nullptr, nullptr, nullptr};
static uint16_t s_tick_ns = 50;  // the RMT tick — the bench scope verifies it

void encode_msb_first(uint16_t packet) {
    const float bit_ticks = (float)BIT_NS / (float)s_tick_ns;  // e.g. 33.3 @ 50ns
    const int one_high = (int)(ONE_HIGH_FRACTION * bit_ticks + 0.5f);
    const int zero_high = (int)(ZERO_HIGH_FRACTION * bit_ticks + 0.5f);
    for (int i = 0; i < 16; i++) {
        // MSB-FIRST: index 0 is bit 15 — the first slot transmitted
        const bool one = packet & (0x8000 >> i);
        const int high = one ? one_high : zero_high;
        const int low = (int)bit_ticks - high;
        symbols[i * 2].duration0 = (uint32_t)high;
        symbols[i * 2].level0 = 1;
        symbols[i * 2].duration1 = (uint32_t)low;
        symbols[i * 2].level1 = 0;
    }
}

bool init(int motor_index, gpio_num_t motor_pin) {
    if (motor_index < 0 || motor_index > 3) return false;
    // the Arduino wrapper's signature: rmtInit(pin, tx?, memory block) —
    // RMT_MEM_64 (64 × 32-bit symbols) is ample for a 32-symbol frame
    s_rmt[motor_index] = rmtInit((int)motor_pin, true, RMT_MEM_64);
    if (!s_rmt[motor_index]) return false;
    rmtSetTick(s_rmt[motor_index], (uint8_t)s_tick_ns);
    return true;
}

void send(int motor_index) {
    if (motor_index < 0 || motor_index > 3 || !s_rmt[motor_index]) return;
    rmtWrite(s_rmt[motor_index], symbols, 16 * 2);
}

}  // namespace zola_dshot
