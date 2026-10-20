# ZOLA v2.1 RIGGING — ITERATION 2.5
# Upgrades over iter2:
#   1. HALO RIGID SEPARATION — the halo components are split out of the body
#      mesh and rigid-parented to the Head bone (parent_type BONE, no
#      weights). The soft-deformation artifact on the Quad-Halo is gone.
#   2. AUTHORED PBR — the body materials get real metallic/roughness values
#      (brushed-alloy treatment over the baked albedo), replacing the
#      generic single-pass paint defaults.
#   3. Debris cleanup + landmark remap carried forward from iter2.
#
# Usage: blender.exe --background --python rig_zola_v2_iter25.py

import bpy, os, sys

ANIMS_DIR = r"C:\Users\self_\ZOLA-standalone\public\assets\models\zola-anims"
OUT_DIR = os.path.join(ANIMS_DIR, "v2")
BODY = r"C:\Users\self_\.lmstudio\apps\bionic\projects\d49037d8-47f4-5808-9028-c707de117f8f\workspace\public\assets\models\gen-zola-humanoid-v2.glb"
TARGET_HEIGHT = 0.45
MIN_VERTS = 12
HALO_FRAC = 0.85

# authored PBR: brushed-alloy treatment (tuned to the hangar's look)
PBR = {"metallic": 0.62, "roughness": 0.38}

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
    print("[rig25]", msg, flush=True)

def measure_body(meshes):
    h = max((o.dimensions.z for o in meshes), default=0.0)
    if h < 0.01:
        h = max((o.dimensions.y for o in meshes), default=0.0)
    return h

def remap_armature(arm, skel_h):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    shifts = {}
    for b in eb:
        for role, frac in LANDMARKS.items():
            if b.name == role or b.name.split("_")[0] == role.split("_")[0]:
                shifts[b.name] = frac * skel_h - b.head.z
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
    manny_half = 0.111 / skel_h
    widen = 0.15 / max(manny_half, 1e-6)
    for b in eb:
        if b.name.startswith(("clavicle", "upperarm", "lowerarm", "hand",
                              "index", "middle", "pinky", "ring", "thumb")):
            b.head.x *= widen
            b.tail.x *= widen
    bpy.ops.object.mode_set(mode="OBJECT")
    return len(shifts)

def authored_pbr(materials):
    for mat in materials:
        if not hasattr(mat, "metallic"):
            continue
        mat.metallic = PBR["metallic"]
        mat.roughness = PBR["roughness"]

def build_scene_for_clip(clip_path):
    clear()
    body_objs = import_glb(BODY)
    meshes = [o for o in body_objs if o.type == "MESH"]
    body_h = measure_body(meshes)
    final_scale = TARGET_HEIGHT / max(body_h, 1e-6)
    for m in meshes:
        m.scale = (final_scale, final_scale, final_scale)
    bpy.context.view_layer.update()

    # split: body component vs halo cluster vs debris
    bm = meshes[0]
    bpy.context.view_layer.objects.active = bm
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [o for o in bpy.data.objects if o.type == "MESH"]

    # precompute the assembly span ONCE (before any deletion — removed
    # objects invalidate their list refs)
    all_zs = [v.co.z for p in parts for v in p.data.vertices]
    span_lo = min(all_zs) if all_zs else 0
    span_hi = max(all_zs) if all_zs else 1
    span = max(span_hi - span_lo, 1e-6)

    body_comps, halo_comps, debris = [], [], []
    for o in parts:
        vzs = [v.co.z for v in o.data.vertices]
        if not vzs:
            continue  # the loose-split empties the source object
        cz = sum(vzs) / len(vzs)
        frac = (cz - span_lo) / span
        span_o = max(vzs) - min(vzs)
        if len(vzs) < MIN_VERTS and span_o < 0.05:
            debris.append(o)
        elif frac > HALO_FRAC:
            halo_comps.append(o)
        else:
            body_comps.append(o)
    for o in debris:
        bpy.data.objects.remove(o, do_unlink=True)

    # join halo comps → one rigid object; join body comps → one object
    def join_group(objs, name):
        if not objs:
            return None
        if len(objs) > 1:
            bpy.ops.object.select_all(action="DESELECT")
            for o in objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        obj.name = name
        return obj

    body = join_group(body_comps, "ZolaBody")
    halo = join_group(halo_comps, "ZolaHalo")
    log(f"body comps: {len(body_comps)} | halo comps: {len(halo_comps)}")

    # joined objects carry all materials — the join sources are dead refs
    pbr_mats = []
    for o in [body, halo]:
        if o is None or o.type != "MESH":
            continue
        for slot in o.data.materials:
            if slot is not None and slot not in pbr_mats:
                pbr_mats.append(slot)
    authored_pbr(pbr_mats)

    # import the clip armature (remap + fit)
    clip_objs = import_glb(clip_path)
    arm = next((o for o in clip_objs if o.type == "ARMATURE"), None)
    for o in clip_objs:
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    if arm is None:
        return None, None
    zs = [v for b in arm.data.bones for v in (b.head_local.z, b.tail_local.z)]
    skel_h = max(zs) - min(zs)
    n = remap_armature(arm, skel_h)
    arm.scale = (TARGET_HEIGHT / skel_h,) * 3
    bpy.context.view_layer.update()
    log(f"{os.path.basename(clip_path)}: remapped {n} landmark bones")

    # auto-weight ONLY the body (halo never deforms)
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")

    # rigid-parent the halo to the Head bone
    if halo:
        bpy.ops.object.select_all(action="DESELECT")
        halo.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        halo.parent = arm
        halo.parent_bone = "Head"
        halo.parent_type = "BONE"
        # clear the transform so it follows the bone rest position
        halo.matrix_parent_inverse.identity()
        halo.location = (0, 0, 0)
        halo.rotation_euler = (0, 0, 0)
        halo.scale = (1, 1, 1)
        log("halo: rigid → Head bone")
    return arm, body

def main():
    clips = sorted(f for f in os.listdir(ANIMS_DIR) if f.endswith(".glb"))
    log(f"clips: {len(clips)}")
    ok = 0
    for clip in clips:
        arm, body = build_scene_for_clip(os.path.join(ANIMS_DIR, clip))
        if arm is None:
            log(f"SKIP {clip}")
            continue
        out = os.path.join(OUT_DIR, "v2_" + clip)
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=True)
        ok += 1
        log(f"exported {os.path.basename(out)}")
    log(f"DONE: {ok}/{len(clips)} clips (halo rigid, authored PBR)")

main()
