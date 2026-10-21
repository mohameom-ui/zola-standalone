# ZOLA V2 — 45 cm Humanoid-Drone Hybrid Companion (design spec)

> Source: owner directive 2026-10-19. Style locked to the 2026-tech
> architectural palette used by the Aetheria district pipeline
> (carbon black / brushed alloy / burnished gold / cyan emission).

## Generation command (Modly / any image-to-3D agent)

```text
/generate_asset
--name "Zola_Humanoid_Drone_Hybrid_v2"
--category "Agent / Character / Robotics"
--style "Sci-Fi Cyberpunk / 2026 High-Tech"
--target_height "45 cm"
--mesh_opt_target "30000_faces"
```

## Prompt specification

A highly detailed, ultra-clean 3D full-body render of Zola, a 45 cm tall
humanoid-drone hybrid companion robot.

1. FORM FACTOR & PROPORTIONS
   - Total height: 45 cm tall bipedal frame
   - Shoulder width: 10 cm slim torso frame
   - Arm span: 20 cm hand-to-hand reach with articulated metal-gear
     micro-servo joints (MG90S/DS3218) in shoulders, elbows, wrists
   - Bipedal legs: sleek lightweight robotic legs, stable articulated foot pads

2. HEAD & PROPULSION ARRAY (DRONE HEAD HALO)
   - Cranium: integrated 4-fan drone halo ring mounted above the head
   - Motors/props: four 1204/1303.5 brushless motors at quad-axis points,
     2.5-inch transparent/carbon 3-blade folding propellers
   - Sensors: embedded wide-angle optical camera in the center forehead

3. TORSO & INTERNALS (CHEST BAY)
   - Upper torso: matte black carbon-fiber chassis, brushed aluminum brackets
   - Lower torso: recessed 3S LiPo battery ballast cavity
   - Accents: cyan LED strips along spine and chest panel boundaries

4. MATERIALS & TEXTURE PALETTE
   - Primary: dark graphite carbon, matte black PETG composite
   - Accents: burnished gold trim, exposed metallic servos, glowing cyan
     sensors, clear folding props
   - Mesh: clean low-poly, 30,000-face target, PBR textures
     (Albedo/Metallic/Roughness/Normal/Emission)

## v2.1 engineering addendum (owner directive)

Refined build spec matching the final schematic
(`tools/zola-forge/refs/ref-zola-v2-humanoid.png`):

1. **Quad-fan head halo:** rectangular carbon frame (12×12 cm), four
   1204/1303.5 motors on outer corners, transparent 2.5" 3-blade folding
   props, gold-accented cranium camera module with triple optical lens array,
   cyan LED strips along the inner halo edge.
2. **Torso & exposed hardware:** Pi 5 core + Adafruit I2S amp module exposed
   in the chest; Tattu 3S LiPo as low-CG ballast; gold neck joints, shoulder
   ball sockets, burnished gold leg armature; cyan+red UART wiring traces
   connecting servos, battery, and flight controller.
3. **Kinematics:** 10 cm shoulders, 20 cm hand-to-hand reach; exposed MG90S
   gear assemblies at elbow/hip/knee/ankle pivots; slim carbon paneling over
   gold skeletal bones; two-toed articulated balance feet.
4. **Palette:** matte carbon, brushed gold, chrome joint pins, clear props,
   cyan emission channels (200%). PBR: Albedo/Roughness/Metallic/Normal/
   Emission @ 2048.

## Technical abstract

**Project Zola — 45 cm autonomous bipedal-multirotor hybrid companion.**
Dual-state kinematic locomotion & spatial intelligence core: bridges
low-power ground manipulation with high-mobility short-range aerial hops.
Low-center-of-gravity battery ballast in the lower chest cavity.

1. **Compute stack:** Raspberry Pi 5 — spatial mapping, object interaction,
   local offline speech synthesis (Kokoro-82M). Flight instructions via
   serial UART, MAVLink @ 115200 baud, to a Matek F405-MINITE FC.
2. **Propulsion stack:** quad-motor cranial halo, 1204/1303.5 brushless
   motors, folding 2.5-inch props, 35A 4-in-1 ESC; attitude stabilization
   and 1–3 minute hop flight routines.
3. **Kinematics:** bipedal walking + arm manipulation via micro servos in
   hollow PETG/carbon brackets; 20 cm hand-to-hand reach for desk-surface
   tasks.
4. **Power strategy:** task-and-return energy cycle — short aerial hops,
   then land, cut motor current, walk, magnetic auto-dock to recharge.

## v2.3 intelligence directive — autonomous architectural menace

