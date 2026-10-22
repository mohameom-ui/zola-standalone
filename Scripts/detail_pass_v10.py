# detail_pass_v10.py — THE MECHANICAL SIGNATURE + REPAINT (run in Blender)
#   blender --background --python Scripts/detail_pass_v10.py
#
# Reuses the proven rig pipeline (rig_zola_v2_fixed.py, main() stripped) and
# adds, to EVERY clip and the base:
#   - cranial fin: her silhouette signature, weighted 100% to Head
#   - back thruster pack: weighted to spine_03
#   - chest core: a glowing disc, weighted to spine_02
#   - forearm + ankle rings: weighted to their bones
#   - the repainted albedo (Pillow-processed: contrast/color/sharp + crease
#     deepening) swapped into the body material
# Details are SEPARATE skinned meshes with exact single-bone vertex groups —
# no booleans, no welds, no non-manifold risk. Git is the backup.
import bpy, os, sys, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
RIG_SCRIPT = os.path.join(HERE, "rig_zola_v2_fixed.py")
ALBEDO_V10 = os.path.abspath("assets_src/rig/body_albedo_v10.png")
ANIMS_DIR = os.path.abspath("public/assets/models/zola-anims")
OUT_DIR = os.path.join(ANIMS_DIR, "v2")

# --- reuse the pipeline: exec its source minus the trailing main() call -----
src = open(RIG_SCRIPT, encoding="utf-8").read()
src = src[: src.rindex("main()")]
ns: dict = {"__name__": "rig_pipeline", "__file__": RIG_SCRIPT}
exec(compile(src, RIG_SCRIPT, "exec"), ns)
build_scene_for_clip = ns["build_scene_for_clip"]
export_and_verify = ns["export_and_verify"]
log = ns["log"]

def ensure_materials():
    """Created FRESH per clip — the pipeline's clear() wipes the scene (and
    these materials with it); stale references were the v10 first-run failure."""
    metal = bpy.data.materials.new("zola_detail_metal")
    metal.use_nodes = True
    b = metal.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.055, 0.06, 0.075, 1.0)
    b.inputs["Metallic"].default_value = 0.85
    b.inputs["Roughness"].default_value = 0.35
    core = bpy.data.materials.new("zola_core_glow")
    core.use_nodes = True
    c = core.node_tree.nodes["Principled BSDF"]
    c.inputs["Base Color"].default_value = (0.2, 0.12, 0.02, 1.0)
    c.inputs["Emission Color"].default_value = (1.0, 0.72, 0.25, 1.0)
    if "Emission Strength" in c.inputs:
        c.inputs["Emission Strength"].default_value = 2.2
    return metal, core

def bone_world(arm, name, end=False):
    pb = arm.pose.bones[name]
    pt = pb.tail if end else pb.head
    return arm.matrix_world @ Vector(pt)

def add_box(name, center, size, rot_z=0.0, mat=None):
    bpy.ops.mesh.primitive_cube_add(location=center)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    ob.rotation_euler = (0, 0, rot_z)
    if mat: ob.data.materials.append(mat)
    return ob

def add_ring(name, center, axis, major, minor, mat=None):
    bpy.ops.mesh.primitive_torus_add(location=center, rotation=(0, 0, 0),
                                     major_radius=major, minor_radius=minor)
    ob = bpy.context.active_object
    ob.name = name
    d = Vector(axis).normalized()
    q = Vector((0, 0, 1)).rotation_difference(d)
    ob.rotation_euler = q.to_euler()
    if mat: ob.data.materials.append(mat)
    return ob

def skin_to_bone(ob, arm, bone):
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    ob.parent = arm
    ob.matrix_parent_inverse = arm.matrix_world.inverted()

def swap_albedo():
    processed = bpy.data.images.load(ALBEDO_V10, check_existing=False)
    processed.name = "T_Superhero_Female_Dark_BaseColor_v10"
    swapped = 0
    for mat in bpy.data.materials:
        if not mat.use_nodes: continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image and \
               node.image.name.startswith("T_Superhero_Female_Dark_BaseColor"):
                node.image = processed
                swapped += 1
    return swapped

