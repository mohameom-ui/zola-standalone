// zola_udp.h — THE WI-FI/UDP TELEMETRY FALLBACK (module interface)
// The wireless lane: the same 36-byte packet canon, broadcast over UDP so
// the ground station hears her when the USB-C serial line isn't there —
// outdoor flight profiles, mesh monitoring, a second operator.
#pragma once
#include <Arduino.h>

namespace zola_udp {

/// Bring up the soft AP (air-gapped mesh: "Zola_Flight_Mesh") and bind the
/// telemetry socket on port 8888. Call once in setup(), AFTER the serial
/// lane is up — USB remains the primary sink, UDP is the fallback/second.
void init();

/// Broadcast one 36-byte packet to the AP subnet's broadcast address
/// (192.168.4.255:8888) — every ground-station node on the mesh hears it.
/// UDP is connectionless and fire-and-forget: a lost datagram is LOST (the
/// sequence id exposes it downstream), never a stall — the flight loop's
/// timing owns the schedule, not the radio.
void broadcast(const uint8_t* packet_bytes, size_t packet_size);

/// True once the AP is up and the socket is bound — the telemetry task
/// consults this before spending its slice on the radio.
bool active();

}  // namespace zola_udp
