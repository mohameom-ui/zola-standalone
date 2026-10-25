#!/usr/bin/env python3
"""
Zola ground relay — pymavlink edition.

Bridges the browser brain to an ArduPilot flight controller over MAVLink.
PX4 OFFBOARD mode is not implemented by this relay.

Protocol (matches MavLinkBridgeHAL in src/lib/pet/hardware.ts):
  handshake : {"t":"auth", "token":"..."} -> {"t":"auth", "ok":true}
  in : {"t":"vel", "vx":f, "vy":f, "vz":f, "yaw":f, "led":"#rrggbb"}  (normalized -1..1)
       {"t":"start"}  GUIDED + arm + takeoff
       {"t":"stop"}   land; disarm only after fresh position confirms ground contact
  out: {"t":"pose", "x","y","z","yaw","pitch","roll","battery","flying","led"}

Safety: speed clamp, geofence, 1.5 s command watchdog, fresh battery gate,
low/stale-battery landing, and Ctrl-C landing request.

Run:  python aura_relay.py --connection tcp:127.0.0.1:5760  (ArduPilot SITL)
      python aura_relay.py --connection /dev/serial0 --baud 57600  (hardware)

The WebSocket binds to loopback by default. A non-loopback bind requires the
ZOLA_RELAY_TOKEN environment variable and browser-side token entry.
"""

import argparse
import asyncio
import hmac
import ipaddress
import json
import math
import os
import threading
import time

import websockets
from pymavlink import mavutil

MAX_SPEED_MPS = 2.0
GEOFENCE = {"x": 2.0, "y": 2.0, "z_min": 0.15, "z_max": 2.5}
WATCHDOG_S = 1.5
BATTERY_TAKEOFF = 0.15
BATTERY_LAND = 0.15
BATTERY_TELEMETRY_TTL_S = 3.0
TAKEOFF_ALT_M = 0.8
LAND_CONFIRM_TIMEOUT_S = 45.0
WS_HOST = "127.0.0.1"
WS_PORT = 8765
RELAY_TOKEN = os.environ.get("ZOLA_RELAY_TOKEN", "")

lock = threading.Lock()
flight_command_lock = threading.Lock()
start_cancel_event = threading.Event()
state = {
    "cmd": {"vx": 0.0, "vy": 0.0, "vz": 0.0, "yaw": 0.0},
    "last_cmd": 0.0,
    "led": "#f0b90b",
    "pos": {"x": 0.0, "y": 0.0, "z": 0.0},
    "position_at": None,
    "yaw": 0.0,
    "pitch": 0.0,
    "roll": 0.0,
    "battery": None,
    "battery_at": None,
    "autopilot": None,
    "ekf_ready": False,
    "flying": False,
    "starting": False,
    "landing_requested": False,
    "clients": set(),
}

MASTER = None
RELAXED = False


def clamp(value, low, high):
    return max(low, min(high, value))


def telemetry_is_fresh(timestamp, now=None):
    return timestamp is not None and (now or time.time()) - timestamp <= BATTERY_TELEMETRY_TTL_S


# ---------------------------------------------------------------- MAVLink I/O

def gcs_heartbeat_loop():
    """Keep ArduPilot's GCS heartbeat alive."""
    while True:
        try:
            with flight_command_lock:
                MASTER.mav.heartbeat_send(
                    mavutil.mavlink.MAV_TYPE_GCS,
                    mavutil.mavlink.MAV_AUTOPILOT_INVALID,
                    0, 0, 0, 0,
                )
        except Exception:
            pass
        time.sleep(1)


def connect_with_retry(connection, retries=8, baud=57600):
    """Open a UART/TCP/UDP link and reject a phantom (system 0) connection."""
    global MASTER
    for attempt in range(1, retries + 1):
        m = None
        try:
            if connection.startswith("/") or connection.startswith("COM"):
                m = mavutil.mavlink_connection(connection, baud=baud)
            else:
                m = mavutil.mavlink_connection(connection)
            m.mav.heartbeat_send(
                mavutil.mavlink.MAV_TYPE_GCS,
                mavutil.mavlink.MAV_AUTOPILOT_INVALID,
                0, 0, 0, 0,
            )
            heartbeat = m.wait_heartbeat(timeout=5)
            if m.target_system == 0 or heartbeat is None:
                raise RuntimeError("no heartbeat received (phantom link)")
            with lock:
                state["autopilot"] = heartbeat.autopilot
            MASTER = m
            return
        except Exception as exc:
            if m is not None:
                try:
                    m.close()
                except Exception:
                    pass
            print(f"[relay] link attempt {attempt} failed ({exc}) — retrying")
            time.sleep(2)
    raise RuntimeError("could not establish MAVLink link")


