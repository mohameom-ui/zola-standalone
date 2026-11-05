// zola_ota.cpp — DUAL-BANK FLASH + VERIFICATION + THE ROLLBACK GATE
//
// THE DUAL BANK: the Arduino Update library wraps the ESP32-S3's native
// ota_0/ota_1 partition scheme — Update.begin(IMAGE) targets the INACTIVE
// bank, so a failed update can never touch the running firmware. The
// rollback gate is the second layer: a new image that cannot pass its boot
// health check within 10 s reboots into the previous bank automatically.

#include "zola_ota.h"
#include <Update.h>
#include <esp_ota_ops.h>
#include <esp_timer.h>
#include "mbedtls/sha256.h"
#include "mbedtls/md.h"
#include <string.h>
#include "zola_crc.h"

namespace zola_ota {

static mbedtls_sha256_context s_sha;
static bool s_streaming = false;
static uint32_t s_written = 0, s_total = 0;
static char s_err[64] = "";
static uint8_t s_digest[32];

// THE DEVICE KEY: the HMAC floor's provisioned key (the vault replaces it
// at bench time — same rule as the swarm's mesh key)
static const uint8_t s_dev_key[32] = "zola-ota-dev-key-bench-phase";

static void fail(const char* why) {
    strncpy(s_err, why, sizeof(s_err) - 1);
    s_err[sizeof(s_err) - 1] = 0;
}

const char* last_error() { return s_err; }
bool streaming() { return s_streaming; }

bool begin_start(uint32_t total_size) {
    s_err[0] = 0;
    s_written = 0;
    s_total = total_size;
    mbedtls_sha256_init(&s_sha);
    mbedtls_sha256_starts(&s_sha, 0);
    if (!Update.begin(total_size)) { fail("Update.begin failed — no OTA bank?"); return false; }
    s_streaming = true;
    return true;
}

bool feed_data(const uint8_t* data, size_t len) {
    if (!s_streaming) { fail("no OTA in progress"); return false; }
    mbedtls_sha256_update(&s_sha, data, len);
    const size_t wrote = Update.write(const_cast<uint8_t*>(data), len);  // the Update API takes a non-const buffer — the compile's lesson
    s_written += wrote;
    if (wrote != len) { fail("flash write short"); return false; }
    return true;
}

const uint8_t* running_digest() {
    mbedtls_sha256_finish(&s_sha, s_digest);
    return s_digest;
}

bool commit(const uint8_t sha256[32], const uint8_t* signature, size_t sig_len) {
    if (!s_streaming) { fail("no OTA in progress"); return false; }
    uint8_t actual[32];
    mbedtls_sha256_finish(&s_sha, actual);
    if (memcmp(actual, sha256, 32) != 0) {
        fail("SHA-256 mismatch — the image is truncated or corrupt");
        Update.abort();
        s_streaming = false;
        return false;
    }
#if ZOLA_OTA_ED25519
    // the TPM-vault key's ED25519 verification (mbedtls's ed25519 API)
    // — enabled at the bench when the vault's public key is provisioned
    if (sig_len == 64 && !ed25519_verify(actual, 32, signature)) {
        fail("ED25519 signature REJECTED");
        Update.abort(); s_streaming = false;
        return false;
    }
#else
    // THE GUARANTEED FLOOR: HMAC-SHA256 with the provisioned device key —
    // the ground tool signs the digest with the same key
    uint8_t mac[32];
    mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
                    s_dev_key, sizeof(s_dev_key), actual, 32, mac);
    if (sig_len != 32 || memcmp(mac, signature, 32) != 0) {
        fail("HMAC signature REJECTED — not from the ground station we know");
        Update.abort(); s_streaming = false;
        return false;
    }
#endif
    if (!Update.end(true)) {  // true = the new image is bootable (pending the health gate)
        fail("Update.end failed — the bank is not bootable");
        s_streaming = false;
        return false;
    }
    s_streaming = false;
    return true;  // the reboot happens at the operator's command — not mid-flight
}

void abort_update() {
    if (s_streaming) Update.abort();
    s_streaming = false;
    fail("aborted by the operator");
}

