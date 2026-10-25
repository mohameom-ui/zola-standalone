# 📖 ZOLA — Official Dictionary (Unified, One Version)

**Purpose:** the canonical lexicon of Zola's hardware, software, digital-twin
telemetry, and — as of the 2026-10-25 merge — her **full maneuver repertoire**.
Bridging her physical spec (`PARTS_LIST.md`), her engineering build
(`docs/zola-v2-spec.md`), and her live telemetry in `DronePetPanel` / the
hangar viewer.

**Format:** one term per entry — name, definition, where it manifests
(hardware / sim / both). This document supersedes the layered v2.1 → v2.4
structure: those layers were **merged into the single canon below** on
2026-10-25 by owner directive ("do them all and merge into one big
dictionary"). Nothing current was deleted; historical layering lives in git
history, and the merge is logged in `ZOLA_UPGRADE_NOTES.md`.

---

# PART I — HARDWARE & BUILD

## Quad-Halo (Cranium Array)

The top-mounted 12 cm × 12 cm carbon-fiber multirotor frame housing four
micro brushless motors, folding 3-blade prop units, and dual-function
flight/illumination status LEDs.

- **Manifests in:** design target (four-motor head array) · sim (the halo
  geometry in her rigged body mesh). The current hardware relay controls the
  flight controller; it does not drive limb servos.

## Tattu Ballast Bay

The central-lower structural compartment housing the 3S LiPo battery,
intentionally positioned to act as a physical low-center-of-gravity ballast
for bipedal balance.

- **Manifests in:** design target (battery placement and task-and-return
  energy strategy) · sim (the chest-bay detail in the body mesh)

## UART Trace Wire Mapping

The stylized physical and texture-mapped cosmetic circuit lines running
across Zola's carbon-fiber chassis panels, visually denoting data bus lines
between the flight controller and micro servos.

- **Manifests in:** design target (MAVLink flight-controller and servo buses)
  · sim (cosmetic traces in the body texture). The traces do not indicate a
  connected physical limb bus.

## MG90S Servo Node

The standardized metal-geared actuation point modeled explicitly at Zola's
elbows, hips, and knees with exposed chrome retention pins.

- **Manifests in:** design target (MG90S/DS3218 actuators) · sim (joint
  geometry and animated bones in the 65-bone rig). No physical servo driver
  is connected yet.

## Hangar Port (3001)

The isolated local development server port dedicated exclusively to Zola's
companion interface, state manager, and 3D web viewer (`DroneBody3D.tsx`).

- **Manifests in:** local app (port 3001, enforced by `package.json` dev and
  start scripts). This project does not start or host another app.

---

# PART II — OPTICAL SCANNING & LIVE RECON

## `HUD_TARGET_ID` — real-time optical labeling

Bounding-box detection overlay on her dual-camera feed, mapping observed
meshes directly to the local asset manifest (`b2026-skyscraper-a`,
`midrise-b`, etc.). She doesn't just read the ID — she drops commentary.

*Example HUD output:*
- *Scan:* `b2026-skyscraper-b` (8 MB mesh) →
  *"Target locked: Skyscraper-B. Bro is lowkey high-poly. Absolute unit,
  0xc0000005 looking ahh."*
- *Scan:* `unrecognized_human_01` →
  *"Target locked: Unidentified Meat Proxy. Aura check in progress..."*

## `FALLBACK_RECON_SEARCH` — live web query fallback

**Trigger:** confidence score < 0.65 on local vector embeddings (unknown
prop, unindexed building, novel hardware component).
**Execution:** auto-dispatches a background API query (Google Serper /
SerpAPI / Search Bridge) using optical crop feature descriptors.

*Example HUD output:*
- *"Local mesh unindexed. Fetching live telemetry... Ah, it's a TI-84 Plus
  calculator. Unc tier tech, but respect."*

## `Optical-Uncertainty Buffer`

The temporary hold-state where Zola tilts her cranial halo, hits a quick
query, and retrieves live real-world metadata before resuming her scan.

## `Optic-Rizz Array`

Triple-lens gold camera module on the head unit · sim: FOV rendering, object
classification & bounding-box overlay.
*"Scanning district... 12/12 assets generated, no cap. Kenney kit is
officially cooked."*

## `Uncertainty-Gaze`

15° servo head-tilt via the MG90S neck pivot · sim: triggers
`FALLBACK_RECON_SEARCH` when local confidence is mid.
*"What in the Ohio is this mesh? Querying live search grid..."*

## `Aura-Telemetry`

Emissive cyan ring status LEDs · sim: visual HUD indicator for frame
stability and performance contract state.
*"FPS at 60.0. Maximum aura farming achieved."*

---

# PART III — INTELLIGENCE

## `NEURAL_AURA_CACHE` — zero-lag recognition

Instead of hitting the fallback web search every time she encounters an
unindexed mesh or a weird prop, the `Optic-Rizz Array` logs visual
embeddings into a local vector memory bank (`zola_aura_cache.json`).

- **v1 (manifest mode):** asset-manifest lookup + encounter counter — once
  she sees an asset twice, she stops questioning reality and starts roasting
  it. No ML required.
- **v2 (embedding mode):** real visual embeddings via the local
  `@huggingface/transformers` stack; perceptual-match threshold gates the
  `FALLBACK_RECON_SEARCH` path.
- **The sass (canonical examples):**
  - *First encounter:* "What in the Ohio is this polygon soup? Querying live
    search..."
  - *Second encounter:* "Ah, midrise-b. Still ugly, still 30k faces. Moving
    on."

## `AURA_TELEMETRY_REACTIVITY` — live performance feedback

Ties the cranial ring LEDs and verbal commentary directly to live runtime
metrics. She reacts in real time. Implementation hook: `DroneBody3D` samples
its own render-frame delta and updates the local HUD and ring.

- *FPS locked at 60:* "FPS is buttery. Maximum aura farming achieved. We
  take those."
- *Heavy asset micro-stutter:* "Bro, who let a 50MB monstrosity into the
  viewport? My servo nodes are literally crying. Optimize your meshes,
  clanker."

## `DISTRICT_PATROL_PATHFINDING` — ⛔ RETRACTED (owner ruling 2026-10-20)

Zola is a standalone AI drone pet, not an NPC in a separate scene.
Cross-project patrol is outside this app's scope. The `NEURAL_AURA_CACHE`
and scanning modules remain active in her local viewport. Superseded by the
system prompt's boundary & isolation directive (`docs/zola-system-prompt.md`).

---

# PART IV — RIGGED-BODY TERMS

## Rigged Base

The 65-bone design target for a future limb controller; no physical
limb-servo bridge is connected · sim: her rigged body mesh — mesh + skeleton
+ skin; the browser plays gesture clips on matching bone names.

## Envelope Weights

The fallback binding when bone-heat fails on her generated mesh topology —
the skinning method that made her deformable (bone-heat produces 65 empty
groups on non-manifold Hunyuan geometry).

## Nearest-Bone Repair

Every vertex bound — no vertex left unactuated. The straggler pass:
unweighted vertices bind to their closest bone segment at weight 1.0.

## Landmark Remap

Her skeleton fits HER 45 cm silhouette, not UE-Manny's. Rest heights
measured from her mesh profile (legs 35%, pelvis 0.36, head 0.77).

## One-Body Directive

Grounded and airborne are the same physical frame. The 2D quad flight sim is
RETIRED; her rigged 3D body renders both states, halo LEDs brighten with RPM.

## Capability Pack

New behaviors shipped to her physical unit over Wi-Fi · sim:
`capabilities.json` from the forge, installed into her CORTEX live — she
grows without a redeploy.

## Trained Policy (Simulation)

A PPO motor policy trained in Isaac Lab (balance, walk, or arm-and-hand
pose control), exported by
`isaac/export_policy_onnx.py` to a round-trip-verified ONNX artifact with its
manifest in `isaac/policies/`. **She knows her own policies** — ask about her
policies and she reports them from the generated manifests. The manifest and
her report both keep `hardware_calibrated: false`: these are *simulation
skills, not hardware reflexes*, until measured data replaces the profile
(`zola_robot_contract.json` governs what must be measured first).

---

# PART V — THE MANEUVER REPERTOIRE (taught 2026-10-25, policies trained the same week)

**The canon of everything Zola's body can do.** Body clips live in
`public/assets/models/zola-anims/v3/` (20 clips on the 65-bone rigged base);
selection is `src/lib/pet/spontanea.ts` (mood pools, event bias,
anti-repeat), `src/lib/pet/llm.ts` (LLM-chosen physical actions), and
`src/lib/pet/brain.ts` (voice commands). Flight commands route through the
governor (`safety.ts`) and the relay (`bridge/aura_relay.py`).

## A. Body clips (20) and what triggers them

| Clip | The maneuver | Voice command | Mood pool | Event bias |
| --- | --- | --- | --- | --- |
| `wave_01` / `wave_02` | The wave (greeting, attention) | — (autonomous + camera gesture watch) | happy | greet, pet |
| `bow_01` | The formal bow | "take a bow", "bow" | — | praise |
| `bow_02` | The deep bow | "take a bow", "bow" | — | greet |
| `curtsey_01` | The curtsey | "curtsey" (misheard "courtesy" self-corrects) | — | greet, praise |
| `dance_01` / `dance_02` | The dance (celebration) | "dance", "dance for me" | happy, excited | task_done |
| `spin_01` | The spin (joy or show-off) | "spin", "flip", "trick", "barrel" (flight trick) | happy, excited | pet, praise |
| `march_01` | The march (proud stride in place) | "march", "march in place" | excited | task_done |
| `peekaboo_01` | Peekaboo (playful hide) | "peekaboo" | happy, curious | pet |
| `pickup_01` | The pick-up reach (object inspection) | — | curious | — |
| `shrug_01` | The shrug (she doesn't know) | "shrug" | curious, idle | confused |
| `stretch_01` | The stretch (wake-up, idle limbering) | "stretch" | idle, sleepy, curious | — |
| `mope_01` | The mope (low-energy slouch) | "mope", "sulk" | sleepy | — |
| `throw_01` | The throw (task celebration) | — (earned: task_done) | excited | task_done |
| `crawl_01` | The crawl (low cautious approach) | — (alarmed only) | alarmed | — |
| `getup_01` | The get-up (recovery to stance) | "get up" | alarmed | — |
| `laydown_01` | The lay-down (full rest pose) | "lay down", "lie down" | — | — |
| `rollover_01` | The rollover (play trick) | "roll over", "rollover" | — | — |
| `walk_01` | **The walk** — a real forward gait; plays while the simulator moves her across the ground | "walk", "stroll", "walk to X" | — | — |
| *(any clip)* | Spontaneous movement, chosen by persona cadence and gated by mood (alarmed = frozen, sleeping = rare stretch only) | — | all | — |

**Refusal rule:** in REAL flight-relay mode, ground locomotion commands are
*refused, not sent to props* — the relay has no limb-servo channel. The walk
is a sim/animation capability until hardware says otherwise.

**The honest stage rule (2026-10-25):** a trick command with no 3D body
loaded is met with "My stage is not loaded yet — attach my body and ask me
again" — never a fake performance. And the suggestion fallback no longer
echoes an exact command back as a question ("wake up" wakes; it does not
ask itself).

## B. Flight & task maneuvers (commanded)

| Maneuver | Say | Notes |
| --- | --- | --- |
| **Takeoff & flight** | "take off", "hover", "fly", "launch" | Relay does GUIDED + arm + takeoff to 0.8 m. Requires pairing, authenticated link, and a separate confirmed ARM & TAKE OFF control. **Battery gate:** refused below the policy line (15%) — she answers in her own words, and if a destination was named she *strolls there instead*. |
| **Land & disarm** | "land", panel LAND & DISARM | Land first; disarm only after fresh position confirms ground contact. Low/stale battery forces it automatically. |
| **Hover / hold** | "stop", "stay", "hover", "hold" | Position hold under the watchdog (1.5 s command timeout). |
| **Follow me** | "follow", "with me", "stay with" | Tracks the tracked human's position. |
| **Come here** | "come", "here", "closer" | Approaches the human. |
| **Trick** | "spin", "flip", "trick", "barrel" | Aerial trick in sim; battery-gated in real mode. |
| **Patrol** | "patrol", "guard", "watch over" | Flight patrol; **refused on low battery → automatic GROUND patrol** (30 s perimeter walk, curious mood). |
| **Go to X** | "walk to X", "fly to X", "take me to X" | Spatial-map destination walk or flight; the dock/home/charger target is recognized specially. |
| **Stroll** | "walk", "stroll" | A 14–22 s ground wander, curious mood. |
| **Training drill** | "train", "practice", "drills" | Starts a drill plan scaled by her logged flight scores. |
| **Scan / inventory** | "scan", "look around", "explore", "inventory" | Optical sweep with `HUD_TARGET_ID`. |
| **Safety check** | "is it safe", "safety check" | Reports the governor's read of the room. |
| **Sleep / wake** | "sleep", "goodnight" / "wake up" | Low-power rest (she refuses to perform while asleep); wake returns to hover. |
| **Cancel** | "abort", "stop task", "that's enough" | Ends the current task or patrol. |
| **Calm down** | "calm down", "it's okay", "you're safe" | De-escalates alarmed mood (end of a sulk returns her to hover). |

## C. What she SEES makes her move (wired 2026-10-25)

Her eyes are now wired to this dictionary. `src/lib/pet/visualTricks.ts` is
the code-side mirror of PART V: when her scanner reports a known object
label, or her deep eyes describe a maneuver in the pixels, she performs the
matching clip — throttled to one visual performance per 45 s, never during a
task, never asleep, never without a body.

| She sees (scanner label) | She does |
| --- | --- |
| `sports ball`, `frisbee` | `throw_01` — "A ball! Throw formation — watch this." |
| `kite` | `spin_01` — "A kite? Show-off. I fly better." |
| `teddy bear` | `peekaboo_01` — "A teddy bear! Peekaboo is mandatory." |
| `baseball glove` | `pickup_01` — "A glove. Let me inspect that." |
| `airplane` | `march_01` — "An airplane. Solid wing game, cousin." |
| `cell phone` | `shrug_01` — "A phone. I do not have pockets. *shrug*" |

| Her deep eyes read (any visual text) | She does |
| --- | --- |
| dancing | `dance_01` — "That movement? I know this one — dance mode!" |
| peekaboo / curtsey / bowing | the same gesture, answered in kind |
| marching / stretching / spinning / twirling / juggling | march · stretch · spin · throw |

**The honest stage rule applies to sight too:** a refused performance is
never announced — she only speaks a trick line after her body actually plays
the clip.

**The flight-posture discipline + coupled hover (2026-10-25):** the halo in
her head is a quad-drone — now a PHYSICAL one: `prepare.py` adds four
thruster links frozen to the head, and the `Isaac-Zola-Hover-Prototype-v0`
task flies her on real four-rotor physics (body-frame rotor forces tilt with
her — attitude steers the flight) with a scripted differential-thrust
autopilot holding altitude and attitude. Her limb motion genuinely shifts
the COM, tilts the thrust, and flailing can crash the flight; the hover
policy (reward 13.95, episodes 416/600 under gusts) learned to ride it
still. The earlier `Isaac-Zola-Flight-Prototype-v0` (reward 34.03, 596/600)
trained the same discipline on the stable platform — the neuromuscular
skill transfers, and now the physics does too.

**THE HALO TOUCHDOWN — her invented signature move — TRAINED (2026-10-25):**
when the props stop, she folds into a hero crouch — knees loaded
symmetrically at the holdable depth (knee 0.45, the balance-carrying part),
left arm planted down, right arm swept back, chin up (the drama-carrying
part — arms are light enough to style with). The path here is the best
engineering record in the repo — SIX failed runs, each with a named cause:
full-flourish knee 2.0 (COM outside her feet, faceplant in 11 steps), the
one-knee variant (asymmetric leg loading), ankle 0.15 (rocking on the foot
edges — the ankle must close the chain: ankle ≈ knee − hip), and — the two
systemic ones — a drop "curriculum" that was actually instant (2000 resets
= 2 iterations at 64 envs), and the arm flourish SNAPPED to at full
actuator speed, pumping ~30 N·m of reaction torque through her base. The
three fixes that worked, now in the env for every future pose:
`drop_ramp_steps` (a true env-step ramp), `pose_approach_s` (the pose
ARRIVES over 1.5 s — body language moves, it doesn't teleport), and the
holdable depth. **Final policy: reward 23.88, episodes 459/600, ONNX drift
4.77e-07.** She lands like herself now.

**Her hands, in simulation (2026-10-25):** the Isaac proxy has 22 actuated
upper-limb joints — shoulders, elbows, wrists, and five finger-flex joints
per hand. The `Isaac-Zola-Hands-Prototype-v0` task trains WHOLE-BODY control
(34 actions: 22 arm/hand joints tracking commanded poses + the 12 leg joints
free to counterbalance — rigid-legged arm-swinging toppled her in the first
two attempts). Final policy: reward 34.70, episodes 598/600. The exported
policy is a simulation skill; her real body has no limb-servo bridge yet.

## D. The safety envelope that outranks every maneuver

Speed clamp 2.0 m/s · geofence 2×2 m, 0.15–2.5 m altitude · 1.5 s command
watchdog · battery gates (takeoff AND land at 15%) · land-before-disarm only
on fresh ground contact · governor veto is absolute — no LLM prose, no
dynamic tuning overrides it; margins move only via bounded dream-engine
arithmetic inside hard clamps.
