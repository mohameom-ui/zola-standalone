# THE WELD EXPERIMENT — fuse the 7300-island union into ONE solid body
# via voxel remesh. Quarantined export; the v5 body stays untouched.
import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="C:/Users/self_/ZOLA-standalone/public/assets/models/gen-zola-v5-humanoid.glb")
m = next(o for o in bpy.data.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = m
bpy.ops.object.select_all(action="DESELECT")
m.select_set(True)

# weld: voxel remesh at a resolution that keeps her silhouette detail
m.data.remesh_voxel_size = 0.008
bpy.ops.object.voxel_remesh()
print(f"[weld] after remesh: {len(m.data.vertices)} verts, {len(m.data.polygons)} faces", flush=True)

bpy.ops.export_scene.gltf(filepath="C:/Users/self_/ZOLA-standalone/public/assets/models/gen-zola-v7-solid.glb", export_format="GLB")
print("[weld] exported gen-zola-v7-solid.glb (quarantine — decide after visual check)", flush=True)
