// zola_nav.cpp — GPS + HAVERSINE + THE WAYPOINT SEQUENCER + RTH
//
// MERGE DECISIONS:
//   * The TWO failsafe clocks: the existing 500 ms link-loss → controlled
//     descent (the failsafe canon — safer, it flies for MANUAL modes); the
//     SPEC's 2 s link-loss → RTH applies in AUTONOMOUS_MESH only — a mesh
//     death mid-mission flies her HOME instead of dropping her in a field.
//   * The arrival radius is 2 m per the spec, configurable.
//   * The nav loop itself (steering the rate setpoints toward the target
//     bearing) is the BENCH PHASE — step() computes the target and the
//     state machine; the flight task logs the active target and holds the
//     level cascade until the nav steering lands. Honest, again.

#include "zola_nav.h"
#include <cmath>

namespace zola_nav {

// ----------------------------------------------------------- NMEA parsing
static Fix s_fix;
static char s_line[100];
static size_t s_line_len = 0;

static double nmea_coord(const char* raw, const char hemi, bool lat) {
    // ddmm.mmmm (lat) / dddmm.mmmm (lon) → decimal degrees
    int deg_digits = lat ? 2 : 3;
    if (strlen(raw) < deg_digits + 3) return 0;
    double deg = 0;
    for (int i = 0; i < deg_digits; i++) deg = deg * 10 + (raw[i] - '0');
    double minutes = atof(raw + deg_digits);
    double value = deg + minutes / 60.0;
    return (hemi == 'S' || hemi == 'W') ? -value : value;
}

// a minimal field-splitting NMEA parse: $--GGA (fix, lat, lon, sats) and
// $--RMC (speed) — the two sentences that carry everything the mission needs
static void parse_sentence(char* line) {
    // the checksum: XOR of all bytes between $ and * — verified before use
    if (line[0] != '$') return;
    char* star = strchr(line, '*');
    if (!star) return;
    uint8_t xsum = 0;
    for (const char* c = line + 1; c < star; c++) xsum ^= (uint8_t)*c;
    uint8_t claimed = (uint8_t)strtol(star + 1, nullptr, 16);
    if (xsum != claimed) return;  // a corrupt sentence is a dropped sentence

    if (strncmp(line + 3, "GGA", 3) == 0) {
        char* save = nullptr;
        char* tok = strtok_r(line, ",", &save);
        tok = strtok_r(nullptr, ",", &save);  // time
        char* lat_raw = strtok_r(nullptr, ",", &save);
        char* lat_hemi = strtok_r(nullptr, ",", &save);
        char* lon_raw = strtok_r(nullptr, ",", &save);
        char* lon_hemi = strtok_r(nullptr, ",", &save);
        strtok_r(nullptr, ",", &save);        // quality
        char* sats = strtok_r(nullptr, ",", &save);
        if (!lat_raw || !lat_hemi || !lon_raw || !lon_hemi) return;
        double lat = nmea_coord(lat_raw, lat_hemi[0], true);
        double lon = nmea_coord(lon_raw, lon_hemi[0], false);
        if (lat == 0 && lon == 0) { s_fix.valid = false; return; }  // no fix yet
        s_fix.lat = lat; s_fix.lon = lon;
        s_fix.valid = true;
        if (sats) s_fix.satellites = (uint8_t)atoi(sats);
    } else if (strncmp(line + 3, "RMC", 3) == 0) {
        char* save = nullptr;
        char* tok = strtok_r(line, ",", &save);
        for (int i = 0; i < 7; i++) tok = strtok_r(nullptr, ",", &save);
        if (tok) s_fix.speed_mps = atof(tok) * 0.514444f;  // knots → m/s
    }
}

void feed_nmea_line(const char* raw) {
    if (s_line_len + strlen(raw) < sizeof(s_line)) {
        strcpy(s_line + s_line_len, raw);
        s_line_len += strlen(raw);
    }
    // a full line ends with \n — the UART reader splits on it
    char* nl = strchr(s_line, '\n');
    if (nl) {
        *nl = 0;
        parse_sentence(s_line);
        s_line_len = 0;
        s_line[0] = 0;
    }
}

// ------------------------------------------------------- the great circle
double haversine_m(double lat1, double lon1, double lat2, double lon2) {
    constexpr double R = 6371000.0;  // the mean Earth radius, metres
    constexpr double DEG = M_PI / 180.0;
    double dlat = (lat2 - lat1) * DEG, dlon = (lon2 - lon1) * DEG;
    double a = sin(dlat / 2) * sin(dlat / 2) +
               cos(lat1 * DEG) * cos(lat2 * DEG) * sin(dlon / 2) * sin(dlon / 2);
    return 2 * R * asin(sqrt(a));
}

double bearing_deg(double lat1, double lon1, double lat2, double lon2) {
    constexpr double DEG = M_PI / 180.0;
    double p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
    double y = sin(dl) * cos(p2);
    double x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl);
    double b = atan2(y, x) / DEG;
    return b < 0 ? b + 360.0 : b;
}

// ------------------------------------------------------- the mission state
static constexpr float ARRIVAL_RADIUS_M = 2.0f;   // the spec's boundary
static double wp_lat[8], wp_lon[8];
static uint8_t s_wp_count = 0, s_wp_index = 0;
static double home_lat = 0, home_lon = 0;
static bool s_mission = false, s_rth = false;

Fix fix() { return s_fix; }

void set_waypoints(double lat[], double lon[], int count) {
    s_wp_count = (uint8_t)(count > 8 ? 8 : count);
    for (int i = 0; i < s_wp_count; i++) { wp_lat[i] = lat[i]; wp_lon[i] = lon[i]; }
    s_wp_index = 0;
}

void begin_mission(double current_lat, double current_lon) {
    home_lat = current_lat; home_lon = current_lon;  // HOME = where she armed
    s_mission = true; s_rth = false; s_wp_index = 0;
}

void clear_mission() { s_mission = false; s_rth = false; s_wp_count = 0; }

Target step(double current_lat, double current_lon, bool mesh_alive) {
    Target t{0, 0, false, false};
    if (!s_mission || s_wp_count == 0) return t;
    if (current_lat == 0 && current_lon == 0) return t;  // no GPS fix

    // THE RTH FLAG: a mesh death > 2 s mid-mission flies her home
    if (!mesh_alive && !s_rth) { s_rth = true; }

    if (s_rth) {
        t.rth = true; t.lat = home_lat; t.lon = home_lon; t.active = true;
        if (haversine_m(current_lat, current_lon, home_lat, home_lon) <= ARRIVAL_RADIUS_M) {
            s_mission = false;  // HOME — the mission (and the RTH) is over
            t.active = false;
        }
        return t;
    }

    t.lat = wp_lat[s_wp_index]; t.lon = wp_lon[s_wp_index]; t.active = true;
    if (haversine_m(current_lat, current_lon, t.lat, t.lon) <= ARRIVAL_RADIUS_M) {
        s_wp_index++;                      // the arrival boundary: next waypoint
        if (s_wp_index >= s_wp_count) {
            s_mission = false;             // the mission is flown
            t.active = false;
        } else {
            t.lat = wp_lat[s_wp_index]; t.lon = wp_lon[s_wp_index];
        }
    }
    return t;
}

uint8_t waypoint_index() { return s_wp_index; }
uint8_t waypoint_count() { return s_wp_count; }

}  // namespace zola_nav
