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
