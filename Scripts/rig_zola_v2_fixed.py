# ZOLA v2.1 RIGGING — FIXED PIPELINE (v5)
# The root cause of the 0-skins exports is now diagnosed and fixed:
#   the armature floats ~1 m above the mesh in world space
#   (bones z 0.00..1.55 vs mesh z -1.00..0.96), so ARMATURE_AUTO
#   produced all-zero vertex groups and the GLTF exporter dropped
#   the skin entirely.
# This script fixes the chain:
#   1. import body + clip armature
#   2. scale the body to the legacy stage height (1.775 m in-file)
#   3. landmark-remap the armature to HER measured silhouette
#   4. NEW: align the armature to the mesh in world space (feet to feet)
#   5. auto-weight parent + VERIFY weights (fallback: nearest bone)
#   6. export with skins + VERIFY the GLB actually contains the skin
#
# Usage: blender.exe --background --python rig_zola_v2_fixed.py [--clip NAME.glb]

import bpy, os, sys, json, struct, mathutils

ANIMS_DIR = r"C:\Users\self_\ZOLA-standalone\public\assets\models\zola-anims"
OUT_DIR = os.path.join(ANIMS_DIR, "v2")
import os as _os
BODY = _os.environ.get("ZOLA_BODY") or "C:/Users/self_/ZOLA-standalone/public/assets/models/zola-body-v2.glb"
CLIP_EXPORT_HEIGHT = 1.775  # the legacy gesture-stage scale (legacy clips are 1.775 m in-file)

# her measured silhouette (normalized heights, from the mesh profile)
LANDMARKS = {
    "ball": 0.02, "foot": 0.05, "calf": 0.22, "thigh": 0.33,
    "pelvis": 0.36, "spine_01": 0.45, "spine_02": 0.53, "spine_03": 0.61,
    "clavicle": 0.68, "neck_01": 0.73, "Head": 0.77,
}

os.makedirs(OUT_DIR, exist_ok=True)

def log(msg):
    print("[rig-fix]", msg, flush=True)

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

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
    # NOTE: the old subtree() recursion mutated shifts[name] += s and then
    # re-propagated the mutated value when the loop reached each child —
    # a double-accumulation that cascaded exponentially down the chain and
    # blew the skeleton up (bones reaching z=110). The per-bone ancestor-sum
    # application below is the ONLY propagation needed.
    for b in eb:
        total, node, seen = 0.0, b, set()
        while node is not None and node.name not in seen:
            seen.add(node.name)
            total += shifts.get(node.name, 0)
            node = node.parent
        if abs(total) > 1e-9:
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

def bone_world_z_range(arm):
    mw = arm.matrix_world
    zs = []
    for b in arm.data.bones:
        zs.append((mw @ b.head_local).z)
        zs.append((mw @ b.tail_local).z)
    return min(zs), max(zs)

def mesh_world_z_range(meshes):
    zs = []
    for m in meshes:
        mw = m.matrix_world
        for v in m.data.vertices:
            zs.append((mw @ v.co).z)
    return min(zs), max(zs)

def align_armature_to_mesh(arm, meshes):
    """THE FIX: place the rig's feet on the mesh's feet in world space."""
    bpy.context.view_layer.update()
    bmin, bmax = bone_world_z_range(arm)
    mmin, mmax = mesh_world_z_range(meshes)
    arm.location.z += (mmin - bmin)
    bpy.context.view_layer.update()
    bmin2, bmax2 = bone_world_z_range(arm)
    log(f"aligned: bones z {bmin2:.3f}..{bmax2:.3f} vs mesh z {mmin:.3f}..{mmax:.3f}")

def vertex_weight_total(mesh, vi):
    t = 0.0
    for g in mesh.data.vertices[vi].groups:
        t += g.weight
    return t

def verify_and_repair_weights(meshes, arm):
    """Verify every vertex is bound; nearest-bone fallback for strays."""
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    segments = []
    for b in arm.data.bones:
        h = mw @ b.head_local
        t = mw @ b.tail_local
        segments.append((b.name, h, t))
    repaired = 0
    total_weight = 0.0
    for m in meshes:
        wmat = m.matrix_world
        for vi, v in enumerate(m.data.vertices):
            wt = sum(g.weight for g in v.groups)
            total_weight += wt
            if wt <= 1e-6:
                # nearest bone segment (point-to-segment distance)
                p = wmat @ v.co
                best, best_d = None, 1e9
                for name, h, t in segments:
                    d = _point_seg_d(p, h, t)
                    if d < best_d:
                        best_d, best = d, name
                if best:
                    m.vertex_groups[best].add([vi], 1.0, "REPLACE")
                    repaired += 1
    verts = sum(len(m.data.vertices) for m in meshes)
    log(f"weights: total={total_weight:.1f} repaired={repaired}/{verts} vertices")
    if total_weight < 1.0:
        raise RuntimeError("auto-weights produced nothing — check alignment")
    return repaired

