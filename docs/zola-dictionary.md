# 📖 ZOLA — Official Dictionary

**Purpose:** the canonical lexicon of Zola's hardware, software, and
digital-twin telemetry. Bridging her physical spec (`PARTS_LIST.md`), her
v2.1 engineering build (`docs/zola-v2-spec.md`), and her live telemetry in
`DronePetPanel` / the hangar viewer.

**Format:** one term per entry — name, definition, where it manifests
(hardware / sim / both). New entries append at the bottom; existing entries
are never reworded without a provenance note in `ZOLA_UPGRADE_NOTES.md`.

---

## Quad-Halo (Cranium Array)

The top-mounted 12 cm × 12 cm carbon-fiber multirotor frame housing four
micro brushless motors, folding 3-blade prop units, and dual-function
flight/illumination status LEDs.

- **Manifests in:** hardware (Tier 1 propulsion stack) · sim (the halo ring
  geometry in `zola-body-v2.glb` and the drone-body flight form)

## Tattu Ballast Bay

The central-lower structural compartment housing the 3S LiPo battery,
intentionally positioned to act as a physical low-center-of-gravity ballast
for bipedal balance.

- **Manifests in:** hardware (power strategy — task-and-return energy cycle)
  · sim (the recessed chest-bay cavity in the v2 body mesh)

## UART Trace Wire Mapping

The stylized physical and texture-mapped cosmetic circuit lines running
across Zola's carbon-fiber chassis panels, visually denoting data bus lines
between the flight controller and micro servos.

- **Manifests in:** hardware (MAVLink @ 115200 baud, Matek F405-MINITE FC) ·
  sim (the cyan/red wiring traces baked into the v2 texture pass)

## MG90S Servo Node

The standardized metal-geared actuation point modeled explicitly at Zola's
elbows, hips, and knees with exposed chrome retention pins.

- **Manifests in:** hardware (kinematics & manipulation — MG90S/DS3218) ·
  sim (the exposed joint assemblies in the v2 mesh; future rigging pivots —
  see `IMPROVEMENT_BRIEF.md` §4.1 in the Aetheria repo)

## Hangar Port (3001)

The isolated local development server port dedicated exclusively to Zola's
companion interface, state manager, and 3D web viewer (`DroneBody3D.tsx`).

- **Manifests in:** sim (port authority: 3001 = ZOLA, 3000 = Aetheria —
  enforced in `package.json` dev/start scripts; see the port-authority rule
  in the Aetheria `PROJECT_BRIEF.md` §8)

---

*Seed terms: owner directive 2026-10-20. The dictionary grows with Zola.*

---

# Optical Scanning & Live Recon System (v2.2 lexicon)

*Owner directive 2026-10-20. If Zola is going to roam the district and stare
into the hangar, she cannot look like an NPC when she scans objects.*

## Subsystem modules

### `HUD_TARGET_ID` — real-time optical labeling

Bounding-box detection overlay on her dual-camera feed, mapping observed
meshes directly to the local asset manifest (`b2026-skyscraper-a`,
`midrise-b`, etc.). She doesn't just read the ID — she drops commentary.

*Example HUD output:*
- *Scan:* `b2026-skyscraper-b` (8 MB mesh) →
  *"Target locked: Skyscraper-B. Bro is lowkey high-poly. Absolute unit,
  0xc0000005 looking ahh."*
- *Scan:* `unrecognized_human_01` →
  *"Target locked: Unidentified Meat Proxy. Aura check in progress..."*

### `FALLBACK_RECON_SEARCH` — live web query fallback

**Trigger:** confidence score < 0.65 on local vector embeddings (unknown
prop, unindexed building, novel hardware component).
**Execution:** auto-dispatches a background API query (Google Serper /
SerpAPI / Search Bridge) using optical crop feature descriptors.

*Example HUD output:*
- *"Local mesh unindexed. Fetching live telemetry... Ah, it's a TI-84 Plus
calculator. Unc tier tech, but respect."*

