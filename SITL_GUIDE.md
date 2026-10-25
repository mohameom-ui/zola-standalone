# Zola SITL Quick Start — ArduPilot

This guide runs the Zola browser app against an ArduCopter virtual vehicle. The
relay's takeoff sequence currently supports **ArduPilot GUIDED mode only**. PX4
uses a different OFFBOARD handshake and is not enabled by this relay.

## Requirements

- Windows with WSL2 Ubuntu, or Linux
- ArduPilot SITL installed under `~/ardupilot`
- Node.js 21 or later for the optional `first-flight.mjs` script
- The Zola repository available to both Windows and WSL if you use the batch launcher

## 1. Set up ArduPilot SITL

Inside WSL/Linux:

```bash
cd ~/ardupilot
Tools/environment_install/install-prereqs-ubuntu.sh -y
source ~/.bashrc
```

## 2. Set up the relay environment

From the Zola repository root in WSL/Linux:

```bash
python3 -m venv ~/aura-venv
~/aura-venv/bin/pip install -r bridge/requirements.txt
```

The environment keeps the existing deployment path name. The relay binds to
`127.0.0.1:8765` and accepts an empty token only on that loopback-only setup.

## 3. Start the virtual vehicle

In a WSL/Linux terminal:

```bash
cd ~/ardupilot
python3 Tools/autotest/sim_vehicle.py -v ArduCopter -f quad --no-mavproxy
```

Leave it running. The relay connects directly to ArduPilot's TCP master port
at `tcp:127.0.0.1:5760`. The launcher script starts the same configuration and
records only the PIDs it owns.

## 4. Verify the link without arming

In another terminal, confirm the heartbeat. This check is read-only: it does
not change flight mode or arm the vehicle.

```bash
~/aura-venv/bin/python - <<'PY'
from pymavlink import mavutil

master = mavutil.mavlink_connection("tcp:127.0.0.1:5760")
print("Waiting for the ArduCopter heartbeat...")
master.wait_heartbeat()
print(f"Connected to system {master.target_system}, component {master.target_component}")
PY
```

## 5. Start the relay and app

Start the relay in WSL/Linux:

```bash
cd ~/zola
~/aura-venv/bin/python -u bridge/aura_relay.py --connection tcp:127.0.0.1:5760 --relaxed-arming
```

`--relaxed-arming` is for SITL only. Never use it with a physical flight
controller. For a local Windows app, run `start-zola.bat` or `npm run dev`; the
app is on `http://localhost:3001/zola` and the relay URL is
`ws://localhost:8765`.

For a one-click Windows launch, use `start-sim.bat`. It starts the managed
ArduPilot and relay session, starts the app if port 3001 is free, and opens the
Zola page. Use `stop-sim.bat` to request landing and stop only that session.

## 6. Take off and land

1. Switch the panel to **BODY · REAL** and use `ws://localhost:8765`.
2. Wait until the panel shows current battery telemetry.
3. Press **ARM & TAKE OFF** and confirm. The relay checks battery freshness,
   EKF position, GUIDED mode, and arming before requesting takeoff.
4. Send movement commands only after Zola is airborne. The relay clamps speed
   and confines the flight to its geofence.
5. Press **LAND & DISARM** to request a controlled landing. The relay disarms
   only after fresh position telemetry confirms she is on the ground. Switching
   away from REAL mode and the kill switch both request landing.

Real mode controls the flight controller only. Hand, finger, arm, and leg clips
remain visual until a physical limb-servo driver is connected.

## Optional automated SITL flight

With the relay running, execute from the Zola repository root:

```bash
node first-flight.mjs
```

The script authenticates, waits for current battery telemetry, then waits for
the relay to report armed altitude before it sends its bounded movement plan.
It requests landing when the plan completes.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Relay cannot connect | Ensure ArduCopter SITL is running and TCP port 5760 is available. |
| Relay reports autopilot unsupported | This relay currently supports ArduPilot, not PX4 OFFBOARD mode. |
| Takeoff refused for battery | Wait for fresh SYS_STATUS battery telemetry; takeoff is blocked when it is stale or below 15%. |
| Takeoff refused for EKF | Wait for SITL's EKF position flags to become ready. The relay now refuses instead of arming without them. |
| App cannot connect to relay | Confirm the relay listens on `127.0.0.1:8765`; for a remote operator, configure a token and a trusted TLS/VPN path as described in `DEPLOY.md`. |
| Landing not confirmed | Keep the flight controller powered and inspect the relay log and vehicle directly. The relay intentionally leaves the controller armed if it cannot confirm ground contact. |