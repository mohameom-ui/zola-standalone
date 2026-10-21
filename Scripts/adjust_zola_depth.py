# ZOLA v2.1 DEPTH ADJUSTMENT — from paper cutout to real body (v4.3)
# The Hunyuan3D mesh is 14.5mm deep — a flat relief. A real 45cm humanoid
# needs 80-100mm of depth for the electronics, the servos, and the wires.
#
# This script:
#   1. Imports the adjusted body (450.8mm, solidified)
#   2. Scales the Z-axis (depth) to 80-100mm — proper 3D volume
#   3. Smooths the stretched geometry (the Z-stretch creates flat sides)
#   4. Solidifies again (the walls stay 3mm after the stretch)
#   5. Measures the final body (the real dimensions)
#   6. Exports the volumetric body
#
# The result: a body with DEPTH — enough room inside for the Pi 5, the
# battery, the servos, and every wire. Not a cutout. A creature.

import bpy, os, sys, math

INPUT = r"C:\Users\self_\ZOLA-standalone\public\assets\models\gen-zola-humanoid-v2-adjusted.glb"
OUT = r"C:\Users\self_\ZOLA-standalone\public\assets\models\gen-zola-humanoid-v3.glb"
TARGET_HEIGHT = 0.45
TARGET_DEPTH = 0.095  # 95mm — enough for the Pi 5, the battery, the wires
TARGET_WIDTH = 0.26   # 260mm — keep the width

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]

def log(msg):
    print("[depth]", msg, flush=True)

# ---------- 1. import ----------
clear()
log("importing the adjusted body…")
objs = import_glb(INPUT)
meshes = [o for o in objs if o.type == "MESH"]
arm = next((o for o in objs if o.type == "ARMATURE"), None)
if not meshes:
    log("FATAL: no mesh")
    sys.exit(1)
log(f"meshes: {len(meshes)} | armature: {'yes' if arm else 'no'}")

# ---------- 2. measure the current dimensions ----------
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.update()

all_verts = [v for m in meshes for v in m.data.vertices]
xs = [v.co.x for v in all_verts]
ys = [v.co.y for v in all_verts]
zs = [v.co.z for v in all_verts]
cur_w = max(xs) - min(xs)
cur_d = max(ys) - min(ys)  # the depth in the Y axis (the GLTF is Y-forward)
cur_h = max(zs) - min(zs)
log(f"current: H={cur_h:.4f} W={cur_w:.4f} D={cur_d:.4f} (m)")

# ---------- 3. scale the depth axis ----------
# the Z-scale (depth) needs to stretch from 14.5mm to ~95mm
# the X (width) and Z (height) stay the same
depth_scale = TARGET_DEPTH / max(cur_d, 1e-6)
log(f"depth scale: {depth_scale:.2f}x (from {cur_d*1000:.1f}mm to {TARGET_DEPTH*1000:.0f}mm)")

# the depth axis in the GLTF import is Y (Blender's forward axis)
# scale the Y dimension of the mesh data
for m in meshes:
    # scale in the mesh's local space
    m.data.transform(__import__("mathutils").Matrix.Scale(depth_scale, 4, (0, 1, 0)))
bpy.context.view_layer.update()

# re-measure
all_verts2 = [v for m in meshes for v in m.data.vertices]
new_d = max(v.co.y for v in all_verts2) - min(v.co.y for v in all_verts2)
log(f"after depth scale: D={new_d:.4f} m ({new_d*1000:.1f} mm)")

# ---------- 4. smooth the stretched geometry ----------
# the Z-stretch creates flat/sheared sides — the Shade Smooth + the
# Subdivision Surface modifier round the stretched surfaces
for m in meshes:
    bpy.context.view_layer.objects.active = m
    # shade smooth
    bpy.ops.object.shade_smooth()
    # subdivision surface (1 level — smooths the stretched normals)
    sub = m.modifiers.new(name="Subdivision", type="SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    # apply the subdivision
    bpy.ops.object.modifier_apply(modifier="Subdivision")
log("smoothed + subdivided")

# ---------- 5. solidify: restore the wall thickness after the stretch ----------
for m in meshes:
    bpy.context.view_layer.objects.active = m
    solid = m.modifiers.new(name="Solidify", type="SOLIDIFY")
    solid.thickness = 0.003  # 3mm
    solid.offset = -1.0
    solid.use_even_offset = True
bpy.context.view_layer.update()
# apply
for m in meshes:
    bpy.context.view_layer.objects.active = m
    bpy.ops.object.modifier_apply(modifier="Solidify")
log("solidified: 3mm walls")

# ---------- 6. re-measure the final body ----------
bpy.context.view_layer.update()
all_verts3 = [v for m in meshes for v in m.data.vertices]
fx = [v.co.x for v in all_verts3]
fy = [v.co.y for v in all_verts3]
fz = [v.co.z for v in all_verts3]
fh = max(fz) - min(fz)
fw = max(fx) - min(fx)
fd = max(fy) - min(fy)
log(f"=== FINAL BODY ===")
log(f"  height: {fh*1000:.1f} mm")
log(f"  width: {fw*1000:.1f} mm")
log(f"  depth: {fd*1000:.1f} mm")
log(f"  verts: {len(all_verts3)} | faces: {sum(len(m.data.polygons) for m in meshes)}")

# the volume estimate
bbox_vol = fw * fd * fh
est_cm3 = bbox_vol * 1000000  # m³ → cm³
est_weight = est_cm3 * 0.18 * 1.2  # 18% infill, PETG
log(f"  est. print weight: {est_weight:.0f} g")

# ---------- 7. re-check the armature ----------
if arm:
    # the armature needs to match the stretched body
    # the bones were at the 14.5mm depth — they need to spread too
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for b in arm.data.edit_bones:
        # scale the Y positions by the same depth factor
        b.head.y *= depth_scale
        b.tail.y *= depth_scale
    bpy.ops.object.mode_set(mode="OBJECT")
    log("armature depth-matched")

# ---------- 8. export ----------
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animations=True)
log(f"exported: {OUT}")
log("=== DEPTH ADJUSTMENT COMPLETE — SHE HAS A BODY NOW ===")
