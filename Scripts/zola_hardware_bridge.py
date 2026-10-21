# ZOLA HARDWARE BRIDGE — v1.0
# The WebSocket bridge between Zola's brain (the browser) and her body
# (the Pi 5 + the servos + the motors + the FC). One process, one socket,
# one body. She moves because the brain tells her to.
#
# Architecture:
#   Browser (the brain) ──WebSocket──► this process ──► the actuators
#   The sensors (the camera, the mic) ──► this process ──► back to the brain
#
# Every command is a JSON message:
#   {"action": "servo", "channel": 0, "angle": 90.0}
#   {"action": "motor", "motor": 0, "speed": 0.0}  # 0.0-1.0
#   {"action": "led", "r": 53, "g": 208, "b": 165}
#   {"action": "gesture", "clip": "wave_01"}  → decomposes to servo commands
#
# Every sensor reading is a JSON message back:
#   {"type": "battery", "voltage": 14.8, "cells": 4}
#   {"type": "imu", "roll": 0.01, "pitch": -0.02, "yaw": 1.57}
#   {"type": "camera_frame", "width": 640, "height": 480}
#
# Usage: python zola_hardware_bridge.py [--mock] [--port 8766]
#   --mock: run without real hardware (log the commands instead of acting)
#   --port: the WebSocket port (default 8766)

import asyncio
import json
import os
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------
WS_PORT = 8766
MOCK = "--mock" in sys.argv
PCA9685_ADDR = 0x40  # the servo driver's I2C address
SERVO_CHANNELS = 16
SERVO_FREQ = 50  # Hz (standard servo PWM)
SERVO_MIN_PULSE = 500   # μs
SERVO_MAX_PULSE = 2500  # μs

# the servo channel map (the PCA9685 channel → the body joint)
SERVO_MAP = {
    0: "hip_left",      # the left hip (the pelvis → the thigh)
    1: "knee_left",     # the left knee (the thigh → the calf)
    2: "ankle_left",    # the left ankle (the calf → the foot)
    4: "hip_right",     # the right hip
    5: "knee_right",    # the right knee
    6: "ankle_right",   # the right ankle
    8: "shoulder_left", # the left shoulder (the spine → the upper arm)
    9: "elbow_left",    # the left elbow (the upper arm → the forearm)
    10: "wrist_left",   # the left wrist
    12: "shoulder_right",
    13: "elbow_right",
    14: "wrist_right",
    15: "neck_tilt",    # the head/neck tilt servo (the MG90S neck pivot)
}

# the motor channels (the quad-halo's 4 motors, via the FC's MAVLink)
MOTOR_MAP = {0: "front_left", 1: "front_right", 2: "rear_left", 3: "rear_right"}

# the gesture decompositions: the named gesture → the sequence of
# servo/motor commands with timings (the same clips the sim plays)
GESTURES = {
    "wave_01": [
        {"t": 0.0, "action": "servo", "channel": 8, "angle": 90},   # raise the right shoulder
        {"t": 0.3, "action": "servo", "channel": 12, "angle": 45},  # the right elbow bends
        {"t": 0.6, "action": "servo", "channel": 14, "angle": 30},  # the wrist tilts
        {"t": 1.0, "action": "servo", "channel": 14, "angle": 60},  # the wave
        {"t": 1.4, "action": "servo", "channel": 14, "angle": 30},
        {"t": 1.8, "action": "servo", "channel": 14, "angle": 60},
        {"t": 2.2, "action": "servo", "channel": 12, "angle": 90},  # lower
        {"t": 2.5, "action": "servo", "channel": 8, "angle": 0},    # shoulder back
    ],
    "bow_01": [
        {"t": 0.0, "action": "servo", "channel": 0, "angle": 45},   # both hips hinge
        {"t": 0.0, "action": "servo", "channel": 4, "angle": 45},
        {"t": 0.3, "action": "servo", "channel": 8, "angle": 20},   # arms at the sides
        {"t": 0.3, "action": "servo", "channel": 12, "angle": 20},
        {"t": 0.6, "action": "servo", "channel": 15, "angle": 30},  # the neck bows
        {"t": 1.5, "action": "servo", "channel": 15, "angle": 0},   # hold the bow
        {"t": 2.0, "action": "servo", "channel": 15, "angle": 15},  # rise slowly
        {"t": 2.5, "action": "servo", "channel": 0, "angle": 90},   # hips back
        {"t": 2.5, "action": "servo", "channel": 4, "angle": 90},
        {"t": 2.8, "action": "servo", "channel": 8, "angle": 90},   # arms back
        {"t": 2.8, "action": "servo", "channel": 12, "angle": 90},
    ],
    "march_01": [
        {"t": 0.0, "action": "motor", "motor": "all", "speed": 0.0},   # motors off — walking
        {"t": 0.0, "action": "servo", "channel": 0, "angle": 60},     # the left hip forward
        {"t": 0.0, "action": "servo", "channel": 4, "angle": 120},    # the right hip back
        {"t": 0.4, "action": "servo", "channel": 0, "angle": 120},    # the left hip back
        {"t": 0.4, "action": "servo", "channel": 4, "angle": 60},     # the right hip forward
        {"t": 0.8, "action": "servo", "channel": 0, "angle": 60},
        {"t": 0.8, "action": "servo", "channel": 4, "angle": 120},
        {"t": 1.2, "action": "servo", "channel": 0, "angle": 120},
        {"t": 1.2, "action": "servo", "channel": 4, "angle": 60},
        {"t": 1.6, "action": "servo", "channel": 0, "angle": 90},     # center
        {"t": 1.6, "action": "servo", "channel": 4, "angle": 90},
    ],
}

