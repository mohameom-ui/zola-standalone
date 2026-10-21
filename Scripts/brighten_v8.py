# THE PAINT PASS — lift the baked albedo on the solid body (quarantine)
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="C:/Users/self_/ZOLA-standalone/public/assets/models/gen-zola-v7-solid.glb")
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            bc = n.inputs['Base Color']
            if hasattr(bc, 'default_value') and not bc.is_linked:
                c = list(bc.default_value)
                for i in range(3):
                    c[i] = min(1.0, c[i] * 1.5 + 0.06)
                bc.default_value = c
            n.inputs['Roughness'].default_value = max(0.65, n.inputs['Roughness'].default_value)
            n.inputs['Metallic'].default_value = min(0.2, n.inputs['Metallic'].default_value)
bpy.ops.export_scene.gltf(filepath="C:/Users/self_/ZOLA-standalone/public/assets/models/gen-zola-v8-bright.glb", export_format="GLB")
print("[bright] exported gen-zola-v8-bright.glb", flush=True)
