#!/usr/bin/env python3
"""
AURA Ground Relay — pymavlink edition.

Bridges the drone pet's browser brain to a real/virtual flight controller
(PX4 or ArduPilot) over MAVLink. No external binaries needed — pure Python.

Protocol (matches MavLinkBridgeHAL in src/lib/pet/hardware.ts):
  in : {"t":"vel", "vx":f, "vy":f, "vz":f, "yaw":f, "led":"#rrggbb"}  (normalized -1..1)
       {"t":"start"}  arm + guided + takeoff
       {"t":"stop"}   land + disarm
  out: {"t":"pose", "x","y","z","yaw","battery","led"}

Safety (duplicates the browser SafetyGovernor — belt & suspenders):
  speed clamp · geofence box · 1.5 s command watchdog -> hover ·
  auto-land below 15% battery · Ctrl-C -> land + disarm

Run:  python aura_relay.py --connection udpin:0.0.0.0:14551   (ArduPilot SITL)
      python aura_relay.py --connection udpin:0.0.0.0:14540   (PX4 SITL)
"""

import argparse
import asyncio
import json
import math
import threading
import time

import websockets
from pymavlink import mavutil

MAX_SPEED_MPS = 2.0
GEOFENCE = {"x": 2.0, "y": 2.0, "z_min": 0.15, "z_max": 2.5}
WATCHDOG_S = 1.5
BATTERY_LAND = 0.15
TAKEOFF_ALT_M = 0.8

WS_HOST, WS_PORT = "0.0.0.0", 8765

lock = threading.Lock()
state = {
    "cmd": {"vx": 0.0, "vy": 0.0, "vz": 0.0, "yaw": 0.0},
    "last_cmd": 0.0,
    "led": "#f0b90b",
    # telemetry (browser coords: x=depth/north, y=lateral/east, z=up)
    "pos": {"x": 0.0, "y": 0.0, "z": 0.0},
    "yaw": 0.0,
    "battery": 1.0,
    "flying": False,
    "clients": set(),
}

MASTER = None  # set by connect()
RELAXED = False  # --relaxed-arming (SITL only)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ---------------------------------------------------------------- MAVLink I/O

def gcs_heartbeat_loop():
    """GCSs must send heartbeats or ArduPilot drops the link (~10 s)."""
    while True:
        try:
            MASTER.mav.heartbeat_send(
                mavutil.mavlink.MAV_TYPE_GCS,
                mavutil.mavlink.MAV_AUTOPILOT_INVALID,
                0, 0, 0, 0,
            )
        except Exception:
            pass
        time.sleep(1)


def connect_with_retry(connection: str, retries: int = 8, baud: int = 57600):
    """Fresh link + immediate GCS heartbeat, retried until the FC answers.
    WAVE 7 — serial-ready: device paths (/dev/ttyAMA0, /dev/serial0, COM*) get
    the baud passed through (ArduPilot TELEM default 57600, set 921600 for
    high-rate links). TCP/UDP strings are unchanged."""
    global MASTER
    for attempt in range(1, retries + 1):
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
            m.wait_heartbeat(timeout=5)
            if m.target_system == 0:
                # wait_heartbeat can time out SILENTLY — a phantom link (sys 0)
                # must count as failure, or the relay flies into nowhere
                raise RuntimeError("no heartbeat received (phantom link)")
            MASTER = m
            return
        except Exception as e:
            print(f"[relay] link attempt {attempt} failed ({e}) — retrying")
            time.sleep(2)
    raise RuntimeError("could not establish MAVLink link")


def reader_loop():
    """Pull telemetry off the wire into shared state."""
    while True:
        msg = MASTER.recv_match(blocking=True, timeout=1)
        if msg is None:
            continue
        t = msg.get_type()
        if t == "STATUSTEXT":
            print(f"[FC says] {msg.text}")
        with lock:
            if t == "ATTITUDE":
                state["yaw"] = math.radians(msg.yaw)
            elif t == "SYS_STATUS":
                if msg.battery_remaining is not None and msg.battery_remaining >= 0:
                    state["battery"] = clamp(msg.battery_remaining / 100.0, 0.0, 1.0)
            elif t == "LOCAL_POSITION_NED":
                # authoritative local position when the FC provides it
                state["pos"] = {"x": msg.x, "y": msg.y, "z": max(0.0, -msg.z)}
            elif t == "HEARTBEAT" and msg.type != mavutil.mavlink.MAV_TYPE_GCS:
                state["flying"] = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)