# ---------------------------------------------------------------------------
# HARDWARE LAYER (the real actuators — or the mock)
# ---------------------------------------------------------------------------

class MockActuators:
    """When MOCK is set: logs every command instead of touching hardware."""
    def __init__(self):
        self.servo_angles = {ch: 90.0 for ch in SERVO_MAP}
        self.motor_speeds = {m: 0.0 for m in MOTOR_MAP}
        self.led_color = (53, 208, 165)
        self.log = []

    def set_servo(self, channel: int, angle: float):
        name = SERVO_MAP.get(channel, f"ch{channel}")
        self.servo_angles[name] = angle
        pulse = SERVO_MIN_PULSE + (angle / 180.0) * (SERVO_MAX_PULSE - SERVO_MIN_PULSE)
        self.log.append(f"SERVO {name}({channel}) → {angle:.1f}° ({pulse:.0f}μs)")
        # the real implementation: pwm.set_pwm(channel, 0, int(pulse * 4096 / 20000))

    def set_motor(self, motor, speed: float):
        self.motor_speeds[motor] = speed
        self.log.append(f"MOTOR {motor} → {speed:.2f}")
        # the real implementation: MAVLink SET_ATTITUDE_TARGET or the ESC PWM

    def set_led(self, r: int, g: int, b: int):
        self.led_color = (r, g, b)
        self.log.append(f"LED → rgb({r},{g},{b})")
        # the real implementation: the WS2812 strip via rpi-ws281x

    def get_battery(self) -> dict:
        # the real implementation: read the ADC voltage divider
        return {"voltage": 14.8, "cells": 4, "percentage": 0.86}

    def get_imu(self) -> dict:
        # the real implementation: read the FC's IMU via MAVLink ATTITUDE
        return {"roll": 0.01, "pitch": -0.02, "yaw": 1.57}

    def drain(self):
        if self.log:
            for line in self.log:
                print(f"  [mock] {line}", flush=True)
            self.log.clear()


class RealActuators:
    """The real hardware: PCA9685 (I2C) for the servos, MAVLink for the FC."""
    def __init__(self):
        import busio  # from the Adafruit CircuitPython bundle
        import board
        from adafruit_pca9685 import PCA9685
        i2c = busio.I2C(board.SCL, board.SDA)
        self.pca = PCA9685(i2c)
        self.pca.frequency = SERVO_FREQ
        self.log = []

    def set_servo(self, channel: int, angle: float):
        # the PCA9685: 12-bit PWM (0-4095), 50 Hz, 500-2500 μs pulse
        pulse = SERVO_MIN_PULSE + (angle / 180.0) * (SERVO_MAX_PULSE - SERVO_MIN_PULSE)
        duty = int(pulse * 4096 / 20000)  # 20000 μs per cycle at 50 Hz
        self.pca.channels[channel].duty_cycle = duty

    def set_motor(self, motor, speed: float):
        # the motors are driven by the FC's ESCs via MAVLink
        # (or direct PWM through the PCA9685 for testing without the FC)
        pass  # the real implementation: MAVLink SET_ATTITUDE_TARGET

    def set_led(self, r: int, g: int, b: int):
        # the WS2812 strip via the rpi-ws281x library
        pass  # the real implementation

    def get_battery(self) -> dict:
        # the real implementation: the ADC voltage divider
        return {"voltage": 0.0, "cells": 4, "percentage": 0.0}

    def get_imu(self) -> dict:
        return {"roll": 0.0, "pitch": 0.0, "yaw": 0.0}

    def drain(self):
        self.log.clear()


