// zola_swarm.h — THE MULTI-AGENT ESP-NOW MESH (module interface)
// Connectionless 2.4 GHz peer-to-peer at 50 Hz: state vectors, waypoint
// indices, battery — AES-128 encrypted with the vault's pre-shared key.
// The leader is deterministic (the lowest live node id) so the mesh never
// flaps; a 200 ms peer timeout re-assigns leadership automatically.
#pragma once
#include <Arduino.h>

namespace zola_swarm {

// THE STATE VECTOR (the 50 Hz broadcast payload, encrypted by ESP-NOW):
//   node_id, leader_id, wp_index, flags, x, y, z (m, float), yaw (deg),
//   battery_mv, seq — 24 bytes packed
static constexpr size_t STATE_SIZE = 24;
static constexpr uint32_t BROADCAST_HZ = 50;
static constexpr uint32_t PEER_TIMEOUT_MS = 200;

/// The node's identity (0-254; 255 = broadcast). Set once in setup().
void set_node_id(uint8_t id);

/// The AES-128 pre-shared key (16 bytes) — provisioned from the secure
/// vault at bench time; the compiled default is the DEV key and the mesh
/// refuses encryption-less peers.
void set_mesh_key(const uint8_t key[16]);

bool init();   // ESP-NOW up + encrypted peers
void poll(uint32_t now_ms);   // the leader election + timeout sweep

/// The flight loop's contribution: the local state vector to broadcast.
void publish_local(float x, float y, float z, float yaw_deg,
                   uint8_t wp_index, uint16_t battery_mv);

// the mesh's view
uint8_t leader_id();
bool is_leader();
uint8_t live_peer_count();
float peer_battery(uint8_t node_id);   // -1 = unknown

}  // namespace zola_swarm