def reader_loop():
    """Single MAVLink reader thread; all telemetry consumers use shared state."""
    while True:
        msg = MASTER.recv_match(blocking=True, timeout=1)
        if msg is None:
            continue
        kind = msg.get_type()
        if kind == "STATUSTEXT":
            print(f"[FC says] {msg.text}")
        with lock:
            if kind == "ATTITUDE":
                if all(math.isfinite(value) for value in (msg.yaw, msg.pitch, msg.roll)):
                    state["yaw"] = msg.yaw
                    state["pitch"] = msg.pitch
                    state["roll"] = msg.roll
            elif kind == "SYS_STATUS":
                remaining = msg.battery_remaining
                if remaining is not None and math.isfinite(remaining) and remaining >= 0:
                    state["battery"] = clamp(remaining / 100.0, 0.0, 1.0)
                    state["battery_at"] = time.time()
            elif kind == "LOCAL_POSITION_NED":
                if all(math.isfinite(value) for value in (msg.x, msg.y, msg.z)):
                    state["pos"] = {"x": msg.x, "y": msg.y, "z": max(0.0, -msg.z)}
                    state["position_at"] = time.time()
            elif kind == "EKF_STATUS_REPORT":
                flags = msg.flags
                state["ekf_ready"] = bool(
                    flags & mavutil.mavlink.EKF_POS_HORIZ_ABS
                    and flags & mavutil.mavlink.EKF_POS_VERT_ABS
                )
            elif kind == "HEARTBEAT" and msg.type != mavutil.mavlink.MAV_TYPE_GCS:
                state["autopilot"] = msg.autopilot
                state["flying"] = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)


def land():
    """Send NAV_LAND in order with arm, takeoff, and velocity commands."""
    with flight_command_lock:
        MASTER.mav.command_long_send(
            MASTER.target_system, MASTER.target_component,
            mavutil.mavlink.MAV_CMD_NAV_LAND, 0, 0, 0, 0, 0, 0, 0, 0,
        )


def command_loop():
    """Send clamped local velocity setpoints and run relay-side failsafes."""
    last = time.time()
    desired_yaw = None
    while True:
        now = time.time()
        dt = min(0.5, max(0.0, now - last))
        last = now
        if state["starting"] or state["landing_requested"]:
            time.sleep(0.1)
            continue

        with lock:
            command = dict(state["cmd"])
            command_fresh = now - state["last_cmd"] < WATCHDOG_S and bool(state["clients"])
            yaw = state["yaw"]
            position = dict(state["pos"])
            position_at = state["position_at"]
            flying = state["flying"]
            battery = state["battery"]
            battery_at = state["battery_at"]
            if not telemetry_is_fresh(battery_at, now):
                battery = None

        if not command_fresh or not flying:
            command = {"vx": 0.0, "vy": 0.0, "vz": 0.0, "yaw": 0.0}

        # Body-frame x/y commands become north/east velocity in local NED.
        cos_yaw, sin_yaw = math.cos(yaw), math.sin(yaw)
        north = command["vx"] * MAX_SPEED_MPS * cos_yaw - command["vy"] * MAX_SPEED_MPS * sin_yaw
        east = command["vx"] * MAX_SPEED_MPS * sin_yaw + command["vy"] * MAX_SPEED_MPS * cos_yaw
        down = -command["vz"] * MAX_SPEED_MPS  # browser z-up -> NED down

        if abs(position["x"]) > GEOFENCE["x"] and north * math.copysign(1, position["x"]) > 0:
            north = 0.0
        if abs(position["y"]) > GEOFENCE["y"] and east * math.copysign(1, position["y"]) > 0:
            east = 0.0
        if position["z"] < GEOFENCE["z_min"]:
            down = max(down, 0.0)
        if position["z"] > GEOFENCE["z_max"]:
            down = min(down, 0.0)

        with lock:
            # Do not overwrite a newer position message with dead reckoning.
            if state["position_at"] == position_at and not (
                position_at is not None and now - position_at < 1.0
            ):
                state["pos"] = {
                    "x": clamp(position["x"] + north * dt, -GEOFENCE["x"], GEOFENCE["x"]),
                    "y": clamp(position["y"] + east * dt, -GEOFENCE["y"], GEOFENCE["y"]),
                    "z": clamp(position["z"] - down * dt, 0.0, GEOFENCE["z_max"]),
                }
            if desired_yaw is None:
                desired_yaw = yaw
            desired_yaw = (desired_yaw + command["yaw"] * 90.0 * dt + math.pi) % (2 * math.pi) - math.pi

        type_mask = 0b0000111110000111  # use velocity + yaw; ignore position, accel, yaw rate
        try:
            with flight_command_lock:
                MASTER.mav.set_position_target_local_ned_send(
                    0, MASTER.target_system, MASTER.target_component,
                    mavutil.mavlink.MAV_FRAME_LOCAL_NED,
                    type_mask, 0, 0, 0,
                    north, east, down,
                    0, 0, 0,
                    math.degrees(desired_yaw), 0,
                )
        except Exception as exc:
            print(f"[relay] velocity send failed — {exc}")

        reason = None
        if flying and (battery is None or battery < BATTERY_LAND):
            reason = "battery telemetry lost" if battery is None else f"battery {battery:.0%}"
        elif flying and not command_fresh:
            reason = "browser command watchdog expired"
        if reason:
            with lock:
                request_landing = not state["landing_requested"]
                state["landing_requested"] = True
            if request_landing:
                start_cancel_event.set()
                print(f"[relay] FAILSAFE — {reason}; requesting a controlled landing")
                threading.Thread(target=stop_flight, daemon=True).start()

        time.sleep(0.1)


