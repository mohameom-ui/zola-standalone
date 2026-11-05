// zola_failsafe.cpp — THE COMMAND PARSER + FAILSAFE WATCHDOG
//
// THE DRAFT'S THREE CRITICAL GAPS, FIXED:
//   1. NO CRC — the draft obeyed any 16 bytes whose header/footer matched.
//      A corrupted waypoint or a flipped bit in an ARM command is a crash.
//      Every frame is CRC-verified (over bytes 0..11) before it can speak.
//   2. THE MODE WAS DECORATIVE — the draft parsed commands and wrote
//      current_flight_mode, but the flight task never READ it: "EMERGENCY
//      DISARM" disarmed nothing, the motors kept spinning at hover. Here
//      enforce() is the flight loop's FIRST gate — the mode outranks the
//      cascade, every cycle, on core 1.
//   3. THE ONE-WAY TRAP — the draft's ARM only fired from DISARMED, and
//      FAILSAFE_LAND had no exit: after one link loss, only a power cycle
//      could ever fly again. The descent ramp now ENDS in DISARMED, and arm
//      works from DISARMED and FAILSAFE_LAND both.
//
// MERGE ADDITIONS (the failsafe needs them to function at all):
//   * CMD_HEARTBEAT (0x00) — the link's pulse. With event-driven commands
//     only, every flight disarms 500 ms after arming.
//   * THE ARM INTERLOCK — the arm payload must carry 0xA5; an accidental
//     arm is a launch. Disarm deliberately takes NO token: killing must be
//     easy.
//   * THE ARM GATE — arming requires a live IMU and a battery above the
//     cutoff: she will not arm blind or on a dying cell.

#include "zola_failsafe.h"
#include "esp32-hal.h"

extern uint16_t calculate_zola_crc(const uint8_t* data, size_t length);  // the engine's routine

