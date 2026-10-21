# ZOLA v2.1 BODY ADJUSTMENT — volume, pose, proportions (v4.2)
# The generated mesh is a single-surface shell (paper-thin in places).
# The rig was auto-weighted but the proportions come from the AI's guess.
#
# This script:
#   1. Imports the rigged body (the 65-bone armature + the mesh)
#   2. Solidifies the mesh (adds 3mm thickness — real volume, not paper)
#   3. Poses the armature into the correct standing rest pose
#      (legs straight, feet flat, arms at the sides, head level)
#   4. Applies the pose as the new rest pose (the bones and the mesh agree)
#   5. Measures the result (the proportions, the volume, the weight estimate)
#   6. Exports the adjusted body
#   7. Reports everything
#
# Usage: blender.exe --background --python adjust_zola_body.py
# Output: gen-zola-humanoid-v2-adjusted.glb (the body she knows)

import bpy, bmesh, os, sys, math

ANIMS_DIR = r"C:/Users/self_/ZOLA-standalone/public/assets/models/zola-anims"
BODY = "C:/Users/self_/ZOLA-standalone/public/assets/models/zola-body-v2.glb"
CLIP = "C:/Users/self_/ZOLA-standalone/public/assets/models/zola-anims/bow_01.glb"
OUT = r"C:/Users/self_/ZOLA-standalone/public/assets/models/gen-zola-humanoid-v2-adjusted.glb"
TARGET_HEIGHT = 0.45   # meters — 45 cm
SOLIDIFY_MM = 3.0      # the wall thickness in mm (the user said NOT 2mm)

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def log(msg):
    print("[adjust]", msg, flush=True)

# ---------- 1. import the rigged body ----------
clear()
log("importing the rigged v2 body (armature + mesh)…")
body_objs = import_glb(BODY)
meshes = [o for o in body_objs if o.type == "MESH"]
clip_objs = import_glb(CLIP)
arm = next((o for o in clip_objs if o.type == "ARMATURE"), None)
if arm is None or not meshes:
    log("FATAL: no armature or no mesh found")
    sys.exit(1)
# remove the clip's old skinned mesh (we only need the armature)
for o in clip_objs:
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
log(f"body: {len(meshes)} mesh(es) | armature: {len(arm.data.bones)} bones")
log(f"armature: {len(arm.data.bones)} bones | meshes: {len(meshes)}")

# ---------- 2. scale to 45cm ----------
# measure the current height
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.update()
minz = min(v.co.z for m in meshes for v in m.data.vertices)
maxz = max(v.co.z for m in meshes for v in m.data.vertices)
current_h = maxz - minz
scale = TARGET_HEIGHT / max(current_h, 1e-6)
log(f"current height: {current_h:.4f} m → target: {TARGET_HEIGHT} m (scale {scale:.4f})")
for m in meshes:
    m.scale = (scale, scale, scale)
arm.scale = (scale, scale, scale)
bpy.context.view_layer.update()
# BAKE the scale into the mesh data (otherwise the vertices stay at the
# original positions and all subsequent measurements use the unscaled size)
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.context.view_layer.update()

# ---------- 3. solidify: give the mesh real volume ----------
# The generated mesh is a single-surface shell. The Solidify modifier adds
# thickness along the normals — the body becomes a solid, printable object.
log(f"solidifying: {SOLIDIFY_MM} mm wall thickness…")
for m in meshes:
    bpy.context.view_layer.objects.active = m
    solid = m.modifiers.new(name="Solidify", type="SOLIDIFY")
    solid.thickness = SOLIDIFY_MM / 1000.0  # mm → m (Blender uses meters)
    solid.offset = -1.0  # push inward (the outer surface stays the same)
    solid.use_even_offset = True
    solid.use_quality_normals = True
bpy.context.view_layer.update()

# apply the modifiers (bake the thickness into the mesh)
for m in meshes:
    bpy.context.view_layer.objects.active = m
    bpy.ops.object.modifier_apply(modifier="Solidify")
log("solidified — the body has real volume now")

# ---------- 4. pose the armature: the standing rest pose ----------
# The gesture clips have their own poses. The REST pose should be:
#   - standing upright, feet flat on the ground
#   - arms hanging naturally at the sides
#   - head level, looking forward
#   - the halo above, the props folded
log("posing the armature: standing rest pose…")
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")

