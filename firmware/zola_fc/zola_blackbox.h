// zola_blackbox.h — THE ONBOARD BLACKBOX (module interface)
// A dedicated 8 MB flash partition as a RING BUFFER of 36-byte telemetry
// frames at the full 100 Hz, with EVENT frames interleaved (mode changes,
// failsafe triggers, waypoint arrivals, calibration flags — timestamped).
// A dump command streams the whole log out over the bridge for the
// observability lake; the FFT analysis happens OFFLINE (Scripts/blackbox_fft.py).
#pragma once
#include <Arduino.h>

namespace zola_blackbox {

static constexpr uint32_t PARTITION_BYTES = 8u * 1024 * 1024;   // 8 MB
static constexpr uint32_t FRAME_BYTES = 36;
// a log record: 1 type byte + 36 payload bytes = 37; the ring wraps at the
// partition's last FULL record
static constexpr uint32_t RECORD_BYTES = FRAME_BYTES + 1;

enum RecordType : uint8_t {
    REC_TELEMETRY = 0x01,   // the 36-byte flight frame, verbatim
    REC_EVENT     = 0x02,   // an event tag (the payload's first 4 bytes = ms)
};

enum EventId : uint8_t {
    EVT_MODE_CHANGE = 1,
    EVT_FAILSAFE = 2,
    EVT_WAYPOINT_ARRIVED = 3,
    EVT_CALIBRATION_DONE = 4,
    EVT_ARMED = 5,
    EVT_DISARMED = 6,
    EVT_LOW_BATTERY = 7,
    EVT_THERMAL_BRAKE = 8,
};

/// The abstract flash writer — the real partition layer (the ESP32's
/// esp_partition API) is bound by the engine at boot; the LOGIC here is
/// portable and mirrored in the math check.
void bind_storage(bool (*page_writer)(uint32_t offset, const uint8_t* data, size_t len),
                  uint32_t capacity_bytes);

/// Log one 36-byte telemetry frame (called at 100 Hz — this MUST be fast:
/// it appends to the ring and never blocks).
void log_telemetry(const uint8_t* frame);

/// Log an event tag with a 4-byte timestamp + a 32-byte detail field.
void log_event(uint8_t event_id, uint32_t timestamp_ms, const uint8_t* detail = nullptr);

// ---- the ring buffer's arithmetic (the mirror tests THESE) ----
/// Where the NEXT record lands given the write cursor — and whether the
/// write wraps the partition's end (the caller splits or skips to 0).
uint32_t next_record_offset(uint32_t cursor);
bool wraps(uint32_t cursor);
/// The total record capacity of an 8 MB partition (floor division).
uint32_t capacity_records();

// ---- the dump (a 0x05 command starts it; the flight data streams out) ----
void start_dump();
bool dump_active();
/// Produces the next dump chunk (the caller writes it to the bridge);
/// returns the chunk size, 0 when the dump is complete.
size_t dump_next(uint8_t* out, size_t max_bytes);
/// The dump's framing: [FD 0D][u16 seq][u32 byte-offset][u16 len][data]
/// [crc16 over the prefix+data] — offset-based, so the receiver reassembles
/// even out-of-order chunks.
static constexpr uint8_t DUMP_HEADER[2] = {0xFD, 0x0D};

/// The reader hook (the engine binds the partition's read side).
void bind_reader(void (*page_reader)(uint32_t offset, uint8_t* out, size_t len));

// ---- the stats ----
uint32_t records_written();
uint32_t events_written();

}  // namespace zola_blackbox
