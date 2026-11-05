// zola_nav.h — AUTONOMOUS WAYPOINT NAVIGATION (module interface)
// GPS (UART1 @ 115200, NMEA) → position; Haversine → distance + bearing to
// the active waypoint; a 2 m arrival boundary advances the mission; the RTH
// flag returns her to launch when the mesh dies > 2 s in AUTONOMOUS_MESH.
#pragma once
#include <Arduino.h>

namespace zola_nav {

struct Fix {
    bool valid = false;
    double lat = 0, lon = 0;      // degrees
    float speed_mps = 0;
    uint8_t satellites = 0;
};

/// The GPS fix (refreshed by poll()).
Fix fix();

/// Feed one NMEA sentence (the UART1 reader hands full lines over).
void feed_nmea_line(const char* line);

/// Haversine: the great-circle distance (metres) between two WGS84 points.
double haversine_m(double lat1, double lon1, double lat2, double lon2);

/// The initial bearing (degrees, 0 = north, clockwise) from → to.
double bearing_deg(double lat1, double lon1, double lat2, double lon2);

// ------------------------------------------------------- the mission
void set_waypoints(double lat[], double lon[], int count);  // degrees
void begin_mission(double current_lat, double current_lon); // records HOME
void clear_mission();

/// The mission step: advances on the 2 m arrival boundary; RTH engages when
/// the mesh has been dead > 2 s in AUTONOMOUS_MESH. Returns the ACTIVE
/// target (lat/lon), and writes `done` when the mission (or the RTH) is over.
struct Target { double lat, lon; bool active; bool rth; };
Target step(double current_lat, double current_lon, bool mesh_alive);

uint8_t waypoint_index();
uint8_t waypoint_count();

}  // namespace zola_nav
