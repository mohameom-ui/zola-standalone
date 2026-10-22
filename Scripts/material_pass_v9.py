# material_pass_v9.py — the STUDIO FINISH pass (run inside Blender)
#   blender --background --python Scripts/material_pass_v9.py
#
# Upgrades her body's MATERIALS only — zero geometry edits, so the 65-bone
# skin weights survive untouched:
#   1. metallic 0.2 -> 0.45, roughness 0.9 -> 0.5 — the rim light finally
#      has something to rake across (she was matte plastic before)
#   2. clearcoat 0.55 / coat roughness 0.25 — the glazed-shell look of a
#      cared-for machine; exports as KHR_materials_clearcoat (three.js reads it)
#   3. shade smooth by angle — clean highlights instead of faceted flats
#   4. exports rigged_base_v9.glb next to the original (original untouched)
import bpy, os

SRC = os.path.abspath("public/assets/models/zola-anims/v2/rigged_base.glb")
OUT = os.path.abspath("public/assets/models/zola-anims/v2/rigged_base_v9.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

for ob in bpy.data.objects:
    if ob.type != "MESH":
        continue
    # shade smooth — the highlights slide along the shell instead of breaking
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth()
    # auto smooth by angle keeps hard mechanical edges crisp
    if hasattr(ob.data, "use_auto_smooth"):
        ob.data.use_auto_smooth = True
        ob.data.auto_smooth_angle = 0.523599  # 30 degrees
    for poly in ob.data.polygons:
        poly.use_smooth = True

for mat in bpy.data.materials:
    bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.use_nodes else None
    if not bsdf:
        continue
    bsdf.inputs["Metallic"].default_value = 0.45
    bsdf.inputs["Roughness"].default_value = 0.5
    # clearcoat — the cared-for-machine glaze (Blender 4+/5 input name)
    for coat_name in ("Coat Weight", "Clearcoat"):
        if coat_name in bsdf.inputs:
            bsdf.inputs[coat_name].default_value = 0.55
            break
    for coat_rough in ("Coat Roughness", "Clearcoat Roughness"):
        if coat_rough in bsdf.inputs:
            bsdf.inputs[coat_rough].default_value = 0.25
            break
    # a whisper of emissive warmth so her shell never reads as dead plastic
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 0.12
        bsdf.inputs["Emission Color"].default_value = (1.0, 0.82, 0.45, 1.0)

# sanity: the rig must survive — count armature bones
bones = 0
for ob in bpy.data.objects:
    if ob.type == "ARMATURE":
        bones = len(ob.data.bones)
print(f"[v9] bones preserved: {bones}")

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True)
print(f"[v9] exported: {OUT}")
