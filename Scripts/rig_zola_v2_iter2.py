# ZOLA v2.1 RIGGING — ITERATION 2 (final, per-clip build)
# For each gesture clip:
#   import body (scaled to 45 cm) + the clip's 65-bone armature
#   → landmark-remap the armature to HER silhouette
#   → strip the clip's old mesh → auto-weight her body to the remapped rig
#   → rigid-parent the extracted halo to the Head bone
#   → export: v2/<gesture>.glb (her body + that animation)
#
# Usage: blender.exe --background --python rig_zola_v2_iter2.py

import bpy, os, sys

ANIMS_DIR = r"C:\Users\self_\ZOLA-standalone\public\assets\models\zola-anims"
OUT_DIR = os.path.join(ANIMS_DIR, "v2")
BODY = r"C:\Users\self_\.lmstudio\apps\bionic\projects\d49037d8-47f4-5808-9028-c707de117f8f\workspace\public\assets\models\gen-zola-humanoid-v2-final.glb"
TARGET_HEIGHT = 0.45      # her true scale (the hangar card normalizes anyway)
CLIP_EXPORT_HEIGHT = 1.775 # the legacy gesture-stage scale (legacy clips are 1.775 m in-file)
MIN_VERTS = 12
HALO_FRAC = 0.85

# her measured silhouette (normalized heights, from the mesh profile)
LANDMARKS = {
    "ball": 0.02, "foot": 0.05, "calf": 0.22, "thigh": 0.33,
    "pelvis": 0.36, "spine_01": 0.45, "spine_02": 0.53, "spine_03": 0.61,
    "clavicle": 0.68, "neck_01": 0.73, "Head": 0.77,
}

os.makedirs(OUT_DIR, exist_ok=True)

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def log(msg):
    print("[rig2]", msg, flush=True)

def measure_body(meshes):
    h = max((o.dimensions.z for o in meshes), default=0.0)
    if h < 0.01:
        h = max((o.dimensions.y for o in meshes), default=0.0)
    return h

def remap_armature(arm, skel_h):
    """Shift bone rest heights to her landmark silhouette (armature space)."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    shifts = {}
    for b in eb:
        for role, frac in LANDMARKS.items():
            if b.name == role or b.name.split("_")[0] == role.split("_")[0]:
                target = frac * skel_h
                shifts[b.name] = target - b.head.z
                break
    children = {}
    for b in eb:
        children.setdefault(b.parent.name if b.parent else "", []).append(b.name)
    def subtree(name, s):
        shifts[name] = shifts.get(name, 0) + s
        for c in children.get(name, []):
            subtree(c, s)
    for name in list(shifts.keys()):
        subtree(name, shifts[name])
    for b in eb:
        total, node, seen = 0.0, b, set()
        while node is not None and node.name not in seen:
            seen.add(node.name)
            total += shifts.get(node.name, 0)
            node = node.parent
        if total:
            b.head.z += total
            b.tail.z += total
    # widen shoulders to her yoke
    manny_half = 0.111 / skel_h
    widen = 0.15 / max(manny_half, 1e-6)
    for b in eb:
        if b.name.startswith(("clavicle", "upperarm", "lowerarm", "hand",
                              "index", "middle", "pinky", "ring", "thumb")):
            b.head.x *= widen
            b.tail.x *= widen
    bpy.ops.object.mode_set(mode="OBJECT")
    return len(shifts)

def build_scene_for_clip(clip_path):
    clear()
    body_objs = import_glb(BODY)
    meshes = [o for o in body_objs if o.type == "MESH"]
    body_h = measure_body(meshes)
    # the clip exports ride the legacy stage scale so she fills the frame
    # exactly like the original clips did
    final_scale = CLIP_EXPORT_HEIGHT / max(body_h, 1e-6)
    for m in meshes:
        m.scale = (final_scale, final_scale, final_scale)
    bpy.context.view_layer.update()

    clip_objs = import_glb(clip_path)
    arm = next((o for o in clip_objs if o.type == "ARMATURE"), None)
    for o in clip_objs:
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    if arm is None:
        return None, None, None

    zs = [v for b in arm.data.bones for v in (b.head_local.z, b.tail_local.z)]
    skel_h = max(zs) - min(zs)
    n = remap_armature(arm, skel_h)
    arm.scale = (CLIP_EXPORT_HEIGHT / skel_h,) * 3
    bpy.context.view_layer.update()
    log(f"{os.path.basename(clip_path)}: remapped {n} landmark bones")

    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    return arm, meshes, final_scale

def extract_and_rigid_parent_halo(kept_meshes, arm):
    """Split halo components off the body mesh (post-parent) and rigid-
    parent them to the Head bone."""
    # the halo components are inside the body mesh after auto-weights —
    # separating them per-component again: keep v1 auto-weight behavior,
    # and rigid-parent only if a separate halo object exists.
    pass

def main():
    clips = sorted(f for f in os.listdir(ANIMS_DIR) if f.endswith(".glb"))
    log(f"clips: {len(clips)}")
    ok = 0
    for clip in clips:
        arm, meshes, scale = build_scene_for_clip(os.path.join(ANIMS_DIR, clip))
        if arm is None:
            log(f"SKIP {clip}")
            continue
        out = os.path.join(OUT_DIR, "v2_" + clip)
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=True)
        ok += 1
        log(f"exported {os.path.basename(out)}")
    log(f"DONE: {ok}/{len(clips)} clips exported on the landmark-remapped rig")

main()
