// zola_blackbox.cpp — THE RING BUFFER + EVENT TAGS + THE DUMP
//
// THE RING: records append sequentially; at the partition's end the cursor
// WRAPS to 0 — the oldest data is overwritten first, which is exactly what
// a flight log wants (the most recent flight is always fully on board).
// THE DRAFT'S SPEED MANDATE: the 100 Hz loop cannot wait on flash — the
// write is one partition append (flash program time ~0.7 ms worst case per
// 256-byte page: within the 10 ms budget, verified on the bench).

#include "zola_blackbox.h"
#include <string.h>

namespace zola_blackbox {

static bool (*s_write)(uint32_t, const uint8_t*, size_t) = nullptr;
static uint32_t s_capacity = PARTITION_BYTES;
static uint32_t s_cursor = 0;          // the write cursor (a record index)
static uint32_t s_records = 0, s_events = 0;

static constexpr size_t DUMP_CHUNK_MAX = 240;  // the bridge's serial frame budget

void bind_storage(bool (*page_writer)(uint32_t, const uint8_t*, size_t len),
                  uint32_t capacity_bytes) {
    s_write = page_writer;
    s_capacity = capacity_bytes;
    s_cursor = 0;
    s_records = s_events = 0;
}

// THE RING ARITHMETIC (mirrored): the cursor is a RECORD index; the byte
// offset is cursor × RECORD_BYTES; the wrap test is against the LAST FULL
// record — a partial record never straddles the partition's end.
uint32_t next_record_offset(uint32_t cursor) {
    uint32_t offset = cursor * RECORD_BYTES;
    if (offset + RECORD_BYTES > s_capacity) return 0;  // wrap to the ring's head
    return offset;
}

bool wraps(uint32_t cursor) {
    return cursor * RECORD_BYTES + RECORD_BYTES > s_capacity;
}

uint32_t capacity_records() { return s_capacity / RECORD_BYTES; }

static void append(uint8_t type, const uint8_t* payload) {
    if (!s_write) return;
    const uint32_t offset = next_record_offset(s_cursor);
    uint8_t record[RECORD_BYTES];
    record[0] = type;
    memcpy(record + 1, payload, FRAME_BYTES);
    s_write(offset, record, RECORD_BYTES);
    s_cursor = wraps(s_cursor) ? 0 : s_cursor + 1;
    if (type == REC_TELEMETRY) s_records++;
    else s_events++;
}

void log_telemetry(const uint8_t* frame) { append(REC_TELEMETRY, frame); }

void log_event(uint8_t event_id, uint32_t timestamp_ms, const uint8_t* detail) {
    uint8_t payload[FRAME_BYTES] = {0};
    payload[0] = event_id;
    memcpy(payload + 1, &timestamp_ms, 4);
    if (detail) memcpy(payload + 5, detail, 8);
    append(REC_EVENT, payload);
}

uint32_t records_written() { return s_records; }
uint32_t events_written() { return s_events; }

// ---- the dump ----
static void (*s_read)(uint32_t offset, uint8_t* out, size_t len) = nullptr;
static bool s_dumping = false;
static uint32_t s_dump_cursor = 0;
static uint16_t s_dump_seq = 0;

void start_dump() {
    s_dumping = s_write != nullptr;
    s_dump_cursor = 0;
    s_dump_seq = 0;
}

bool dump_active() { return s_dumping; }

size_t dump_next(uint8_t* out, size_t max_bytes) {
    if (!s_dumping) return 0;
    if (max_bytes < 14) return 0;  // the framing: 2+2+4+2 header/len + 2 crc
    const size_t payload = (max_bytes - 10) < DUMP_CHUNK_MAX ? (max_bytes - 10) : DUMP_CHUNK_MAX;
    // THE CHUNK: framing [FD 0D][u16 seq][u32 byte-offset][u16 len][data][crc]
    // — offset-based so the receiver reassembles out-of-order chunks.
    const uint32_t byte_offset = s_dump_cursor * RECORD_BYTES;
    size_t len = payload;
    if (byte_offset + len > s_capacity) len = 0;  // past the ring: the dump ends
    uint8_t* p = out;
    *p++ = DUMP_HEADER[0]; *p++ = DUMP_HEADER[1];
    memcpy(p, &s_dump_seq, 2); p += 2;
    memcpy(p, &byte_offset, 4); p += 4;
    memcpy(p, &len, 2); p += 2;
    if (len) {
        // the storage reader hook — the engine binds a page reader too
        if (s_read) s_read(byte_offset, p, len);
    }
    const uint16_t crc = calculate_zola_crc_public(out, (size_t)(p - out) + len);
    memcpy(p + len, &crc, 2);
    p += len + 2;
    s_dump_cursor++;
    s_dump_seq++;
    if (len == 0 || byte_offset + len >= s_capacity) s_dumping = false;
    return (size_t)(p - out);
}

}  // namespace zola_blackbox

// the engine's CRC routine, exposed for the dump framing (a narrow bridge —
// the canon's one CRC everywhere)
uint16_t calculate_zola_crc_public(const uint8_t* data, size_t length) {
    extern uint16_t calculate_zola_crc(const uint8_t*, size_t);
    return calculate_zola_crc(data, length);
}