def start_flight():
    """Start ArduPilot GUIDED flight after fresh checks; honor cancel promptly."""
    with lock:
        if state["starting"] or state["landing_requested"]:
            print("[relay] takeoff refused — another flight operation is in progress")
            return
        start_cancel_event.clear()
        state["starting"] = True
        battery = state["battery"]
        battery_at = state["battery_at"]
        autopilot = state["autopilot"]
        already_armed = state["flying"]
        state["cmd"] = {"vx": 0.0, "vy": 0.0, "vz": 0.0, "yaw": 0.0}
        state["last_cmd"] = 0.0

    takeoff_sent = False
    try:
        if already_armed:
            print("[relay] takeoff refused — flight controller is already armed")
            return
        if autopilot != mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA:
            print(f"[relay] takeoff refused — ArduPilot is required (autopilot id: {autopilot})")
            return
        if battery is None or not telemetry_is_fresh(battery_at):
            print("[relay] takeoff refused — fresh battery telemetry is unavailable")
            return
        if battery < BATTERY_TAKEOFF:
            print(f"[relay] takeoff refused — battery {battery:.0%} is below {BATTERY_TAKEOFF:.0%}")
            return
        if start_cancel_event.is_set():
            print("[relay] takeoff cancelled by the operator")
            return

        if RELAXED:
            print("[relay] RELAXED ARMING — disabling arming checks (SITL ONLY)")
            MASTER.param_set_send("ARMING_CHECK", 0.0)
            if start_cancel_event.wait(1):
                print("[relay] takeoff cancelled by the operator")
                return

        print("[relay] waiting for the navigation filter (EKF) to settle...")
        deadline = time.time() + 60
        ekf_ready = False
        while time.time() < deadline and not start_cancel_event.is_set():
            with lock:
                ekf_ready = state["ekf_ready"]
            if ekf_ready:
                break
            start_cancel_event.wait(0.25)
        if start_cancel_event.is_set():
            print("[relay] takeoff cancelled by the operator")
            return
        if not ekf_ready:
            print("[relay] takeoff refused — EKF position is not ready")
            return

        with lock:
            battery = state["battery"]
            battery_at = state["battery_at"]
        if battery is None or not telemetry_is_fresh(battery_at) or battery < BATTERY_TAKEOFF:
            print("[relay] takeoff refused — battery telemetry went stale during EKF wait")
            return

        mode_set = False
        for attempt in range(5):
            with flight_command_lock:
                if start_cancel_event.is_set():
                    print("[relay] takeoff cancelled by the operator")
                    return
                MASTER.set_mode_apm("GUIDED")
            if start_cancel_event.wait(1):
                print("[relay] takeoff cancelled by the operator")
                return
            if MASTER.flightmode == "GUIDED":
                mode_set = True
                break
            print(f"[relay] mode change retry {attempt + 1}...")
        if not mode_set:
            print(f"[relay] takeoff refused — GUIDED mode was not accepted (mode: {MASTER.flightmode})")
            return

        armed = False
        for attempt in range(6):
            with lock:
                battery = state["battery"]
                battery_at = state["battery_at"]
            if battery is None or not telemetry_is_fresh(battery_at) or battery < BATTERY_TAKEOFF:
                with flight_command_lock:
                    if MASTER.motors_armed():
                        MASTER.disarm()
                print("[relay] takeoff refused — battery telemetry went stale before arming")
                return
            with flight_command_lock:
                if start_cancel_event.is_set():
                    print("[relay] takeoff cancelled before arming")
                    return
                MASTER.arducopter_arm()
            if start_cancel_event.wait(1.5):
                with flight_command_lock:
                    if MASTER.motors_armed():
                        MASTER.disarm()
                print("[relay] takeoff cancelled; arm request stopped")
                return
            if MASTER.motors_armed():
                armed = True
                print("[relay] armed — taking off")
                break
            print(f"[relay] arm rejected (attempt {attempt + 1}) — retrying...")
        if not armed:
            with flight_command_lock:
                if MASTER.motors_armed():
                    MASTER.disarm()
            print("[relay] could not arm — check EKF/GCS failsafes")
            return

        with lock:
            battery = state["battery"]
            battery_at = state["battery_at"]
        if battery is None or not telemetry_is_fresh(battery_at) or battery < BATTERY_TAKEOFF:
            with flight_command_lock:
                MASTER.disarm()
            print("[relay] takeoff refused — fresh battery telemetry was lost before climb")
            return

        with flight_command_lock:
            if start_cancel_event.is_set():
                MASTER.disarm()
                print("[relay] takeoff cancelled before climb")
                return
            MASTER.mav.command_long_send(
                MASTER.target_system, MASTER.target_component,
                mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, 0, TAKEOFF_ALT_M,
            )
            takeoff_sent = True
        if start_cancel_event.wait(4):
            print("[relay] takeoff cancelled; landing request is active")
            return
        print("[relay] ZOLA IS FLYING — the browser brain has the sticks")
    except Exception as exc:
        if not takeoff_sent:
            try:
                with flight_command_lock:
                    if MASTER.motors_armed():
                        MASTER.disarm()
            except Exception:
                pass
        print(f"[relay] takeoff failed — {exc}")
    finally:
        with lock:
            state["starting"] = False


