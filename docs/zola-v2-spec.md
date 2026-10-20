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
(`tools/modly/refs/ref-zola-v2-humanoid.png`):

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

## Lexicon

Canonical terminology lives in `docs/zola-dictionary.md` (Quad-Halo, Tattu
Ballast Bay, UART Trace Wire Mapping, MG90S Servo Node, Hangar Port 3001).

## Generation record

- Concept reference: Aetheria repo `tools/modly/refs/ref-zola-v2-humanoid.png`
- Queued to generate via `tools/modly/aetheria_bridge.py` (Turbo + paint +
  30k-face optimizer) immediately after the district batch completes.
