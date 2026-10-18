# AURA SITL Quick-Start — Fly Her Tonight, $0 (ArduPilot & PX4)

**What you'll have at the end:** a real autopilot (ArduCopter or PX4) running
a *virtual quad* on your PC. AURA's browser brain connects through the relay,
arms it, takes off — and she flies a real flight stack with the same code that
will later fly the physical drone. Follow, scan, tasks, roasts: all work.
Only the props are imaginary.

```
┌─ Windows ──────────────────────────────────────────────────┐
│  Browser (this app) ──WebSocket ws://localhost:8765──┐     │
│                                                      │     │
│  ┌─ WSL2 Ubuntu ─────────────────────────────────────┘     │
│  │  aura_relay.py ──MAVLink UDP── SITL (ArduCopter or PX4)  │
│  └───────────────────────────────────────────────────────────│
└─────────────────────────────────────────────────────────────┘
```

**Two autopilot stacks — pick one:**

| | Option A — **ArduPilot** (recommended) | Option B — PX4 |
| --- | --- | --- |
| Sim command | `sim_vehicle.py` | `make px4_sitl jmavsim_headless` |
| Offboard port | `udp://:14551` | `udp://:14540` |
| GCS/viz port | `udp:127.0.0.1:14550` | `udp://:14550` |
| Matches our parts list | ✅ used quads convert to ArduPilot easily | ✅ |

---

## Step 1 — Install Dependencies & Source

On Linux (Ubuntu/Debian), or on Windows via **WSL2**:

```powershell
# Windows only, PowerShell as Administrator:
wsl --install
# reboot when asked, then set an Ubuntu username/password
```

Then inside Ubuntu/WSL — **Option A (ArduPilot):**
```bash
git clone --recursive https://github.com/ArduPilot/ardupilot.git
cd ardupilot
Tools/environment_install/install-prereqs-ubuntu.sh -y
source ~/.bashrc
```

Or **Option B (PX4):**
```bash
wget -qO- https://raw.githubusercontent.com/PX4/PX4-Autopilot/main/Tools/setup/ubuntu.sh | bash
source ~/.bashrc
git clone https://github.com/PX4/PX4-Autopilot.git --recursive
cd PX4-Autopilot
```

## Step 2 — Launch the Virtual Copter

**Option A — ArduCopter** (2D console + map included):
```bash
cd ardupilot/ArduCopter
sim_vehicle.py -v ArduCopter --console --map -w
```
> The `-w` flag wipes virtual EEPROM and loads default parameters on first run.

**Option B — PX4** (headless jMAVSim, light):
```bash
cd ~/PX4-Autopilot
make px4_sitl jmavsim_headless
```

When you see a running vehicle (`APM: ...` / `INFO [px4] Startup script
returned successfully`) — a virtual quad is sitting on a virtual floor.
Leave that terminal running.

## Step 3 — Verify the MAVLink Link (30 seconds)

New terminal. This proves the virtual drone answers before AURA touches it:

```bash
source aura-venv/bin/activate   # if you already made the venv from Step 4
pip install pymavlink
python - <<'EOF'
from pymavlink import mavutil

port = 'udp:127.0.0.1:14551'   # ArduPilot  |  PX4: use udp:127.0.0.1:14540
master = mavutil.mavlink_connection(port)
print("Waiting for heartbeat from the virtual AURA frame...")
master.wait_heartbeat()
print(f"Connected! System ID: {master.target_system}, Component ID: {master.target_component}")
master.set_mode_apm('GUIDED')
master.arducopter_arm()
print("AURA Armed in GUIDED mode! Ready for offboard commands.")
EOF
```

## Step 4 — Run the Relay (new terminal)

```bash
cd ~/aura-bridge          # copy the repo's bridge/ folder here
python3 -m venv aura-venv && source aura-venv/bin/activate
pip install mavsdk websockets

# Option A (ArduPilot):
python aura_relay.py --connection udp://:14551
# Option B (PX4):
python aura_relay.py --connection udp://:14540
```

You should see:
```
[relay] FC connected
[relay] position OK
[relay] WebSocket listening on ws://0.0.0.0:8765
[relay] READY. The browser brain can now connect.
```

## Step 5 — Give Her the Sticks (in this app, F7 panel)

1. Press **BODY · SIM** → flips to **BODY · REAL ⚠** (URL input appears —
   `ws://localhost:8765` is already correct)
2. On connect she sends `start` automatically — watch the relay terminal:
   `[relay] arming... → AURA IS FLYING — the browser brain has the sticks`
3. **She is now flying a real flight stack.** Say *"follow me"*, *"scan the
   room"*, *"do a trick"* — her velocity setpoints drive the actual simulator
4. Battery now comes from real telemetry, not the simulation

## Optional — 3D Visualization
- **QGroundControl** (ArduPilot & PX4): download, launch, it auto-connects to
  `14550` — watch her fly on a live map with full HUD
- Gazebo (PX4) or ArduPilot+Gazebo plugins for full 3D physics rendering
- jMAVSim GUI: run `make px4_sitl jmavsim` (non-headless) for a 3D frame view

## First-flight script (in this order)
1. Let her hover 10s — steady, no drift fight
2. *"come here"* — she can't see you in SITL (no camera), so approach runs on
   the follow logic; fine for control testing
3. *"do a trick"* → barrel roll setpoints
4. Press **BODY · SIM** (or close the panel) → sends `stop` → clean land +
   disarm. Relay prints `landed and disarmed — safe`

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Relay stuck at "waiting for flight controller" | SITL not up yet — check the sim terminal; ArduPilot: `udp://:14551`, PX4: `udp://:14540` |
| `sim_vehicle.py` not found | `source ~/.bashrc` after install-prereqs; or run from `ardupilot/Tools/autotest/` |
| Browser can't reach ws://8765 | Relay not running in WSL; `sudo ufw allow 8765` if ufw is on |
| Offboard refuses to start | Sim needs a moment after boot; retry — the relay retries automatically once |
| `arm denied: mode not GUIDED/OFFBOARD` | MAVSDK sets the mode itself; if it still refuses, land (BODY·SIM) and reconnect |
| She drifts/oscillates | Normal for velocity-only control in SITL — governor clamps keep it sane |
| mavsdk fails on Windows-native Python | Run the relay inside WSL (as above); only the browser runs on Windows |

## Why this matters
Every line of brain code exercised here — perception, personality, task
planning, safety governor, obstacle avoidance — runs **unchanged** when you
swap the SITL connection string for a real flight controller's. SITL is the
dress rehearsal for her first physical flight.
