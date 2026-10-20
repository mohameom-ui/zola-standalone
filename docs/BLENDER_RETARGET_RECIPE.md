# Blender Retargeting Recipe — BVH → Zola's rig

> **STATUS (2026-10-18): PIPELINE PROVEN — 19 GESTURES LIVE.** Blender 5.2.2 LTS
> installed at `Tools/blender/blender-5.2.2-windows-x64/`. Full repertoire in
> `Scripts/gestures_core.txt` (format `path:gesture_name`): the core four
> (wave/bow/spin/stretch from CMU subject 111) + 15 expressive takes mapped to
> her brain states — dance ×2 (excited), shrug (search/lost), mope (sleepy),
> peekaboo + curtsey (greetings), pickup (found item), throw + rollover (play),
> laydown (sleeping), getup (wake), crawl + march (search/patrol), wave_02/bow_02
> variants. Each GLB: 195 animated channels, 30 fps.
> The GESTURE STAGE auto-performs on mood/activity changes (excited→dance,
> sleepy→mope, sleeping→laydown, search→shrug/crawl, trick→cycle).
> Known optimization (not urgent): each GLB embeds the full character mesh
> (~16 MB); if the library grows much larger, switch to one shared mesh +
> animation-only clips.

## Lessons locked in (do not re-learn these)
1. **Real bone names** (parsed from Superhero_Female_FullBody.gltf): the rig is
   UE-style — `pelvis, spine_01/02/03, neck_01, Head, clavicle_l/r, upperarm_l/r,
   lowerarm_l/r, hand_l/r, thigh_l/r, calf_l, foot_l, ball_l`. The recipe's
   original guess (Hips→Hips, LowerLeg.L) matched almost nothing — BONE_MAP in
   the script now carries the verified CMU→Quaternius mapping (22 bones).
2. **`nla.bake` is banned** — it silently produced nothing (fresh-import bones
   aren't selected; Blender 5 also dropped `use_current_frame`). The script now
   does a deterministic manual retarget: per frame, world-space rotation delta
   with per-bone rest-offset alignment, parents-first, keyframed directly.
3. **Delete the BVH source's ACTION before export** — an orphaned source action
   makes the glTF exporter emit a flat rest-pose animation named after the BVH
   file instead of her real baked action.
4. Blender resets cwd under `--background` — the script resolves `--out` to an
   absolute path itself.
5. BVH pick truth: subject 09 is RUNNING, not gestures. Always pick takes from
   `cmu-mocap-index-text.txt` descriptions, never by subject-number folklore.

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