def command_loop():
    """Send velocity setpoints at 10 Hz, watchdog + geofence + speed clamp."""
    last = time.time()
    desired_yaw = None
    while True:
        now = time.time()
        dt = min(0.5, now - last)
        last = now
        if state.get("starting"):
            time.sleep(0.1)  # the start/stop sequence has the sticks
            continue
        with lock:
            c = dict(state["cmd"])
            fresh = (now - state["last_cmd"]) < WATCHDOG_S and state["clients"]
            yaw = state["yaw"]
            pos = dict(state["pos"])
            bat = state["battery"]

        if not fresh or not state.get("flying"):
            c = {"vx": 0.0, "vy": 0.0, "vz": 0.0, "yaw": 0.0}  # watchdog: hover

        # body frame -> NED
        cy, sy = math.cos(yaw), math.sin(yaw)
        vn = c["vx"] * MAX_SPEED_MPS * cy - c["vy"] * MAX_SPEED_MPS * sy
        ve = c["vx"] * MAX_SPEED_MPS * sy + c["vy"] * MAX_SPEED_MPS * cy
        vd = -c["vz"] * MAX_SPEED_MPS  # browser z-up -> NED down

        # geofence on integrated position
        if abs(pos["x"]) > GEOFENCE["x"] and vn * math.copysign(1, pos["x"]) > 0:
            vn = 0.0
        if abs(pos["y"]) > GEOFENCE["y"] and ve * math.copysign(1, pos["y"]) > 0:
            ve = 0.0
        if pos["z"] < GEOFENCE["z_min"]:
            vd = max(vd, 0.0)
        if pos["z"] > GEOFENCE["z_max"]:
            vd = min(vd, 0.0)

        # integrate dead-reckon position (overridden by LOCAL_POSITION_NED when available)
        with lock:
            state["pos"] = {
                "x": clamp(pos["x"] + vn * dt, -GEOFENCE["x"], GEOFENCE["x"]),
                "y": clamp(pos["y"] + ve * dt, -GEOFENCE["y"], GEOFENCE["y"]),
                "z": clamp(pos["z"] - vd * dt, 0.0, GEOFENCE["z_max"]),
            }
            # integrate desired heading from yaw-rate command
            if desired_yaw is None:
                desired_yaw = yaw
            desired_yaw += c["yaw"] * 90.0 * dt  # normalized -> deg/s
            desired_yaw = (desired_yaw + math.pi) % (2 * math.pi) - math.pi

        type_mask = 0b0000111110000111  # ignore position+accel, use velocity+yaw
        MASTER.mav.set_position_target_local_ned_send(
            0, MASTER.target_system, MASTER.target_component,
            mavutil.mavlink.MAV_FRAME_LOCAL_NED,
            type_mask, 0, 0, 0,
            vn, ve, vd,
            0, 0, 0,
            math.degrees(desired_yaw), 0,
        )

        # battery failsafe: auto-land regardless of what the brain wants
        if bat < BATTERY_LAND and state.get("flying"):
            print("[relay] BATTERY FAILSAFE — auto-land")
            land()

        time.sleep(0.1)


def start_flight():
    """wait for EKF, arm + guided + takeoff (with retries — the FC refuses
    to arm while its navigation filter is still settling)."""
    state["starting"] = True  # the control loop must not fight the takeoff
    if RELAXED:
        print("[relay] RELAXED ARMING — disabling arming checks (SIM ONLY)")
        MASTER.param_set_send("ARMING_CHECK", 0.0)
        time.sleep(1)
    print("[relay] waiting for the navigation filter (EKF) to settle...")
    t0 = time.time()
    while time.time() - t0 < 60:
        ekf = MASTER.recv_match(type="EKF_STATUS_REPORT", blocking=True, timeout=3)
        if ekf is None:
            continue
        flags = ekf.flags
        if flags & mavutil.mavlink.EKF_POS_HORIZ_ABS and flags & mavutil.mavlink.EKF_POS_VERT_ABS:
            print("[relay] EKF ready")
            break
    else:
        print("[relay] EKF still settling — attempting anyway")

    for attempt in range(5):
        MASTER.set_mode_apm("GUIDED")
        time.sleep(1)
        if MASTER.flightmode == "GUIDED":
            break
        print(f"[relay] mode change retry {attempt + 1}...")
    print(f"[relay] mode: {MASTER.flightmode}")

    for attempt in range(6):
        MASTER.arducopter_arm()
        time.sleep(1.5)
        if MASTER.motors_armed():
            print("[relay] armed — taking off")
            break
        print(f"[relay] arm rejected (attempt {attempt + 1}) — retrying...")
    else:
        print("[relay] could not arm — check EKF/GCS failsafes")
        return
    MASTER.mav.command_long_send(
        MASTER.target_system, MASTER.target_component,
        mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, 0, TAKEOFF_ALT_M,
    )
    time.sleep(4)
    print("[relay] AURA IS FLYING — the browser brain has the sticks")
    state["starting"] = False  # sticks to the brain