# ---------------------------------------------------------------------------
# THE GESTURE EXECUTOR — decomposes a named gesture into servo/motor commands
# ---------------------------------------------------------------------------

def execute_gesture(actuators, gesture_name: str):
    """Fire the servo/motor commands for a named gesture with the right timings."""
    seq = GESTURES.get(gesture_name, [])
    if not seq:
        return False

    async def run():
        start = time.time()
        for step in seq:
            delay = step.get("t", 0) - (time.time() - start)
            if delay > 0:
                await asyncio.sleep(delay)
            if step["action"] == "servo":
                actuators.set_servo(step["channel"], step["angle"])
            elif step["action"] == "motor":
                actuators.set_motor(step.get("motor", "all"), step.get("speed", 0))

    return run


# ---------------------------------------------------------------------------
# THE WEBSOCKET SERVER — the brain talks to the body here
# ---------------------------------------------------------------------------

async def handle_client(websocket, actuators):
    """Handle a WebSocket connection from the browser (Zola's brain)."""
    print(f"[bridge] client connected: {websocket.remote_address}", flush=True)
    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                print(f"[bridge] bad JSON: {raw[:80]}", flush=True)
                continue

            action = msg.get("action", "")
            if action == "servo":
                actuators.set_servo(msg["channel"], msg["angle"])
                actuators.drain()
            elif action == "motor":
                actuators.set_motor(msg.get("motor", "all"), msg.get("speed", 0.0))
                actuators.drain()
            elif action == "led":
                actuators.set_led(msg.get("r", 0), msg.get("g", 0), msg.get("b", 0))
                actuators.drain()
            elif action == "gesture":
                gname = msg.get("clip", "")
                runner = execute_gesture(actuators, gname)
                if runner:
                    asyncio.ensure_future(runner())
                    print(f"[bridge] gesture: {gname} ({len(GESTURES.get(gname, []))} steps)", flush=True)
                else:
                    print(f"[bridge] unknown gesture: {gname}", flush=True)
            elif action == "ping":
                await websocket.send(json.dumps({"type": "pong"}))
            else:
                print(f"[bridge] unknown action: {action}", flush=True)

            # the sensor readings back to the brain (every message triggers a read)
            battery = actuators.get_battery()
            imu = actuators.get_imu()
            await websocket.send(json.dumps({
                "type": "telemetry",
                "battery": battery,
                "imu": imu,
                "servos": {SERVO_MAP.get(k, f"ch{k}"): v for k, v in actuators.servo_angles.items()},
                "motors": actuators.motor_speeds,
            }))

    except Exception as e:
        print(f"[bridge] connection error: {e}", flush=True)
    finally:
        print(f"[bridge] client disconnected", flush=True)


async def main():
    if MOCK:
        actuators = MockActuators()
        print("[bridge] MOCK mode — commands are logged, not executed", flush=True)
    else:
        try:
            actuators = RealActuators()
            print("[bridge] REAL hardware mode — PCA9685 + the FC connected", flush=True)
        except Exception as e:
            print(f"[bridge] hardware init failed: {e} — falling back to MOCK", flush=True)
            actuators = MockActuators()

    try:
        import websockets
    except ImportError:
        print("FATAL: pip install websockets", flush=True)
        sys.exit(1)

    print(f"[bridge] WebSocket server on ws://localhost:{WS_PORT}", flush=True)
    print(f"[bridge] servos: {len(SERVO_MAP)} channels | gestures: {len(GESTURES)} | motors: {len(MOTOR_MAP)}", flush=True)

    async def serve():
        async with websockets.serve(lambda ws: handle_client(ws, actuators), "localhost", WS_PORT):
            await asyncio.Future()  # run forever

    await serve()


if __name__ == "__main__":
    asyncio.run(main())
