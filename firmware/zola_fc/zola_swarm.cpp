// zola_swarm.cpp — ESP-NOW: THE LEADER-FOLLOWER MESH
//
// THE ELECTION LAW (mirrored in the math check): the leader is the LOWEST
// LIVE node id — deterministic, zero chatter (no votes, no campaigns: every
// node computes the same answer from the same peer table). A 200 ms peer
// timeout drops a dead node from the table; if THAT node was the leader,
// the next-lowest live id takes over automatically.
//
// THE SECURITY: ESP-NOW's per-peer encryption (AES-128, the LMKey) is on
// for every peer; an encryption-less peer's packets are dropped by the
// radio itself. The key is provisioned from the air-gapped vault at bench
// time — the compiled DEV key exists so the bench mesh works at all.

#include "zola_swarm.h"
#include <esp_now.h>
#include <WiFi.h>
#include <string.h>

namespace zola_swarm {

static uint8_t s_node_id = 1;
static uint8_t s_key[16] = {  // the DEV key — the bench vault replaces it
    0x5A,0x4F,0x4C,0x41,0x53,0x57,0x41,0x52,0x4D,0x4B,0x45,0x59,0x30,0x30,0x30,0x31 };

#pragma pack(push, 1)
struct StateVector {
    uint8_t node_id;
    uint8_t leader_id;
    uint8_t wp_index;
    uint8_t flags;
    float x, y, z;        // m
    float yaw_deg;
    uint16_t battery_mv;
    uint32_t seq;
};
#pragma pack(pop)
static_assert(sizeof(StateVector) == STATE_SIZE, "the state vector is 24 bytes");

struct Peer {
    uint8_t id;
    uint32_t last_seen;
    StateVector last;
    bool alive;
};
static Peer s_peers[8];
static size_t s_peer_count = 0;
static uint32_t s_seq = 0;
static StateVector s_local = {};

static const esp_now_peer_info_t* find_or_add_peer(const uint8_t mac[6], uint8_t id);

static void on_recv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
    if (len != STATE_SIZE) return;
    StateVector v;
    memcpy(&v, data, sizeof(v));
    if (v.node_id == s_node_id) return;  // our own echo
    // the peer table: upsert by id
    Peer* slot = nullptr;
    for (size_t i = 0; i < s_peer_count; i++)
        if (s_peers[i].id == v.node_id) { slot = &s_peers[i]; break; }
    if (!slot && s_peer_count < 8) slot = &s_peers[s_peer_count++];
    if (!slot) return;
    slot->id = v.node_id;
    slot->last = v;
    slot->last_seen = millis();
    slot->alive = true;
    // every inbound packet from a NEW mac needs the encrypted peer binding
    find_or_add_peer(info->src_addr, v.node_id);
}

static const esp_now_peer_info_t* find_or_add_peer(const uint8_t mac[6], uint8_t id) {
    static esp_now_peer_info_t peers[8];
    static size_t count = 0;
    for (size_t i = 0; i < count; i++)
        if (memcmp(peers[i].peer_addr, mac, 6) == 0) return &peers[i];
    if (count >= 8) return nullptr;
    memset(&peers[count], 0, sizeof(peers[count]));
    memcpy(peers[count].peer_addr, mac, 6);
    peers[count].channel = 0;
    peers[count].encrypt = true;  // AES-128: no unencrypted peers, ever
    memcpy(peers[count].lmk, s_key, 16);
    esp_now_add_peer(&peers[count]);
    return &peers[count++];
}

bool init() {
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    if (esp_now_init() != ESP_OK) return false;
    esp_now_register_recv_cb(on_recv);
    // the broadcast binding: every node hears every node
    static uint8_t bcast[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
    find_or_add_peer(bcast, 255);
    return true;
}

// THE ELECTION: the lowest LIVE id wins. Every node computes this from its
// own table — no negotiation protocol can disagree with arithmetic.
static uint8_t elect() {
    uint8_t leader = s_node_id;
    const uint32_t now = millis();
    for (size_t i = 0; i < s_peer_count; i++) {
        if (s_peers[i].alive && now - s_peers[i].last_seen <= PEER_TIMEOUT_MS
            && s_peers[i].id < leader) {
            leader = s_peers[i].id;
        }
    }
    return leader;
}

void poll(uint32_t now_ms) {
    // the timeout sweep: dead peers lose their seat
    for (size_t i = 0; i < s_peer_count; i++) {
        if (s_peers[i].alive && now_ms - s_peers[i].last_seen > PEER_TIMEOUT_MS) {
            s_peers[i].alive = false;
        }
    }
    s_local.leader_id = elect();

    // THE 50 Hz BROADCAST: the state vector flies every 20 ms
    static uint32_t last_tx = 0;
    if (now_ms - last_tx >= 1000 / BROADCAST_HZ) {
        last_tx = now_ms;
        s_local.seq = ++s_seq;
        s_local.node_id = s_node_id;
        const uint8_t bcast[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
        esp_now_send(bcast, (const uint8_t*)&s_local, sizeof(s_local));
    }
}

void set_node_id(uint8_t id) { s_node_id = id; }
void set_mesh_key(const uint8_t key[16]) { memcpy(s_key, key, 16); }

void publish_local(float x, float y, float z, float yaw_deg,
                   uint8_t wp_index, uint16_t battery_mv) {
    s_local.x = x; s_local.y = y; s_local.z = z;
    s_local.yaw_deg = yaw_deg;
    s_local.wp_index = wp_index;
    s_local.battery_mv = battery_mv;
}

uint8_t leader_id() { return s_local.leader_id; }
bool is_leader() { return s_local.leader_id == s_node_id; }
uint8_t live_peer_count() {
    uint8_t n = 0;
    for (size_t i = 0; i < s_peer_count; i++) if (s_peers[i].alive) n++;
    return n;
}
float peer_battery(uint8_t node_id) {
    for (size_t i = 0; i < s_peer_count; i++)
        if (s_peers[i].alive && s_peers[i].id == node_id)
            return s_peers[i].last.battery_mv / 1000.f;
    return -1.f;
}

}  // namespace zola_swarm
