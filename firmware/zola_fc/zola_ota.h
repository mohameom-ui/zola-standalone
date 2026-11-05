// zola_ota.h — CRYPTOGRAPHIC OVER-THE-AIR FIRMWARE UPDATES (module interface)
// Dual-bank (the ESP32-S3's native ota_0/ota_1) + signature verification +
// the mesh-relayed chunk protocol + the automated rollback safeguard.
#pragma once
#include <Arduino.h>

namespace zola_ota {

// THE OTA FRAME (over the serial/UDP data lane; the mesh relay is the
// leader's job — chunks are ≤ 240 bytes per ESP-NOW's MTU):
//   [0] 0F 0D · [1] phase (0=start, 1=data, 2=end-commit, 3=abort) ·
//   [2] seq uint16 · [4] total_size uint32 (start only) ·
//   [8] offset uint32 (data only) · [12] len uint16 ·
//   [14] payload (the firmware bytes, or the 64-byte signature on commit) ·
//   ... crc16 (2 bytes, over everything before it) — the frame ends the chunk
static constexpr uint8_t PHASE_START = 0, PHASE_DATA = 1, PHASE_COMMIT = 2, PHASE_ABORT = 3;

/// THE SIGNATURE SCHEME (the merge decision, stated honestly):
///   * REQUIRED for every image: SHA-256 over the full binary, carried in
///     the commit frame, checked against the streamed bytes — a truncated
///     or corrupted flash can never boot.
///   * THE CRYPTOGRAPHIC LAYER: ED25519 (the TPM 2.0 vault's key) when the
///     core's mbedTLS ships it (the compile flag below); the GUARANTEED
///     floor is HMAC-SHA256 with the device's provisioned key — both are
///     verified in Scripts/zota_ota_tool.py's mirror before any flash.
///     An image that fails verification is REJECTED before Update.end().
#define ZOLA_OTA_ED25519 0  // flipped to 1 when the core's mbedTLS carries it

bool begin_start(uint32_t total_size);           // Update.begin + the budget
bool feed_data(const uint8_t* data, size_t len); // Update.write (the flash stream)
/// commit: the digest + the signature → verify → Update.end(true) →
/// schedule the boot health check. Returns false on ANY verification miss.
bool commit(const uint8_t sha256[32], const uint8_t* signature, size_t sig_len);
void abort_update();
const char* last_error();

/// THE ROLLBACK SAFEGUARD: called in setup() AFTER the sensor handshake.
/// Healthy within 10 s → the image is marked valid (the new bank sticks);
/// the 10 s watchdog expiring or a failed handshake → INVALID + reboot into
/// the previous bank — a bricked fleet cannot happen.
void boot_health_gate(bool sensors_healthy);

/// The SHA-256 streamer (the running digest is kept by feed_data).
const uint8_t* running_digest();

/// THE INBOUND STREAM: feed raw bytes from the command lane; the parser
/// syncs on the 0F 0D header, ignores everything else (the command canon's
/// parser runs beside it — each owns its own header).
void feed_bytes(const uint8_t* data, size_t len);
bool streaming();   // an OTA session is in progress (the relay's gate)

}  // namespace zola_ota