def _point_seg_d(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length

def export_and_verify(out):
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB",
        export_animations=True, export_skins=True,
    )
    with open(out, "rb") as f:
        f.read(12)
        clen, _ = struct.unpack("<II", f.read(8))
        h = json.loads(f.read(clen))
    skins = h.get("skins", [])
    anims = h.get("animations", [])
    joints = len(skins[0].get("joints", [])) if skins else 0
    log(f"exported: {os.path.basename(out)} | skins={len(skins)} joints={joints} anims={len(anims)}")
    if not skins:
        raise RuntimeError(f"NO SKIN in {out} — pipeline still broken")
    return skins, anims

def build_scene_for_clip(clip_path):
    clear()
    body_objs = import_glb(BODY)
    meshes = [o for o in body_objs if o.type == "MESH"]
    body_h = measure_body(meshes)
    final_scale = CLIP_EXPORT_HEIGHT / max(body_h, 1e-6)
    for m in meshes:
        m.scale = (final_scale, final_scale, final_scale)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

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
    arm.scale = (CLIP_EXPORT_HEIGHT / skel_h,) * 3
    align_armature_to_mesh(arm, meshes)
    log(f"{os.path.basename(clip_path)}: remapped {n} landmark bones")

    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    # bone-heat check: Hunyuan meshes are non-manifold and bone heat
    # famously fails on them (65 empty groups). Fall back to envelopes.
    tot = sum(sum(g.weight for g in v.groups) for m in meshes for v in m.data.vertices)
    if tot < 1.0:
        log("bone-heat failed (non-manifold mesh) → envelope weights")
        for m in meshes:
            for vg in list(m.vertex_groups):
                m.vertex_groups.remove(vg)
            m.parent = None
            for mod in list(m.modifiers):
                if mod.type == "ARMATURE":
                    m.modifiers.remove(mod)
        bpy.ops.object.select_all(action="DESELECT")
        for m in meshes:
            m.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
    verify_and_repair_weights(meshes, arm)
    return arm, meshes

def export_rigged_base():
    """The hangar's display body: mesh + 65-bone skeleton + skin, rest pose,
    no animation — the clips bind to it by bone name at runtime."""
    arm, meshes = build_scene_for_clip(os.path.join(ANIMS_DIR, "bow_01.glb"))
    out = os.path.join(OUT_DIR, "rigged_base.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB",
        export_animations=False, export_skins=True,
    )
    with open(out, "rb") as f:
        f.read(12)
        clen, _ = struct.unpack("<II", f.read(8))
        h = json.loads(f.read(clen))
    skins = h.get("skins", [])
    joints = len(skins[0].get("joints", [])) if skins else 0
    log(f"exported: rigged_base.glb | skins={len(skins)} joints={joints} anims={len(h.get('animations', []))}")
    if not skins:
        raise RuntimeError("NO SKIN in rigged_base.glb")


def main():
    if "--base" in sys.argv:
        export_rigged_base()
        return
    only = None
    if "--clip" in sys.argv:
        only = sys.argv[sys.argv.index("--clip") + 1]
    clips = sorted(f for f in os.listdir(ANIMS_DIR)
                   if f.endswith(".glb") and (only is None or f == only))
    log(f"clips: {len(clips)}")
    ok, failed = 0, []
    for clip in clips:
        try:
            arm, meshes = build_scene_for_clip(os.path.join(ANIMS_DIR, clip))
            if arm is None:
                log(f"SKIP {clip} (no armature)")
                continue
            out = os.path.join(OUT_DIR, "v2_" + clip)
            export_and_verify(out)
            ok += 1
        except Exception as e:
            failed.append((clip, str(e)))
            log(f"FAIL {clip}: {e}")
    log(f"DONE: {ok}/{len(clips)} exported WITH skins; failures: {len(failed)}")
    for c, e in failed:
        log(f"  failed: {c} — {e}")

main()