def add_details(arm, meshes):
    metal, MAT_METAL = ensure_materials()
    MAT_CORE = bpy.data.materials.get("zola_core_glow")
    scene = bpy.context.scene
    scene.frame_set(1)
    bpy.context.view_layer.objects.active = arm
    head = bone_world(arm, "Head", end=True)
    pelvis = bone_world(arm, "pelvis")
    spine3 = bone_world(arm, "spine_03")
    spine2 = bone_world(arm, "spine_02")
    fwd = Vector((head.x - pelvis.x, head.y - pelvis.y, 0))
    if fwd.length < 1e-4: fwd = Vector((0, 0, 1))
    fwd.normalize()
    back = -fwd
    up = Vector((0, 0, 1))

    # cranial fin — her silhouette signature
    fin = add_box("zola_fin", head + up * 0.055 + back * 0.035, (0.012, 0.075, 0.075),
                  rot_z=math.atan2(back.y, back.x), mat=MAT_METAL)
    skin_to_bone(fin, arm, "Head")
    # back thruster pack
    pack = add_box("zola_pack", spine3 + back * 0.075 + up * 0.01, (0.11, 0.055, 0.09),
                   rot_z=math.atan2(back.y, back.x), mat=MAT_METAL)
    skin_to_bone(pack, arm, "spine_03")
    # chest core — the glowing heart
    core = add_ring("zola_core", spine2 + fwd * 0.075, fwd, 0.028, 0.009, mat=MAT_CORE)
    skin_to_bone(core, arm, "spine_02")
    _ = metal  # the metal material is already bound to the other details
    # forearm + ankle rings
    for side in ("l", "r"):
        elbow = bone_world(arm, f"lowerarm_{side}")
        hand = bone_world(arm, f"hand_{side}")
        mid = (elbow + hand) / 2
        axis = hand - elbow
        r = add_ring(f"zola_ring_{side}", mid, axis, 0.03, 0.007, mat=MAT_METAL)
        skin_to_bone(r, arm, f"lowerarm_{side}")
        ankle = bone_world(arm, f"foot_{side}")
        calf = bone_world(arm, f"calf_{side}")
        am = (ankle + calf) / 2
        r2 = add_ring(f"zola_ankle_{side}", am, ankle - calf, 0.034, 0.007, mat=MAT_METAL)
        skin_to_bone(r2, arm, f"calf_{side}")

clips = sorted(f for f in os.listdir(ANIMS_DIR) if f.endswith(".glb"))
log(f"v10 pass over {len(clips)} clips + base")
ok, failed = 0, []
for clip in clips:
    try:
        bpy.data.objects.remove_all() if hasattr(bpy.data.objects, "remove_all") else None
        ns["clear"]()
        arm, meshes = build_scene_for_clip(os.path.join(ANIMS_DIR, clip))
        if arm is None:
            log(f"SKIP {clip}")
            continue
        add_details(arm, meshes)
        n = swap_albedo()
        out = os.path.join(OUT_DIR, "v2_" + clip)
        export_and_verify(out)
        log(f"v10 {clip}: details + albedo swap ({n} node) exported")
        ok += 1
    except Exception as e:
        failed.append((clip, str(e)))
        log(f"FAIL {clip}: {e}")

# the base — same treatment, no animation
try:
    ns["clear"]()
    arm, meshes = build_scene_for_clip(os.path.join(ANIMS_DIR, "bow_01.glb"))
    add_details(arm, meshes)
    swap_albedo()
    out = os.path.join(OUT_DIR, "rigged_base_v10.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB",
                              export_animations=False, export_skins=True)
    log(f"v10 base exported: {out}")
    ok += 1
except Exception as e:
    failed.append(("base", str(e)))
    log(f"FAIL base: {e}")

log(f"DONE: {ok} exported; failures: {len(failed)}")
for c, e in failed:
    log(f"  failed: {c} — {e}")
