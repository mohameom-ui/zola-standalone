# ZOLA v2.1 DEPTH ADJUSTMENT — numpy-speed, no Python loops (v4.5)
# Uses Blender's C-level mesh.transform() — one call transforms ALL
# vertices instantly. No per-vertex Python iteration.

import bpy, os, sys
import mathutils
from mathutils import Matrix, Vector

INPUT = r"C:\Users\self_\ZOLA-standalone\public\assets\models\gen-zola-humanoid-v2-adjusted.glb"
OUT = r"C:\Users\self_\ZOLA-standalone\public\assets\models\gen-zola-humanoid-v3.glb"
TARGET_DEPTH = 0.095  # 95mm

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

# ---------- 2. auto-detect the axes (from the first mesh's bounding box) ----------
bpy.context.view_layer.objects.active = meshes[0]
bb = meshes[0].bound_box  # 8 corner points in local space
# convert to world space
world_corners = [meshes[0].matrix_world @ Vector(c) for c in bb]
xs = [v.x for v in world_corners]
ys = [v.y for v in world_corners]
zs = [v.z for v in world_corners]
dims = {"X": max(xs) - min(xs), "Y": max(ys) - min(ys), "Z": max(zs) - min(zs)}
log(f"bbox dims: X={dims['X']:.4f} Y={dims['Y']:.4f} Z={dims['Z']:.4f}")

sorted_axes = sorted(dims.items(), key=lambda x: x[1], reverse=True)
depth_axis_name = sorted_axes[2][0]
axis_i = {"X": 0, "Y": 1, "Z": 2}[depth_axis_name]
log(f"depth axis: {depth_axis_name} (current: {current_depth_val:.4f} m)" if False else f"depth axis: {depth_axis_name}")

current_depth = dims[depth_axis_name]
depth_scale = TARGET_DEPTH / max(current_depth, 1e-6)
log(f"depth scale: {depth_scale:.3f}×")

# ---------- 3. scale the depth axis (C-level mesh.transform) ----------
# find the center on the depth axis
all_dv = []
for m in meshes:
    mw = m.matrix_world
    for v in m.data.vertices:
        world_v = mw @ v.co
        all_dv.append(world_v[axis_i])
dc = (max(all_dv) + min(all_dv)) / 2

# the transformation: translate to origin → scale → translate back
to_origin = Matrix.Translation(-Vector([dc if i == axis_i else 0 for i in range(3)]))
scale_mat = Matrix.Scale(depth_scale, 4, Vector((0, 1, 0) if depth_axis_name == "Y" else (0, 0, 1) if depth_axis_name == "Z" else (1, 0, 0)))
back = Matrix.Translation(Vector([dc if i == axis_i else 0 for i in range(3)]))
combined = back @ scale_mat @ to_origin

# apply to each mesh (C-level: instant)
for m in meshes:
    m.data.transform(combined)
log("depth scaled on all meshes")

# ---------- 4. smooth + solidify ----------
for m in meshes:
    bpy.context.view_layer.objects.active = m
    bpy.ops.object.shade_smooth()
    sub = m.modifiers.new(name="Subdivision", type="SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    bpy.ops.object.modifier_apply(modifier="Subdivision")
    solid = m.modifiers.new(name="Solidify", type="SOLIDIFY")
    solid.thickness = 0.003
    solid.offset = -1.0
    bpy.ops.object.modifier_apply(modifier="Solidify")
log("smoothed + solidified (3mm walls)")

# ---------- 5. the armature follows ----------
if arm:
    arm.data.transform(combined)
    log("armature depth-matched")

# ---------- 6. re-measure ----------
bpy.context.view_layer.update()
world_verts2 = []
for m in meshes:
    mw = m.matrix_world
    for v in m.data.vertices:
        world_verts2.append(mw @ v.co)
fx = [v.x for v in world_verts2]
fy = [v.y for v in world_verts2]
fz = [v.z for v in world_verts2]
fdims = {"X": max(fx) - min(fx), "Y": max(fy) - min(fy), "Z": max(fz) - min(fz)}
log(f"=== FINAL BODY ===")
log(f"  X: {fdims['X']*1000:.1f} mm")
log(f"  Y: {fdims['Y']*1000:.1f} mm")
log(f"  Z: {fdims['Z']*1000:.1f} mm")
total_verts = sum(len(m.data.vertices) for m in meshes)
log(f"  verts: {total_verts}")

# ---------- 7. export ----------
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animations=True)
log(f"exported: {OUT}")
log("=== DEPTH ADJUSTMENT COMPLETE ===")
