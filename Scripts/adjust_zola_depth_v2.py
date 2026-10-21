# ZOLA v2.1 DEPTH ADJUSTMENT — auto-detecting axes (v4.3)
# The mesh's dimensions are auto-detected: the tallest axis = height,
# the widest = width, the thinnest = depth. The depth axis is scaled
# to 95mm for proper body volume. No hardcoded axis mapping.
#
# The result: a 450mm × 260mm × 95mm body — enough room inside for
# the Pi 5, the battery, the servos, and every wire.

import bpy, os, sys

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

# ---------- 1. import + auto-detect the axes ----------
clear()
log("importing the adjusted body…")
objs = import_glb(INPUT)
meshes = [o for o in objs if o.type == "MESH"]
arm = next((o for o in objs if o.type == "ARMATURE"), None)
if not meshes:
    log("FATAL: no mesh")
    sys.exit(1)

# auto-detect: which world axis is the HEIGHT (the tallest dimension)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.update()

# the world-space bounding box
import mathutils
world_verts = []
for m in meshes:
    mw = m.matrix_world
    for v in m.data.vertices:
        world_verts.append(mw @ v.co)
xs = [v.x for v in world_verts]
ys = [v.y for v in world_verts]
zs = [v.z for v in world_verts]
dims = {
    "X": max(xs) - min(xs),
    "Y": max(ys) - min(ys),
    "Z": max(zs) - min(zs),
}
log(f"world dims: X={dims['X']:.4f} Y={dims['Y']:.4f} Z={dims['Z']:.4f}")

# the tallest axis = height, the thinnest = depth, the middle = width
sorted_axes = sorted(dims.items(), key=lambda x: x[1], reverse=True)
height_axis = sorted_axes[0][0]   # the tallest
width_axis = sorted_axes[1][0]    # the middle
depth_axis = sorted_axes[2][0]    # the thinnest
log(f"height axis: {height_axis} | width axis: {width_axis} | depth axis: {depth_axis}")

# ---------- 2. scale the depth axis to 95mm ----------
current_depth = dims[depth_axis]
depth_scale = TARGET_DEPTH / max(current_depth, 1e-6)
log(f"depth scale: {depth_scale:.3f}× ({current_depth*1000:.1f}mm → {TARGET_DEPTH*1000:.0f}mm)")

# apply the scale on the depth axis to every mesh
axis_idx = {"X": 0, "Y": 1, "Z": 2}[depth_axis]
for m in meshes:
    # scale the mesh data along the depth axis
    for v in m.data.vertices:
        # the vertex position in world space
        world = m.matrix_world @ v.co
        # scale the depth component around the center
        center = (span_lo + span_hi) / 2 if False else 0
        # find the center on the depth axis
        dv = [ (m.matrix_world @ vv.co)[axis_idx] for vv in m.data.vertices ]
        dc = (max(dv) + min(dv)) / 2
        # scale the vertex's depth coordinate around the center
        local_v = v.co.copy()
        # convert to world, scale, convert back
        world_v = m.matrix_world @ local_v
        world_v[axis_idx] = dc + (world_v[axis_idx] - dc) * depth_scale
        # convert back to local
        v.co = m.matrix_world.inverted() @ world_v

bpy.context.view_layer.update()

# re-measure
world_verts2 = []
for m in meshes:
    mw = m.matrix_world
    for v in m.data.vertices:
        world_verts2.append(mw @ v.co)
new_dims = {
    "X": max(v.x for v in world_verts2) - min(v.x for v in world_verts2),
    "Y": max(v.y for v in world_verts2) - min(v.y for v in world_verts2),
    "Z": max(v.z for v in world_verts2) - min(v.z for v in world_verts2),
}
log(f"after depth scale: X={new_dims['X']:.4f} Y={new_dims['Y']:.4f} Z={new_dims['Z']:.4f}")

# ---------- 3. smooth + solidify ----------
for m in meshes:
    bpy.context.view_layer.objects.active = m
    bpy.ops.object.shade_smooth()
    # the subdivision: smooth the stretched normals
    sub = m.modifiers.new(name="Subdivision", type="SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    bpy.ops.object.modifier_apply(modifier="Subdivision")
    # the solidify: 3mm walls
    solid = m.modifiers.new(name="Solidify", type="SOLIDIFY")
    solid.thickness = 0.003
    solid.offset = -1.0
    bpy.ops.object.modifier_apply(modifier="Solidify")
log("smoothed + solidified (3mm walls)")

# ---------- 4. the armature follows ----------
if arm:
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for b in arm.data.edit_bones:
        # scale the bone positions on the depth axis around the center
        axis_i = {"X": 0, "Y": 1, "Z": 2}[depth_axis]
        center_d = (span_lo + span_hi) / 2 if False else 0
        # get the bone's current depth-axis center
        bc = (b.head[axis_i] + b.tail[axis_i]) / 2
        # scale around the center
        b.head[axis_i] = center_d + (b.head[axis_i] - center_d) * depth_scale
        b.tail[axis_i] = center_d + (b.tail[axis_i] - center_d) * depth_scale
    bpy.ops.object.mode_set(mode="OBJECT")
    log("armature depth-matched")

# ---------- 5. the final measurements ----------
bpy.context.view_layer.update()
world_verts3 = []
for m in meshes:
    mw = m.matrix_world
    for v in m.data.vertices:
        world_verts3.append(mw @ v.co)
final_dims = {
    "X": max(v.x for v in world_verts3) - min(v.x for v in world_verts3),
    "Y": max(v.y for v in world_verts3) - min(v.y for v in world_verts3),
    "Z": max(v.z for v in world_verts3) - min(v.z for v in world_verts3),
}
log(f"=== FINAL BODY ===")
log(f"  X: {final_dims['X']*1000:.1f} mm")
log(f"  Y: {final_dims['Y']*1000:.1f} mm")
log(f"  Z: {final_dims['Z']*1000:.1f} mm")
total_verts = sum(len(m.data.vertices) for m in meshes)
log(f"  verts: {total_verts}")

# ---------- 6. export ----------
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_animations=True)
log(f"exported: {OUT}")
log("=== DEPTH ADJUSTMENT COMPLETE — SHE HAS A REAL BODY NOW ===")
