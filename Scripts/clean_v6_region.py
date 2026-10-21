import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="C:/Users/self_/ZOLA-standalone/public/assets/models/gen-zola-v5-humanoid.glb")
m = next(o for o in bpy.data.objects if o.type == "MESH")

# separate into islands
bpy.context.view_layer.objects.active = m
bpy.ops.object.select_all(action="DESELECT")
m.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="LOOSE")
bpy.ops.object.mode_set(mode="OBJECT")

# snapshot islands: name, vert count, world center
parts = []
for o in bpy.data.objects:
    if o.type != "MESH" or o.users <= 0 or not o.name.startswith(m.name):
        continue
    c = sum((Vector((v.co.x, 0, v.co.z)) for v in o.data.vertices), Vector()) / len(o.data.vertices)
    zs = [v.co.z for v in o.data.vertices]
    parts.append((o.name, len(o.data.vertices), c.x, c.z, min(zs), max(zs)))

# the body axis: the largest island's center
parts.sort(key=lambda t: t[1], reverse=True)
ax, az = parts[0][2], parts[0][3]
print(f"[v6-clean] axis at x={ax:.3f} z={az:.3f}", flush=True)

kept_v, removed_v, removed_n = 0, 0, 0
keep_names, remove_names = [], []
for name, vcount, x, z, zmin, zmax in parts:
    horiz = ((x - ax) ** 2 + (z - az) ** 2) ** 0.5
    if vcount >= 5000 or horiz < 0.45:
        kept_v += vcount
        keep_names.append(name)
    else:
        removed_v += vcount
        removed_n += 1
        remove_names.append(name)

print(f"[v6-clean] kept verts={kept_v} removed: {removed_n} islands / {removed_v} verts", flush=True)

for name in remove_names:
    obj = bpy.data.objects.get(name)
    if obj: bpy.data.objects.remove(obj, do_unlink=True)

# join the survivors (by name, collected BEFORE removals)
names = [n for n in keep_names if bpy.data.objects.get(n)]
bpy.ops.object.select_all(action="DESELECT")
for n in names:
    bpy.data.objects[n].select_set(True)
bpy.context.view_layer.objects.active = bpy.data.objects[names[0]]
bpy.ops.object.join()
bpy.context.view_layer.objects.active.data.transform  # no-op touch
print(f"[v6-clean] final body: {len(bpy.context.view_layer.objects.active.data.vertices)} verts", flush=True)

bpy.ops.export_scene.gltf(filepath="C:/Users/self_/ZOLA-standalone/public/assets/models/gen-zola-v6-clean.glb", export_format="GLB")
print("[v6-clean] exported gen-zola-v6-clean.glb", flush=True)