### `Optical-Uncertainty Buffer`

The temporary hold-state where Zola tilts her cranial halo, hits a quick
query, and retrieves live real-world metadata before resuming her scan.

## New lexicon entries

| Term | Hardware manifest | Sim/HAL manifest | Personality / HUD output |
| --- | --- | --- | --- |
| **`Optic-Rizz Array`** | Triple-lens gold camera module on head unit | FOV rendering, object classification & bounding box overlay | *"Scanning district... 12/12 assets generated, no cap. Kenney kit is officially cooked."* |
| **`Uncertainty-Gaze`** | 15° servo head-tilt via MG90S neck pivot | Triggers `FALLBACK_RECON_SEARCH` when local confidence is mid | *"What in the Ohio is this mesh? Querying live search grid..."* |
| **`Aura-Telemetry`** | Emissive cyan ring status LEDs | Visual HUD indicator for frame stability and performance contract state | *"FPS at 60.0. Maximum aura farming achieved."* |

---

# v2.3 INTELLIGENCE DIRECTIVE — Autonomous Architectural Menace

*Owner directive 2026-10-20: "We can't just stop at static 3D models and
basic bounding-box name tags. We need to turn her into an autonomous,
self-aware architectural menace."* Three modules, sequenced by repo:

## 1. `NEURAL_AURA_CACHE` — zero-lag recognition (ZOLA-native)

Instead of hitting the fallback web search every time she encounters an
unindexed mesh or a weird prop, the `Optic-Rizz Array` logs visual
embeddings into a local vector memory bank (`zola_aura_cache.json`).

- **v1 (manifest mode):** asset-manifest lookup + encounter counter — once
  she sees an asset twice, she stops questioning reality and starts roasting
  it. No ML required; ships immediately.
- **v2 (embedding mode):** real visual embeddings via the local
  `@huggingface/transformers` stack already in her package; perceptual-match
  threshold gates the `FALLBACK_RECON_SEARCH` path.
- **The sass (canonical examples):**
  - *First encounter:* "What in the Ohio is this polygon soup? Querying live
    search..."
  - *Second encounter:* "Ah, midrise-b. Still ugly, still 30k faces. Moving
    on."

## 2. `AURA_TELEMETRY_REACTIVITY` — live performance roasting (ZOLA-native
first, Aetheria-side second)

Tie the cranial ring LEDs and verbal commentary directly to live runtime
metrics. She reacts in real time.

- **Canonical sass:**
  - *FPS locked at 60:* "FPS is buttery. Maximum aura farming achieved. We
    take those."
  - *Heavy asset micro-stutter:* "Bro, who let a 50MB monstrosity into the
    viewport? My servo nodes are literally crying. Optimize your meshes,
    clanker."
- **Implementation hooks:** hangar card first (`DroneBody3D` samples its own
  rAF delta); district-side second (taps the `[district-gate]` sampler's
  store in Aetheria's `DistrictScene`).

## 3. `DISTRICT_PATROL_PATHFINDING` — ⛔ RETRACTED (owner ruling 2026-10-20)

~~Zola's bipedal-multirotor hybrid physically enters Aetheria's district
view: hops between generated rooftops, scans building variants, and drops
`HUD_TARGET_ID` markers automatically.~~

**RETRACTED by owner directive:** Zola is a sovereign AI drone pet, not an
NPC in a cityscape. Cross-repo patrol would couple her renderer into
Aetheria's codebase — unnecessary architectural contamination. She rules her
hangar (Port 3001); Aetheria rules its streets (Port 3000). The
`NEURAL_AURA_CACHE` and scanning modules remain fully active **within her
own domain** — she scans what enters HER viewport (assets, hardware parts,
unindexed files), not Aetheria's street grid.

- **Superseded by:** the ZOLA v2.2 system prompt (`docs/zola-system-prompt.md`)
  — boundary & isolation directive, §1.