// THE 10-SECOND BACKSTOP: an image that boots but never completes its
// sensor handshake gets reverted by THIS timer — the health gate cancels
// it by marking the bank valid first.
static void rollback_timer_fire(void*) {
    esp_ota_mark_app_invalid_rollback_and_reboot();
}
static esp_timer_handle_t s_rollback_timer = nullptr;
static bool s_gate_armed = false;

// ------------------------------------------------- the inbound stream
// THE OTA FRAME: [0F 0D][phase][seq u16][total u32][offset u32][len u16]
//                [payload len][crc16 over the prefix+payload]
// The commit's payload carries the 32-byte digest + the 64-byte signature.
static constexpr size_t OTA_PREFIX = 15;  // 2 hdr + 1 phase + 2 seq + 4 total + 4 offset + 2 len
// the BIGGEST frame: commit = header + 32-byte digest + 64-byte ED25519
// signature + 2 crc = 112 — the buffer must hold it whole
static uint8_t s_obuf[128];
static size_t s_olen = 0;

void feed_bytes(const uint8_t* data, size_t len) {
    while (len--) {
        if (s_olen < sizeof(s_obuf)) s_obuf[s_olen++] = *data;
        else { memmove(s_obuf, s_obuf + 1, sizeof(s_obuf) - 1); s_obuf[sizeof(s_obuf) - 1] = *data; }
        if (s_olen < 2) continue;
        if (!(s_obuf[0] == 0x0F && s_obuf[1] == 0x0D)) {
            memmove(s_obuf, s_obuf + 1, s_olen - 1); s_olen--;  // not ours — skip
            continue;
        }
        if (s_olen < OTA_PREFIX) continue;  // the fixed prefix is still arriving
        const uint8_t phase = s_obuf[2];
        uint16_t declared; memcpy(&declared, s_obuf + 13, 2);
        const size_t frame_len = OTA_PREFIX + declared + 2;
        if (frame_len > sizeof(s_obuf)) { memmove(s_obuf, s_obuf + 1, s_olen - 1); s_olen--; continue; }
        if (s_olen < frame_len) continue;  // the payload is still arriving
        const uint16_t crc = calculate_zola_crc(s_obuf, OTA_PREFIX + declared);
        uint16_t wire_crc; memcpy(&wire_crc, s_obuf + OTA_PREFIX + declared, 2);
        if (wire_crc != crc) { memmove(s_obuf, s_obuf + 1, s_olen - 1); s_olen--; continue; }
        const uint8_t* payload = s_obuf + OTA_PREFIX;
        switch (phase) {
            case PHASE_START: {
                uint32_t total; memcpy(&total, s_obuf + 5, 4);
                begin_start(total);
                break;
            }
            case PHASE_DATA: {
                feed_data(payload, declared);
                break;
            }
            case PHASE_COMMIT: {
                // the commit's payload: the 32-byte digest + the signature
                if (declared >= 32) commit(payload, payload + 32, declared - 32);
                break;
            }
            case PHASE_ABORT:
                abort_update();
                break;
        }
        memmove(s_obuf, s_obuf + frame_len, s_olen - frame_len);
        s_olen -= frame_len;
    }
}

void boot_health_gate(bool sensors_healthy) {
    if (!s_gate_armed) {
        // arm the 10 s backstop the moment the gate is first consulted
        // (the args struct is designated-initializer territory — the compile
        // taught the field order)
        const esp_timer_create_args_t args = {
            .callback = &rollback_timer_fire,
            .arg = nullptr,
            .dispatch_method = ESP_TIMER_TASK,
            .name = "zola_rollback",
            .skip_unhandled_events = true,
        };
        esp_timer_create(&args, &s_rollback_timer);
        esp_timer_start_once(s_rollback_timer, 10ULL * 1000000ULL);  // 10 s in µs
        s_gate_armed = true;
    }
    if (sensors_healthy) {
        // THE NEW BANK IS GOOD: mark it valid — the rollback fuse is cut
        esp_ota_mark_app_valid_cancel_rollback();
        if (s_rollback_timer) esp_timer_stop(s_rollback_timer);
    } else {
        // THE NEW BANK IS BAD: revert to the previous bank — the fleet
        // cannot be bricked by a bad release
        esp_ota_mark_app_invalid_rollback_and_reboot();
    }
}

}  // namespace zola_ota
