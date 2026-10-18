# AURA — Hardware Shopping List

Three tiers. **Start with Tier 0 (free) today**, buy Tier 1 when ready to fly.

## Tier 0 — free, buy nothing
Test the whole stack in **SITL** (software-in-the-loop): PX4 SITL runs a
virtual quad on your PC; the relay connects to it with `--connection
udp://:14540` exactly like real hardware. Fly AURA on your desk before a
single part arrives.

---

## Tier 1 — "She flies" (~$330)

### Flight platform
| Part | Pick | ~USD | Notes |
| --- | --- | --- | --- |
| Flight controller | **Holybro Pixhawk 6C Mini** or **Matek H743-Slim** | 100–130 | PX4 + ArduPilot, full offboard support, GPS not required indoors |
| Frame + motors + ESCs | 3" whoop-style kit (e.g. **iFlight TurboBee 3"** or Holybro X500-lite build) | 80–120 | Ducted props = pet-safe around people |
| Props | 3-blade 3", + 1 spare set | 8 | Always spares. She *will* find your table |
| Radio link | SiK 433/915MHz or ESP32 WiFi telemetry | 15–30 | Optional — Pi can be the link |
| Battery | 4S 850–1300 mAh LiPo ×2 | 25 | ×2 so one charges while she flies |
| Charger | LiPo balance charger (ToolkitRC / ISDT) | 30 | Never skip the balance charger |

### Companion computer (her brain-case)
| Part | Pick | ~USD | Notes |
| --- | --- | --- | --- |
| Computer | **Raspberry Pi 5 (4GB)** | 60 | Runs the brain, vision, STT/TTS |
| MicroSD | 64GB A2-class | 10 | |
| Camera | **Pi Camera Module 3 (wide)** + ribbon | 30 | Wide FOV = better person/item tracking |
| Mic | USB mini microphone | 10 | Cardioid if you can find one |
| Speaker | **MAX98357A I2S amp + 3W speaker** | 12 | piper TTS voice output |
| Cooling | Pi 5 active cooler | 6 | Vision models run hot |

### Power & wiring
| Part | ~USD | Notes |
| --- | --- | --- |
| 5V BEC (3A+) | 12 | FC battery → clean 5V for Pi (never power Pi from FC USB) |
| XT60 pigtail + wiring kit | 10 | |
| Velcro/standoffs/zip ties | 8 | Mount Pi + camera gently — vibration kills tracking |

**Total: ~$400 all-in with spares.** (Cheap version: skip telemetry radio, one battery → ~$360.)

---

## Tier 2 — "She's a proper pet" (+~$100)
| Part | ~USD | Why |
| --- | --- | --- |
| **Charging dock pad + pogo pins / wireless Qi module** | 30–50 | True auto-dock landing + contact charging (matches the sim!) |
| Time-of-flight / laser distance sensor (VL53L1X) or 1D lidar | 15 | Altitude hold + obstacle whiskers for real |
| LED WS2812 ring for her "eyes" | 5 | Drives the mood-LED output for real |
| Second 4S battery | 15 | Duty cycle: one flies, one charges |

---

## Tier 3 — alternative platform: Crazyflie (research-grade, ~$300)
If you'd rather have a finished, ultra-safe indoor platform instead of building:
**Bitcraze Crazyflie 2.1+ (~$225)** + Flow deck v2 (~$50) + Pi zero mount.
Their Python API (`cbitflie` lib) is the cleanest offboard control that exists,
and the relay protocol maps 1:1 (`MotionCommander.start_velocity_control`).
Downside: tiny payload — Pi 5 is too heavy; use the Flow deck + stream
vision to a ground PC instead.

---

## Path D — used drone (the smart-money route, ~$60–150 airframe)

Most of a drone's cost is the airframe, and it depreciates like a phone.
The line between "bargain" and "paperweight" is one question:
**can it run open firmware with offboard control?**

### ✅ GREAT used buys
| What | Used price | Why it works |
| --- | --- | --- |
| Home-built PX4/ArduPilot quad (Pixhawk, F450, Holybro X500 clone) | $60–150 | Flash fresh firmware, mount the Pi, done. Sellers usually include a power module + GPS you won't need indoors |
| Any Betaflight whoop/5" quad on an ArduPilot-compatible FC (SpeedyBee, Matek, H743) | $40–120 | Reflash to ArduPilot, get full MAVLink offboard. Check the FC chip is on the ArduPilot supported list first |
| **DJI Tello / Tello EDU** | $50–90 | Official UDP SDK: video stream + velocity commands over WiFi. Not enough payload for the Pi — brain stays ground-side (like Crazyflie Path B). The cheapest way to see AURA fly a real airframe |

### ❌ WALK AWAY from
- **Used DJI Mavic/Mini/Air** — closed ecosystem, no offboard API, no companion
  computer mount. Beautiful paperweights for our purposes
- **Any used LiPo battery** — always. LiPos age invisibly; new ones only
- Crashed-frame "project" builds unless you can inspect in person (warped
  arms = permanent vibration = blurry camera = AURA can't see)

### Used-buyer inspection checklist
1. **Firmware**: FC model on the PX4/ArduPilot supported-hardware list? Can it flash?
2. **Motors**: spin each by hand — notchy/gritty bearings = replacement ($8 each)
3. **ESCs**: seller's bench-test video or motor test on arrival
4. **Frame**: no cracked arms (carbon cracks hide under paint), all screws present
5. **Flight history**: "flown twice, crashed once" is normal; "rebuilt after a bad crash" is a maybe
6. **Includes**: power module? receiver? (we replace the receiver with the Pi anyway)
7. **Camera (for her eyes)**: ribbon cable + lens intact, image clean at hover throttle

### The conversion, once bought
```bash
# 1. flash ArduPilot/PX4 for your FC (QGroundControl or Mission Planner)
# 2. enable offboard + set MC_* velocity params
# 3. mount Pi + camera + mic + speaker (velcro, on the vibration dampers)
# 4. wire the 5V BEC from the power module
# 5. run the relay:  python aura_relay.py --connection udp://:14540
# 6. first flight: tethered, props guarded, over carpet
```
Expected total for Path D: **~$230–280** (used airframe + new battery + Pi kit).

## Buying order (what to buy when)
1. **Today**: nothing — run PX4 SITL + relay locally (free, tests everything)
2. **Order 1**: Pi 5 + camera + mic + speaker + SD + cooler (~$120) — build & test the brain standalone on the desk (no flight)
3. **Order 2**: FC + frame kit + props + battery + charger + BEC (~$250) — assemble, bench-test SITL↔FC, first tethered hover
4. **Order 3**: dock + sensors + spares as she earns them

## Safety shopping rule
Everything that spins gets a **prop guard or duct**, everything that carries
current gets a **fuse-free balance charger on a tile surface**, and every
first flight happens **indoors, prop-tips taped, over carpet**. She's a pet —
assume a toddler will grab her mid-air.