def stop_flight():
    """Land, and disarm only after fresh telemetry confirms ground contact."""
    start_cancel_event.set()
    with lock:
        state["landing_requested"] = True
        armed = state["flying"]
        starting = state["starting"]
    if not armed and not starting:
        with lock:
            state["landing_requested"] = False
        print("[relay] flight controller is already disarmed")
        return

    try:
        land()
    except Exception as exc:
        with lock:
            state["landing_requested"] = False
        print(f"[relay] landing request failed — {exc}; check the flight controller directly")
        return

    print("[relay] landing...")
    deadline = time.time() + LAND_CONFIRM_TIMEOUT_S
    disarm_sent = False
    try:
        while time.time() < deadline:
            with lock:
                armed = state["flying"]
                starting = state["starting"]
                position = dict(state["pos"])
                position_at = state["position_at"]
            if not armed and not starting:
                print("[relay] flight controller reports disarmed — landed")
                return

            position_fresh = telemetry_is_fresh(position_at)
            if armed and not starting and not disarm_sent and position_fresh and position["z"] <= GEOFENCE["z_min"]:
                with flight_command_lock:
                    MASTER.disarm()
                    disarm_sent = True
            time.sleep(0.5)
        print("[relay] landing is not confirmed — leaving the flight controller armed; check it directly")
    except Exception as exc:
        print(f"[relay] landing failed — {exc}; check the flight controller directly")
    finally:
        with lock:
            state["landing_requested"] = False


