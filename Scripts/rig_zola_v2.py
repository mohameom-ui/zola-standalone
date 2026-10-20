# ZOLA v2.1 RIGGING — headless Blender 5.2
# Binds the generated v2 mesh to the gesture-clip skeleton (65 bones,
# UE5-Manny naming) so the existing zola-anims clips play on her new body.
#
# Usage: blender.exe --background --python rig_zola_v2.py
# Output: <zola-anims>/v2/<clip>.glb for every clip in zola-anims (rigged
# mesh + that clip's animation), matching GestureStage's loader pattern.

import bpy, os, sys
from mathutils import Vector

ANIMS_DIR = r"C:\Users\self_\ZOLA-standalone\public\assets\models\zola-anims"
OUT_DIR = os.path.join(ANIMS_DIR, "v2")
BODY = r"C:\Users\self_\.lmstudio\apps\bionic\projects\d49037d8-47f4-5808-9028-c707de117f8f\workspace\public\assets\models\gen-zola-humanoid-v2.glb"
TARGET_HEIGHT = 0.45  # meters — her spec

os.makedirs(OUT_DIR, exist_ok=True)

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def log(msg):
    print("[rig]", msg, flush=True)

# ---------- pass 1: reference rig from bow_01 ----------
clear()
log("importing reference clip (bow_01)…")
clip_objs = import_glb(os.path.join(ANIMS_DIR, "bow_01.glb"))
arm = next((o for o in clip_objs if o.type == "ARMATURE"), None)
if arm is None:
    log("FATAL: no armature in clip")
    sys.exit(1)
log(f"armature: {arm.name} | bones: {len(arm.data.bones)}")

zs = [v for b in arm.data.bones for v in (b.head_local.z, b.tail_local.z)]
skel_h = max(zs) - min(zs)
log(f"skeleton height: {skel_h:.3f} m")

# ---------- pass 2: measure the new body ----------
clear()
log("importing v2 body…")
body_objs = import_glb(BODY)
meshes = [o for o in body_objs if o.type == "MESH"]
body_h = max((o.dimensions.z for o in meshes), default=0.0)
if body_h < 0.01:
    body_h = max((o.dimensions.y for o in meshes), default=0.0)
log(f"body height (native): {body_h:.3f} m")
final_scale = TARGET_HEIGHT / max(body_h, 1e-6)
log(f"final assembly scale: {final_scale:.4f}")

# ---------- pass 3: build the rigged scene ----------
clear()
body_objs = import_glb(BODY)
meshes = [o for o in body_objs if o.type == "MESH"]
for m in meshes:
    m.scale = (final_scale, final_scale, final_scale)
bpy.context.view_layer.update()

clip_objs = import_glb(os.path.join(ANIMS_DIR, "bow_01.glb"))
arm = next((o for o in clip_objs if o.type == "ARMATURE"), None)
for o in clip_objs:
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
if arm is None:
    log("FATAL: no armature in clip")
    sys.exit(1)

# fit the armature to the scaled body (1.621 m rig → 0.45 m Zola)
arm_fit = TARGET_HEIGHT / skel_h
arm.scale = (arm_fit, arm_fit, arm_fit)
bpy.context.view_layer.update()

# parent with automatic weights
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
log("auto-weights applied")

out_base = os.path.join(OUT_DIR, "rigged_base.glb")
bpy.ops.export_scene.gltf(filepath=out_base, export_format="GLB", export_animations=True)
log(f"rigged base exported: {out_base}")

# ---------- pass 4: every clip onto the same rig ----------
clips = sorted(f for f in os.listdir(ANIMS_DIR) if f.endswith(".glb"))
log(f"clips available: {len(clips)}")
for clip in clips:
    clear()
    body_objs = import_glb(BODY)
    meshes = [o for o in body_objs if o.type == "MESH"]
    for m in meshes:
        m.scale = (final_scale, final_scale, final_scale)
    bpy.context.view_layer.update()
    clip_objs = import_glb(os.path.join(ANIMS_DIR, clip))
    arm = next((o for o in clip_objs if o.type == "ARMATURE"), None)
    for o in clip_objs:
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    if arm is None:
        log(f"SKIP {clip}: no armature")
        continue
    arm.scale = (arm_fit, arm_fit, arm_fit)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    out = os.path.join(OUT_DIR, "v2_" + clip)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=True)
    log(f"exported {os.path.basename(out)}")

log("ALL CLIPS EXPORTED")
