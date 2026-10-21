# DEBRIS CLEANUP — delete disconnected mesh fragments from the v5 body
import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:/Users/self_/ZOLA-standalone/public/assets/models/gen-zola-v5-humanoid.glb")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("[clean] meshes:", [(m.name, len(m.data.vertices)) for m in meshes])

for m in list(meshes):
    m_name = m.name
    bpy.context.view_layer.objects.active = m
    bpy.ops.object.select_all(action="DESELECT")
    m.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    # snapshot FIRST (removing objects invalidates live references)
    parts = [(o.name, len(o.data.vertices)) for o in bpy.data.objects
             if o.type == "MESH" and o.users > 0 and o.name.startswith(m.name)]
    if len(parts) <= 1:
        print(f"[clean] {m_name}: single island, nothing to remove", flush=True)
        continue
    parts.sort(key=lambda t: t[1], reverse=True)
    keep_name = parts[0][0]
    removed = 0
    for name, vcount in parts[1:]:
        if vcount < 3000:
            bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
            removed += 1
    print(f"[clean] {m_name}: kept {keep_name} ({parts[0][1]} v), removed {removed} fragments", flush=True)
    bpy.ops.object.select_all(action="DESELECT")
    keep = bpy.data.objects[keep_name]
    keep.select_set(True)
    bpy.context.view_layer.objects.active = keep
    bpy.ops.object.join()

bpy.ops.export_scene.gltf(filepath=r"C:/Users/self_/ZOLA-standalone/public/assets/models/gen-zola-v5-clean.glb", export_format="GLB")
print("[clean] exported gen-zola-v5-clean.glb")