def land():
    MASTER.mav.command_long_send(
        MASTER.target_system, MASTER.target_component,
        mavutil.mavlink.MAV_CMD_NAV_LAND, 0, 0, 0, 0, 0, 0, 0, 0,
    )


def stop_flight():
    state["starting"] = True  # pause the loop during landing too
    print("[relay] landing...")
    land()
    time.sleep(6)
    try:
        MASTER.disarm()
    except Exception:
        pass
    state["starting"] = False
    print("[relay] landed — safe")


# ------------------------------------------------------------------ WebSocket

async def ws_handler(ws):
    state["clients"].add(ws)
    print(f"[relay] brain connected ({len(state['clients'])} total)")
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            t = msg.get("t")
            if t == "vel":
                with lock:
                    for k in ("vx", "vy", "vz", "yaw"):
                        state["cmd"][k] = clamp(float(msg.get(k, 0)), -1, 1)
                    state["led"] = str(msg.get("led", "#f0b90b"))[:7]
                    state["last_cmd"] = time.time()
            elif t == "start":
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, start_flight)
            elif t == "stop":
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, stop_flight)
    except websockets.ConnectionClosed:
        pass
    finally:
        state["clients"].discard(ws)
        print(f"[relay] brain disconnected ({len(state['clients'])} left)")


async def broadcast_loop():
    while True:
        if state["clients"]:
            with lock:
                payload = json.dumps({
                    "t": "pose", **state["pos"],
                    "yaw": state["yaw"],
                    "battery": state["battery"],
                    "rpm": 2400 if state["flying"] else 0,
                    "led": state["led"],
                })
            dead = set()
            for ws in state["clients"]:
                try:
                    await ws.send(payload)
                except Exception:
                    dead.add(ws)
            state["clients"] -= dead
        await asyncio.sleep(0.2)


async def run(connection: str, baud: int = 57600):
    global MASTER
    print(f"[relay] connecting MAVLink on {connection} ...")
    await asyncio.get_running_loop().run_in_executor(
        None, connect_with_retry, connection, baud
    )
    print(f"[relay] FC connected (sys {MASTER.target_system})")
    threading.Thread(target=gcs_heartbeat_loop, daemon=True).start()
    MASTER.mav.request_data_stream_send(
        MASTER.target_system, MASTER.target_component,
        mavutil.mavlink.MAV_DATA_STREAM_ALL, 10, 1,
    )
    # ask for local position at 5 Hz (best-effort)
    MASTER.mav.command_long_send(
        MASTER.target_system, MASTER.target_component,
        mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL, 0, 32, 200000, 0, 0, 0, 0, 0,
    )

    threading.Thread(target=reader_loop, daemon=True).start()
    threading.Thread(target=command_loop, daemon=True).start()

    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)
    print(f"[relay] WebSocket listening on ws://{WS_HOST}:{WS_PORT}")
    print("[relay] READY. The browser brain can now connect (BODY · REAL).")

    asyncio.ensure_future(broadcast_loop())
    await asyncio.get_event_loop().create_future()  # run forever


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="AURA ground relay (pymavlink)")
    ap.add_argument("--connection", default="udpin:0.0.0.0:14551")
    ap.add_argument("--baud", type=int, default=57600,
                    help="serial baud for device-path connections (ArduPilot TELEM default 57600; 921600 for fast links)")
    ap.add_argument("--relaxed-arming", action="store_true",
                    help="disable arming checks (SITL only — never on hardware)")
    args = ap.parse_args()
    RELAXED = args.relaxed_arming
    try:
        asyncio.run(run(args.connection, args.baud))
    except KeyboardInterrupt:
        print("\n[relay] shutting down — landing...")
        try:
            land()
        except Exception:
            pass
