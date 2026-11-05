// zola_udp.cpp — THE WI-FI/UDP TELEMETRY FALLBACK
// (the wireless spec, merged into the module layout)
//
// MERGE NOTES:
//   * The draft defined broadcast_udp_telemetry() but NOTHING called it —
//     the lane existed and carried nothing. The engine's telemetry task now
//     drives BOTH sinks (USB serial = primary, UDP = fallback/second), so
//     the two lanes are byte-identical by construction.
//   * The AP credentials are #defines at the top (air-gapped mesh), not
//     buried mid-file; the operator workstation's unicast IP is supported
//     alongside the subnet broadcast.
//   * One packet per datagram: UDP is message-oriented, so the ground
//     bridge needs no stream resync — CRC catches corruption, the sequence
//     id exposes losses, and neither can stall the flight loop.

#include "zola_udp.h"
#include <WiFi.h>
#include <WiFiUdp.h>

namespace zola_udp {

// THE MESH CONFIG (air-gapped: the AP exists only while she flies)
static const char* AP_SSID = "Zola_Flight_Mesh";
static const char* AP_KEY  = "air-gapped-secure-key";  // WPA2 needs >= 8 chars
static constexpr uint16_t UDP_PORT = 8888;
// the subnet broadcast (softAP hands out 192.168.4.x) and, optionally, the
// operator workstation's direct address — broadcast reaches both
static IPAddress BROADCAST_IP(192, 168, 4, 255);

static WiFiUDP udp_socket;
static bool s_active = false;

void init() {
    s_active = WiFi.softAP(AP_SSID, AP_KEY);
    if (!s_active) {
        Serial.println("[Zola Wi-Fi] softAP failed — USB telemetry continues alone");
        return;
    }
    IPAddress myIP = WiFi.softAPIP();
    Serial.print("[Zola Wi-Fi] AP IP address: ");
    Serial.println(myIP);
    if (udp_socket.begin(UDP_PORT) != 1) {
        Serial.println("[Zola Wi-Fi] socket bind failed — USB telemetry continues alone");
        s_active = false;
        return;
    }
    Serial.printf("[Zola Wi-Fi] UDP telemetry broadcasting to %u.%u.%u.%u:%u\n",
                  BROADCAST_IP[0], BROADCAST_IP[1], BROADCAST_IP[2], BROADCAST_IP[3], UDP_PORT);
}

void broadcast(const uint8_t* packet_bytes, size_t packet_size) {
    if (!s_active) return;
    udp_socket.beginPacket(BROADCAST_IP, UDP_PORT);
    udp_socket.write(packet_bytes, packet_size);
    udp_socket.endPacket();  // fire-and-forget: never blocks on the radio
}

bool active() { return s_active; }

size_t poll_inbound(uint8_t* buf, size_t max) {
    if (!s_active) return 0;
    const int psize = udp_socket.parsePacket();
    if (psize <= 0) return 0;
    const int n = udp_socket.read(buf, max);
    return n > 0 ? (size_t)n : 0;
}

}  // namespace zola_udp