namespace zola_failsafe {

static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static volatile FlightMode s_mode = FlightMode::DISARMED;
static volatile uint32_t s_last_command_ms = 0;
static volatile uint32_t s_bad_frames = 0;
static Waypoint s_wp = {0, 0, 0, 0, 0};

// the FAILSAFE_LAND descent: the throttle decays from the hover over ~3 s,
// then the mode goes DISARMED — a controlled descent, not a drop
static constexpr uint32_t FAILSAFE_TIMEOUT_MS = 500;
static constexpr uint32_t DESCENT_MS = 3000;
static uint32_t s_descent_start = 0;

FlightMode mode() {
    portENTER_CRITICAL(&s_mux);
    FlightMode m = s_mode;
    portEXIT_CRITICAL(&s_mux);
    return m;
}

const char* mode_name() {
    switch (mode()) {
        case FlightMode::STABILIZED: return "STABILIZED";
        case FlightMode::AUTONOMOUS_MESH: return "AUTONOMOUS_MESH";
        case FlightMode::FAILSAFE_LAND: return "FAILSAFE_LAND";
        default: return "DISARMED";
    }
}

uint32_t ms_since_last_command() {
    return millis() - s_last_command_ms;
}

static void set_mode(FlightMode m, const char* why) {
    portENTER_CRITICAL(&s_mux);
    s_mode = m;
    s_last_command_ms = millis();
    portEXIT_CRITICAL(&s_mux);
    Serial.printf("[Zola Safety] mode -> %s (%s)\n", mode_name(), why);
}

Waypoint waypoint() {
    portENTER_CRITICAL(&s_mux);
    Waypoint w = s_wp;
    portEXIT_CRITICAL(&s_mux);
    return w;
}

// the hooks the ENGINE fills (the failsafe module must not own the IMU or the PIDs)
static bool (*s_can_arm)() = nullptr;
void (*s_gain_hook)(const uint8_t* p) = nullptr;

void set_arm_gate(bool (*gate)()) { s_can_arm = gate; }
void set_gain_hook(void (*hook)(const uint8_t* p)) { s_gain_hook = hook; }

static void handle_command(uint8_t id, const uint8_t* p) {
    switch (id) {
        case CMD_HEARTBEAT:
            // the pulse itself: the watchdog refresh already happened in ingest()
            break;
        case CMD_ARM: {
            FlightMode m = mode();
            if (p[0] != ARM_TOKEN) {  // THE INTERLOCK
                Serial.println("[Zola Safety] ARM rejected — missing the 0xA5 interlock token");
                return;
            }
            if (m == FlightMode::DISARMED || m == FlightMode::FAILSAFE_LAND) {
                if (s_can_arm && !s_can_arm()) {  // THE GATE: not blind, not dying
                    Serial.println("[Zola Safety] ARM rejected — IMU dead or battery under the cutoff");
                    return;
                }
                set_mode(FlightMode::STABILIZED, "armed by the operator");
            }
            break;
        }
        case CMD_EMERGENCY_DISARM:
            // THE KILL-SWITCH: immediate, unconditional, every mode
            set_mode(FlightMode::DISARMED, "EMERGENCY DISARM from the operator");
            break;
        case CMD_SET_WAYPOINT: {
            portENTER_CRITICAL(&s_mux);
            s_wp.x_cm = (int16_t)(p[0] | (p[1] << 8));
            s_wp.y_cm = (int16_t)(p[2] | (p[3] << 8));
            s_wp.z_cm = (int16_t)(p[4] | (p[5] << 8));
            s_wp.yaw_cdeg = (int16_t)(p[6] | (p[7] << 8));
            s_wp.flags = p[8];
            portEXIT_CRITICAL(&s_mux);
            if (mode() == FlightMode::STABILIZED) {
                set_mode(FlightMode::AUTONOMOUS_MESH, "waypoint injected from the mesh");
            } else {
                Serial.println("[Zola Navigation] waypoint stored (mode unchanged)");
            }
            // HONESTY: the nav loop that FLIES the waypoint is the bench/next
            // phase — AUTONOMOUS_MESH currently flies the same level-hold
            // cascade as STABILIZED. The waypoint is stored and logged.
            break;
        }
        case CMD_UPDATE_PID: {
            // the engine registers its gain setters (the failsafe module must
            // not own the PID objects — the extern hook below)
            if (s_gain_hook) s_gain_hook(p);
            break;
        }
        default:
            Serial.printf("[Zola Safety] unknown command 0x%02X — ignored\n", id);
            break;
    }
}

// the gain hook (set by the engine; the axis mask + kp + ki payload lands there)
void (*s_gain_hook)(const uint8_t* p) = nullptr;
void set_gain_hook(void (*hook)(const uint8_t* p)) { s_gain_hook = hook; }

bool ingest(const uint8_t* frame, size_t len) {
    if (len != CMD_FRAME_SIZE) { s_bad_frames++; return false; }
    uint16_t header, crc, footer;
    memcpy(&header, frame, 2);
    memcpy(&crc, frame + 12, 2);
    memcpy(&footer, frame + 14, 2);
    if (header != CMD_HEADER || footer != CMD_FOOTER) { s_bad_frames++; return false; }
    if (calculate_zola_crc(frame, CMD_CRC_SPAN) != crc) {
        s_bad_frames++;
        Serial.println("[Zola Safety] command frame FAILED CRC — ignored");
        return false;
    }
    // a VALID command = the link is alive: refresh the watchdog
    portENTER_CRITICAL(&s_mux);
    s_last_command_ms = millis();
    portEXIT_CRITICAL(&s_mux);
    handle_command(frame[2], frame + 3);
    return true;
}

// the sliding-window stream reader: CA FE sync, 16-byte frames, resync on noise
static uint8_t s_buf[CMD_FRAME_SIZE * 2];
static size_t s_len = 0;

void feed_bytes(const uint8_t* data, size_t len) {
    while (len--) {
        const uint8_t byte = *data++;
        if (s_len < sizeof(s_buf)) {
            s_buf[s_len++] = byte;
        } else {  // full: slide one byte out (a long noise burst can't wedge us)
            memmove(s_buf, s_buf + 1, sizeof(s_buf) - 1);
            s_buf[sizeof(s_buf) - 1] = byte;
        }
        while (s_len >= CMD_FRAME_SIZE) {
            uint16_t head;
            memcpy(&head, s_buf, 2);
            if (head != CMD_HEADER) {  // no header at the front: drop one byte
                memmove(s_buf, s_buf + 1, s_len - 1);
                s_len--;
                continue;
            }
            uint8_t candidate[CMD_FRAME_SIZE];
            memcpy(candidate, s_buf, CMD_FRAME_SIZE);
            const bool ok = ingest(candidate, CMD_FRAME_SIZE);
            if (ok) {
                memmove(s_buf, s_buf + CMD_FRAME_SIZE, s_len - CMD_FRAME_SIZE);
                s_len -= CMD_FRAME_SIZE;
                break;  // a full valid frame consumed — next bytes start fresh
            }
            // header matched but the CRC failed: drop ONE byte and keep
            // scanning — the real frame may start one byte deeper
            memmove(s_buf, s_buf + 1, s_len - 1);
            s_len--;
        }
    }
}

void check_watchdog(uint32_t now_ms) {
    FlightMode m = mode();
    if (m == FlightMode::STABILIZED || m == FlightMode::AUTONOMOUS_MESH) {
        if (now_ms - s_last_command_ms > FAILSAFE_TIMEOUT_MS) {
            set_mode(FlightMode::FAILSAFE_LAND, "LINK LOST — initiating the controlled descent");
            s_descent_start = now_ms;
        }
    }
}

bool enforce(uint32_t now_ms, float hover_us, uint16_t out[4]) {
    FlightMode m = mode();
    if (m == FlightMode::DISARMED) {
        for (int i = 0; i < 4; i++) out[i] = 1000;  // idle: the DShot keep-alive
        return true;
    }
    if (m == FlightMode::FAILSAFE_LAND) {
        uint32_t elapsed = now_ms - s_descent_start;
        if (elapsed >= DESCENT_MS) {
            set_mode(FlightMode::DISARMED, "the descent completed — landed");
            for (int i = 0; i < 4; i++) out[i] = 1000;
            return true;
        }
        // the controlled ramp: hover → idle over DESCENT_MS (the cascade is
        // overridden — a descent must not fight the attitude loop at hover)
        float frac = 1.f - (float)elapsed / (float)DESCENT_MS;
        uint16_t throttle = (uint16_t)(1000.f + (hover_us - 1000.f) * frac);
        for (int i = 0; i < 4; i++) out[i] = throttle;
        return true;
    }
    return false;  // STABILIZED / AUTONOMOUS_MESH: the cascade runs
}

}  // namespace zola_failsafe