# ---------------------------------------------------------------- WebSocket
async def ws_handler(ws):
    """Require the configured shared token before accepting any control input."""
    try:
        raw_auth = await asyncio.wait_for(ws.recv(), timeout=5)
        auth = json.loads(raw_auth)
        presented = auth.get("token") if isinstance(auth, dict) and auth.get("t") == "auth" else None
        if RELAY_TOKEN:
            authorized = isinstance(presented, str) and hmac.compare_digest(presented, RELAY_TOKEN)
        else:
            authorized = presented == ""
        await ws.send(json.dumps({"t": "auth", "ok": authorized}))
        if not authorized:
            await ws.close(code=1008, reason="authentication required")
            return
    except (asyncio.TimeoutError, json.JSONDecodeError, websockets.ConnectionClosed):
        try:
            await ws.close(code=1008, reason="authentication required")
        except Exception:
            pass
        return

    with lock:
        state["clients"].add(ws)
        client_count = len(state["clients"])
    print(f"[relay] brain connected ({client_count} total)")
    try:
        async for raw in ws:
            try:
                message = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(message, dict):
                continue
            kind = message.get("t")
            if kind == "vel":
                try:
                    values = {key: float(message.get(key, 0)) for key in ("vx", "vy", "vz", "yaw")}
                except (TypeError, ValueError):
                    continue
                if not all(math.isfinite(value) for value in values.values()):
                    continue
                led = str(message.get("led", "#f0b90b"))
                if not (len(led) == 7 and led[0] == "#" and all(char in "0123456789abcdefABCDEF" for char in led[1:])):
                    led = "#f0b90b"
                with lock:
                    for key, value in values.items():
                        state["cmd"][key] = clamp(value, -1, 1)
                    state["led"] = led
                    state["last_cmd"] = time.time()
            elif kind == "start":
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, start_flight)
            elif kind == "stop":
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, stop_flight)
    except websockets.ConnectionClosed:
        pass
    finally:
        with lock:
            state["clients"].discard(ws)
            client_count = len(state["clients"])
        print(f"[relay] brain disconnected ({client_count} left)")


async def broadcast_loop():
    while True:
        with lock:
            clients = tuple(state["clients"])
            battery = state["battery"]
            battery_at = state["battery_at"]
            if not telemetry_is_fresh(battery_at):
                battery = None
            payload = json.dumps({
                "t": "pose",
                **state["pos"],
                "yaw": state["yaw"],
                "pitch": state["pitch"],
                "roll": state["roll"],
                "battery": battery,
                "rpm": 2400 if state["flying"] else 0,
                "flying": state["flying"],
                "led": state["led"],
            })
        dead = set()
        for client in clients:
            try:
                await client.send(payload)
            except Exception:
                dead.add(client)
        if dead:
            with lock:
                state["clients"].difference_update(dead)
        await asyncio.sleep(0.2)


async def run(connection, baud=57600, ws_host=WS_HOST, ws_port=WS_PORT):
    global MASTER
    print(f"[relay] connecting MAVLink on {connection} ...")
    await asyncio.get_running_loop().run_in_executor(None, connect_with_retry, connection, 8, baud)
    print(f"[relay] FC connected (sys {MASTER.target_system})")
    with flight_command_lock:
        MASTER.mav.request_data_stream_send(
            MASTER.target_system, MASTER.target_component,
            mavutil.mavlink.MAV_DATA_STREAM_ALL, 10, 1,
        )
        MASTER.mav.command_long_send(
            MASTER.target_system, MASTER.target_component,
            mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL, 0, 32, 200000, 0, 0, 0, 0, 0,
        )
    threading.Thread(target=gcs_heartbeat_loop, daemon=True).start()
    threading.Thread(target=reader_loop, daemon=True).start()
    threading.Thread(target=command_loop, daemon=True).start()

    async with websockets.serve(ws_handler, ws_host, ws_port, max_size=16384, ping_interval=20):
        print(f"[relay] WebSocket listening on ws://{ws_host}:{ws_port}")
        print("[relay] READY. The Zola browser brain can connect; flight remains disarmed.")
        await broadcast_loop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Zola ground relay (ArduPilot / pymavlink)")
    parser.add_argument("--connection", default="udpin:0.0.0.0:14551")
    parser.add_argument("--baud", type=int, default=57600,
                        help="UART baud rate for device paths (ArduPilot TELEM default 57600)")
    parser.add_argument("--ws-host", default=os.environ.get("ZOLA_RELAY_HOST", WS_HOST),
                        help="WebSocket bind address; non-loopback requires ZOLA_RELAY_TOKEN")
    parser.add_argument("--ws-port", type=int, default=int(os.environ.get("ZOLA_RELAY_PORT", str(WS_PORT))))
    parser.add_argument("--relaxed-arming", action="store_true",
                        help="disable arming checks (SITL only — never on hardware)")
    args = parser.parse_args()
    try:
        loopback = args.ws_host.lower() == "localhost" or ipaddress.ip_address(args.ws_host).is_loopback
    except ValueError:
        loopback = False
    if not loopback and not RELAY_TOKEN:
        parser.error("non-loopback WebSocket binds require ZOLA_RELAY_TOKEN")

    RELAXED = args.relaxed_arming
    try:
        asyncio.run(run(args.connection, args.baud, args.ws_host, args.ws_port))
    except KeyboardInterrupt:
        print("\n[relay] shutting down — requesting a controlled landing...")
        try:
            stop_flight()
        except Exception as exc:
            print(f"[relay] shutdown landing request failed — {exc}")