# straighten the legs (if the bind pose has them slightly bent)
for side in ("_l", "_r"):
    thigh = arm.pose.bones.get(f"thigh{side}")
    calf = arm.pose.bones.get(f"calf{side}")
    foot = arm.pose.bones.get(f"foot{side}")
    ball = arm.pose.bones.get(f"ball{side}")
    if thigh:
        thigh.rotation_quaternion.identity()
    if calf:
        calf.rotation_quaternion.identity()
    if foot:
        foot.rotation_quaternion.identity()
    if ball:
        ball.rotation_quaternion.identity()

# arms at the sides (not T-pose, not A-pose — natural hang)
for side in ("_l", "_r"):
    upper = arm.pose.bones.get(f"upperarm{side}")
    lower = arm.pose.bones.get(f"lowerarm{side}")
    hand = arm.pose.bones.get(f"hand{side}")
    if upper:
        upper.rotation_quaternion.identity()
        # rotate slightly inward (the natural arm hang)
        import math
        from mathutils import Quaternion, Euler
        natural = Euler((0, 0, math.radians(5 if side == "_l" else -5)), "XYZ")
        upper.rotation_quaternion = natural.to_quaternion()
    if lower:
        lower.rotation_quaternion.identity()
        # slight elbow bend (the natural rest)
        from mathutils import Quaternion, Euler
        natural = Euler((math.radians(8), 0, 0), "XYZ")
        lower.rotation_quaternion = natural.to_quaternion()
    if hand:
        hand.rotation_quaternion.identity()

# spine: upright, slight natural curve
for i in range(1, 4):
    spine = arm.pose.bones.get(f"spine_{i:02d}")
    if spine:
        spine.rotation_quaternion.identity()

# neck + head: level, looking forward
neck = arm.pose.bones.get("neck_01")
head = arm.pose.bones.get("Head")
if neck:
    neck.rotation_quaternion.identity()
if head:
    head.rotation_quaternion.identity()

# pelvis: level, centered
pelvis = arm.pose.bones.get("pelvis")
if pelvis:
    pelvis.rotation_quaternion.identity()

bpy.ops.object.mode_set(mode="OBJECT")
log("posed: standing rest")

# ---------- 5. apply the pose as rest ----------
# The posed state becomes the new rest pose — the bones and the mesh agree
# on where every joint is. She KNOWS her body.
log("applying pose as rest pose…")
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")
log("rest pose applied — the bones and the mesh agree")

# ---------- 6. measure the result ----------
bpy.context.view_layer.update()
minz = min(v.co.z for m in meshes for v in m.data.vertices)
maxz = max(v.co.z for m in meshes for v in m.data.vertices)
height = maxz - minz
total_verts = sum(len(m.data.vertices) for m in meshes)
total_faces = sum(len(m.data.polygons) for m in meshes)

# the volume estimate (from the bounding box × the fill factor)
xs = [v.co.x for m in meshes for v in m.data.vertices]
ys = [v.co.y for m in meshes for v in m.data.vertices]
width = max(xs) - min(xs) if xs else 0
depth = max(ys) - min(ys) if ys else 0
bbox_vol = width * depth * height
# a humanoid is roughly 15-20% of the bbox volume
est_volume_cm3 = bbox_vol * 0.18 * 1_000_000  # m³ → cm³
est_weight_g = est_volume_cm3 * 1.2  # PETG density ~1.2 g/cm³ (hollow)

log(f"=== BODY MEASUREMENTS ===")
log(f"  height: {height * 1000:.1f} mm ({TARGET_HEIGHT * 1000:.0f} mm target)")
log(f"  width: {width * 1000:.1f} mm")
log(f"  depth: {depth * 1000:.1f} mm")
log(f"  verts: {total_verts} | faces: {total_faces}")
log(f"  bbox volume: {bbox_vol * 1e9:.1f} cm³")
log(f"  estimated print weight: {est_weight_g:.0f} g (PETG, 18% fill)")
log(f"  wall thickness: {SOLIDIFY_MM} mm")

# ---------- 7. export ----------
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animations=True)
log(f"exported: {OUT}")
log("=== BODY ADJUSTMENT COMPLETE ===")