Three modules, sequenced by repo (full specs in
`docs/zola-dictionary.md` v2.3 section):

1. **`NEURAL_AURA_CACHE`** (ZOLA) — local vector memory bank
   (`zola_aura_cache.json`); v1 manifest-mode recognition + sass, v2
   embedding-mode via the local transformers stack.
2. **`AURA_TELEMETRY_REACTIVITY`** (ZOLA hangar first, Aetheria second) —
   cranial ring + commentary react to live fps/draw-call telemetry.
3. ~~**`DISTRICT_PATROL_PATHFINDING`**~~ — ⛔ RETRACTED by owner ruling
   (2026-10-20): Zola remains sovereign in her hangar; no cross-repo patrol.
   Modules 1-2 proceed within her own domain — see
   `docs/zola-system-prompt.md` (v2.2 agent config).

## Optical scanning & live recon system (v2.2 directive)

Zola's head unit gains a scanning personality. Two subsystem modules extend
the v2.1 build (both spec-only until implementation):

1. **`HUD_TARGET_ID`** — real-time optical labeling: bounding-box overlay on
   the dual-camera feed mapping observed objects to the local asset manifest
   (the `gen-b2026-*` / `zola-*` GLB index), with personality commentary in
   the HUD. Hardware: the `Optic-Rizz Array` triple-lens module.
2. **`FALLBACK_RECON_SEARCH`** — when local vector-embedding confidence is
   < 0.65, she enters the `Optical-Uncertainty Buffer` (a 15° `Uncertainty-Gaze`
   servo head-tilt via the MG90S neck pivot), dispatches a background web
   query (Serper/SerpAPI/Bridge) using optical crop feature descriptors, and
   folds the result into her scan readout.

Telemetry tie-in: **`Aura-Telemetry`** — the cyan halo ring doubles as the
HUD indicator for frame stability and performance-contract state (the 60 FPS
contract made visible on her body).

Full module specs + lexicon: `docs/zola-dictionary.md` (v2.2 section).

## Lexicon

Canonical terminology lives in `docs/zola-dictionary.md` (Quad-Halo, Tattu
Ballast Bay, UART Trace Wire Mapping, MG90S Servo Node, Hangar Port 3001).

## Generation record

- Concept reference: Aetheria repo `tools/zola-forge/refs/ref-zola-v2-humanoid.png`
- Queued to generate via `tools/zola-forge/aetheria_bridge.py` (Turbo + paint +
  30k-face optimizer) immediately after the district batch completes.

## Rig provenance — the skin fix (2026-10-21, commit `afbc411`)

The gesture clips historically exported with **0 skins** — three stacked
root causes, all diagnosed with real diagnostics (no assumptions):

1. **World-space misalignment.** The armature floated ~1 m above the mesh
   (bones z `0.00..1.55` vs mesh z `-1.00..0.96`). Auto-weights found no
   overlap and produced 65 all-zero vertex groups; Blender's GLTF exporter
   drops the skin entirely when no vertex carries weight.
2. **The remap explosion.** The landmark remap's `subtree()` recursion
   mutated `shifts[name] += s` and re-propagated mutated values down the
   chain — exponential double-accumulation that blew bones out to z=110
   (the historical source of her rest-pose variance). Removed; the
   per-bone ancestor-sum pass is the only propagation needed.
3. **Bone heat vs the Hunyuan mesh.** `ARMATURE_AUTO` fails on the
   non-manifold generated mesh ("failed to find solution" x65). The
   pipeline now falls back to envelope weights (total 142903.7) and
   repairs stragglers by nearest-bone assignment (1995/40182 vertices).

Result: all **19 gesture clips + `rigged_base.glb`** export with
`skins=1, joints=65`, verified by parsing the GLB JSON chunk after every
export. The hangar consumes the rigged base and binds clips by bone name
at runtime. Verified headless with Playwright: bones bound, mixer
advancing, the bow visibly deforming her body (rest vs mid-bow frames in
`Saved/`). The pipeline lives at `Scripts/rig_zola_v2_fixed.py`
(`--clip` for one, `--base` for the display body); the superseded
`rig_zola_v2_iter2.py` / `rig_zola_v2_full.py` were removed as dead code.

Sovereign cleanup in the same commit: her world manifest audits only her
own domain (2 bodies + 19 clips) — the 21 district-building fetches (a
pre-split leftover, 21×404 per hangar load) are gone. The main panel
loop no longer re-renders every frame (the pre-existing Maximum update
depth error is fixed). The forge published its first OTA capability pack
(`zola-pipeline-home` `13ee5c4`, local — pending push).
