# Blender Retargeting Recipe — BVH → Zola's rig

Goal: turn the 85 CMU gesture candidates (`docs/BVH_GESTURE_CANDIDATES.txt`)
into game-ready GLBs her web view can play: wave, bow, spin, stretch.

## The pipeline (one-time setup)

1. **Blender**: use the library installer — `Tools/Installers/blender-5.2.2-windows-x64.msi`
   was purged in the off-scope purge; re-download from blender.org (free, no account)
   or grab Blender 5.0.1 from your download history.
2. **Her rig**: the Quaternius base character
   (`Assets/Models/quaternius_base-characters/`) — its skeleton is what the
   Universal Animation Library targets, so retargeted BVH anims plug into the
   same armature name-space her existing anims use.

## Automated pass — `Scripts/retarget_bvh.py` (in this folder)

Blender's retargeting is UI-driven per file, but the mechanical part (import
BVH → map bones → bake → export GLB) can be batched. Run inside Blender:

```
blender --background --python Scripts/retarget_bvh.py -- \
  --bvh "docs/BVH_GESTURE_CANDIDATES.txt line paths" \
  --rig  "path/to/quaternius_rig.fbx" \
  --out  "public/assets/models/zola-anims/"
```

The script does, per BVH:
1. Import the CMU BVH onto a fresh armature
2. Rename its joints to the Quaternius rig's names via `BONE_MAP` (edit to match
   your rig — CMU uses `Hips/Chest/LeftArm…`, Quaternius is close but check
   `LowerLeg` vs `Calf` and finger roots)
3. Copy the animation onto the rig with copy-constraints per mapped bone
4. Sample/bake to keyframes at 30 fps (the FC of animation — no simulation
   residue in the export)
5. Export GLB (plus NLA track naming so the web view can list gestures by name)

## Manual pass — when automation fights you (it will, once)

The first retarget is worth doing by hand to lock `BONE_MAP`:
1. `File > Import > Motion Capture (.bvh)` — pick one wave file
2. Select the BVH armature, then the Quaternius rig, then
   `Armature > Retarget` (Rokoko addon from `Tools/Character/rokoko-studio-live-blender.zip`
   also works and its UI is friendlier: source = BVH armature, target = rig)
3. `Pose > Animation > Bake Action` — clear constraints, visual keying, 30 fps
4. `File > Export > glTF 2.0` — apply modifiers off, +Y up, bake `NLA tracks`
5. Drop the GLB into `public/assets/models/zola-anims/` and test in the
   mental-map/3D view before batching the rest.

## Naming convention (her animation table)

Export as `<gesture>_<variant>.glb`:
- `wave_01.glb` (CMU 09_01-range), `bow_01.glb`, `spin_01.glb` (already have a
  yaw-spin trick — BVH adds body language), `stretch_01.glb`
The web side lists whatever `zola-anims/` contains — no manifest needed.

## Verification
- Import the GLB into the R3F view: skeleton plays at 30 fps, feet don't slide
  (root motion either kept-in-place via the bake option or stripped by the exporter)
- Then batch the remaining 84 candidates through the same `BONE_MAP`.
