// zola_obstacle.cpp — THE COSTMAP + THE EMERGENCY BRAKE
//
// THE DIVISION OF LABOR (the spec's architecture, kept honest): the dense
// disparity work happens on the OAK-D (it has its own AI accelerator); the
// FC receives a LIGHT detection frame per obstacle — the costmap here is
// the LOCAL layer only (the 3 m frustum, 0.5 m cells). The GLOBAL
// re-planning (NetworkX) lives in the AI backend, reached over the swarm
// mesh — the FC asks, the backend answers; the FC never runs graphs.

#include "zola_obstacle.h"
#include "zola_crc.h"

namespace zola_obstacle {

// ---- the detection wire ----
static constexpr uint16_t DETECT_HEADER = 0x5D5A;  // wire bytes 5A 5D (LE)
static constexpr uint16_t DETECT_FOOTER = 0x5A5D;  // wire bytes 5D 5A (LE)
static constexpr size_t DETECT_CRC_SPAN = 12;

// ---- the costmap: forward (x) × lateral (y), 0.5 m cells, 5 m span ----
static constexpr float CELL_M = 0.5f;
static constexpr int GRID_N = 11;                  // 5 m / 0.5 m, centred
static uint8_t s_grid[GRID_N * GRID_N];
static uint32_t s_cell_age[GRID_N * GRID_N];       // occupancy decays
static uint32_t s_last_seen = 0;

// ---- the emergency brake ----
static constexpr float BRAKE_THRESHOLD_M = 0.7f;   // the spec's collision line
static constexpr float BRAKE_KP_US = 220.f;        // µs of correction per braking fraction
static float s_obs_bearing_deg = 0.f;              // 0 = dead ahead
static float s_obs_dist_m = 999.f;
static bool s_braking = false;

using ::calculate_zola_crc;  // the global CRC — the namespace must not own it

static uint8_t s_buf[DETECT_FRAME_SIZE * 2];
static size_t s_len = 0;

void feed_bytes(const uint8_t* data, size_t len) {
    while (len--) {
        if (s_len < sizeof(s_buf)) s_buf[s_len++] = *data;
        else { memmove(s_buf, s_buf + 1, sizeof(s_buf) - 1); s_buf[sizeof(s_buf) - 1] = *data; }
        while (s_len >= DETECT_FRAME_SIZE) {
            uint16_t head; memcpy(&head, s_buf, 2);
            if (head != DETECT_HEADER) { memmove(s_buf, s_buf + 1, s_len - 1); s_len--; continue; }
            uint16_t crc; memcpy(&crc, s_buf + 12, 2);
            if (calculate_zola_crc((uint8_t*)s_buf, DETECT_CRC_SPAN) != crc) {
                memmove(s_buf, s_buf + 1, s_len - 1); s_len--; continue;
            }
            int16_t bearing_cdeg; uint16_t dist_mm, height_mm;
            memcpy(&bearing_cdeg, s_buf + 2, 2);
            memcpy(&dist_mm, s_buf + 4, 2);
            memcpy(&height_mm, s_buf + 6, 2);
            s_obs_bearing_deg = bearing_cdeg / 100.f;
            s_obs_dist_m = dist_mm / 1000.f;
            s_last_seen = millis();
            // THE COSTMAP: the obstacle's polar coords → the grid cell
            const float fwd = s_obs_dist_m * cosf(s_obs_bearing_deg * 0.017453f);
            const float lat = s_obs_dist_m * sinf(s_obs_bearing_deg * 0.017453f);
            const int ix = (int)roundf(fwd / CELL_M) + GRID_N / 2;
            const int iy = (int)roundf(lat / CELL_M) + GRID_N / 2;
            if (ix >= 0 && ix < GRID_N && iy >= 0 && iy < GRID_N) {
                s_grid[ix * GRID_N + iy] = 1;
                s_cell_age[ix * GRID_N + iy] = millis();
            }
            memmove(s_buf, s_buf + DETECT_FRAME_SIZE, s_len - DETECT_FRAME_SIZE);
            s_len -= DETECT_FRAME_SIZE;
            break;
        }
    }
}

bool brake_override(float& roll_corr_us, float& pitch_corr_us) {
    roll_corr_us = 0; pitch_corr_us = 0;
    s_braking = s_obs_dist_m < BRAKE_THRESHOLD_M && (millis() - s_last_seen) < 300;
    if (!s_braking) return false;
    // THE BRAKING VECTOR: push AWAY from the obstacle. Bearing 0 (dead
    // ahead) → pitch brake (nose up away); bearing +90 (right side) → roll
    // brake LEFT. The strength ramps linearly as the distance closes.
    const float strength = (BRAKE_THRESHOLD_M - s_obs_dist_m) / BRAKE_THRESHOLD_M;
    const float mag = BRAKE_KP_US * strength;
    const float rad = s_obs_bearing_deg * 0.017453f;
    pitch_corr_us = mag * cosf(rad);   // an ahead-obstacle: nose-away pitch
    roll_corr_us  = -mag * sinf(rad);  // a right-side obstacle: brake LEFT
    return true;
}

uint8_t costmap_cell(float forward_m, float lateral_m) {
    const int ix = (int)roundf(forward_m / CELL_M) + GRID_N / 2;
    const int iy = (int)roundf(lateral_m / CELL_M) + GRID_N / 2;
    if (ix < 0 || ix >= GRID_N || iy < 0 || iy >= GRID_N) return 0;
    return s_grid[ix * GRID_N + iy];
}

void costmap_snapshot(uint8_t* out, size_t max) {
    if (max >= sizeof(s_grid)) memcpy(out, s_grid, sizeof(s_grid));
}

bool recently_seen(uint32_t within_ms) { return (millis() - s_last_seen) < within_ms; }
bool brake_active() { return s_braking; }

}  // namespace zola_obstacle
