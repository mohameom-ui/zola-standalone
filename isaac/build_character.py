"""Build Zola's dimensional robot body and compact motion library in Blender.

blender --background --python isaac/build_character.py -- --preview

The original motion skeleton is preserved. Geometry uses rigid, explicit bone
weights, with no envelope weighting or cumulative landmark remapping.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/assets/models/zola-anims"
OUTPUT = SOURCE / "v3"
MOTIONS = (
    "bow_01", "bow_02", "curtsey_01", "dance_01", "dance_02", "march_01",
    "wave_01", "wave_02", "shrug_01", "spin_01", "stretch_01", "throw_01",
    "peekaboo_01", "pickup_01", "rollover_01", "crawl_01", "getup_01",
    "laydown_01", "mope_01", "walk_01",
)


def read_glb(path):
    blob = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", blob)
    if magic != 0x46546C67 or version != 2 or length != len(blob):
        raise ValueError(f"Invalid GLB: {path}")
    json_length = struct.unpack_from("<I", blob, 12)[0]
    doc = json.loads(blob[20:20+json_length])
    binary_start = 20+json_length
    binary_length, binary_type = struct.unpack_from("<II", blob, binary_start)
    if binary_type != 0x004E4942:
        raise ValueError("Embedded GLB binary buffer required")
    return doc, blob[binary_start+8:binary_start+8+binary_length]


def compact_motion(source, destination, bones):
    """Keep animation accessors and named bone hierarchy; remove copied meshes/textures."""
    doc, binary = read_glb(source)
    animations = []
    used_accessors = set()
    for animation in doc.get("animations", []):
        channels = [c for c in animation["channels"] if doc["nodes"][c["target"]["node"]].get("name") in bones]
        if not channels:
            continue
        used_samplers = sorted({c["sampler"] for c in channels})
        sampler_ids = {old: new for new, old in enumerate(used_samplers)}
        samplers = [dict(animation["samplers"][i]) for i in used_samplers]
        for sampler in samplers:
            used_accessors.update((sampler["input"], sampler["output"]))
        animations.append(dict(name=source.stem, samplers=samplers,
                               channels=[dict(c, sampler=sampler_ids[c["sampler"]]) for c in channels]))
    if len(animations) != 1:
        raise ValueError(f"Expected one motion in {source}, got {len(animations)}")
    accessor_ids = {old: new for new, old in enumerate(sorted(used_accessors))}
    accessors, views, buffer = [], [], bytearray()
    for old in sorted(used_accessors):
        accessor = dict(doc["accessors"][old])
        if "sparse" in accessor:
            raise ValueError("Sparse motion accessors are not supported")
        view = dict(doc["bufferViews"][accessor["bufferView"]])
        while len(buffer) % 4:
            buffer.append(0)
        start, length = view.get("byteOffset", 0), view["byteLength"]
        view.update(buffer=0, byteOffset=len(buffer))
        buffer.extend(binary[start:start+length])
        accessor["bufferView"] = len(views)
        views.append(view); accessors.append(accessor)
    for animation in animations:
        for sampler in animation["samplers"]:
            sampler["input"] = accessor_ids[sampler["input"]]
            sampler["output"] = accessor_ids[sampler["output"]]
    clean = dict(asset={"version": "2.0", "generator": "Zola compact motion builder"},
                 scene=doc.get("scene", 0), scenes=doc["scenes"],
                 nodes=[{k: v for k, v in n.items() if k in ("name", "children", "translation", "rotation", "scale", "matrix")} for n in doc["nodes"]],
                 animations=animations, accessors=accessors, bufferViews=views,
                 buffers=[{"byteLength": len(buffer)}])
    packed = json.dumps(clean, separators=(",", ":")).encode()
    packed += b" "*((-len(packed)) % 4)
    buffer.extend(b"\0"*((-len(buffer)) % 4))
    destination.write_bytes(struct.pack("<III", 0x46546C67, 2, 28+len(packed)+len(buffer))+
                            struct.pack("<II", len(packed), 0x4E4F534A)+packed+
                            struct.pack("<II", len(buffer), 0x004E4942)+buffer)
    return destination.stat().st_size


def build():
    import bpy
    from mathutils import Quaternion, Vector

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE / "bow_01.glb"))
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    for ob in list(bpy.context.scene.objects):
        if ob != arm:
            bpy.data.objects.remove(ob, do_unlink=True)
    arm.name = "ZolaRig"
    arm.animation_data_clear()
    for bone in arm.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = (1, 0, 0, 0)
        bone.location = (0, 0, 0)
        bone.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    bones = {b.name for b in arm.data.bones}
    if len(bones) != 65:
        raise ValueError(f"Expected 65 source bones, found {len(bones)}")
    p = lambda name, tail=False: arm.matrix_world @ (arm.data.bones[name].tail_local if tail else arm.data.bones[name].head_local)

    def material(name, color, metallic, roughness, emission=0):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        shader = mat.node_tree.nodes["Principled BSDF"]
        shader.inputs["Base Color"].default_value = (*color, 1)
        shader.inputs["Metallic"].default_value = metallic
        shader.inputs["Roughness"].default_value = roughness
        if emission:
            shader.inputs["Emission Color"].default_value = (*color, 1)
            shader.inputs["Emission Strength"].default_value = emission
        return mat

    white = material("Zola_Ceramic", (.69, .79, .85), .28, .26)
    dark = material("Zola_Graphite", (.018, .035, .055), .78, .3)
    gold = material("Zola_Titanium", (.47, .28, .075), .85, .25)
    cyan = material("Zola_Core", (.025, .68, .78), .25, .25, 2)
    glass = material("Zola_Visor", (.004, .012, .025), .65, .14)
    parts = []

    def attach(ob, bone, mat, smooth=False):
        ob.data.materials.append(mat)
        group = ob.vertex_groups.new(name=bone)
        group.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
        for poly in ob.data.polygons:
            poly.use_smooth = smooth
        parts.append(ob)
        return ob

    def sphere(name, center, size, bone, mat):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, location=center)
        ob = bpy.context.object; ob.name = name; ob.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        return attach(ob, bone, mat, True)

    def box(name, center, size, bone, mat, bevel=.012):
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        ob = bpy.context.object; ob.name = name; ob.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        if bevel:
            mod = ob.modifiers.new("Armor edge", "BEVEL")
            mod.width = min(bevel, min(size)*.24); mod.segments = 3
            bpy.ops.object.modifier_apply(modifier=mod.name)
        return attach(ob, bone, mat)

    def rod(name, a, b, radius, bone, mat):
        delta = b-a
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=delta.length, location=(a+b)/2)
        ob = bpy.context.object; ob.name = name
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(delta.normalized())
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        return attach(ob, bone, mat, True)

    def ring(name, center, axis, radius, tube, bone, mat):
        bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube, major_segments=24, minor_segments=6, location=center)
        ob = bpy.context.object; ob.name = name
        ob.rotation_mode = "QUATERNION"; ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized())
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        return attach(ob, bone, mat, True)

    pelvis, spine1, spine2, chest, head = (p(n) for n in ("pelvis", "spine_01", "spine_02", "spine_03", "Head"))
    box("pelvis_frame", pelvis, (.22, .17, .17), "pelvis", dark)
    box("pelvis_front", pelvis+Vector((0, -.094, .01)), (.20, .025, .10), "pelvis", white)
    rod("waist", spine1-Vector((0, 0, .04)), spine1+Vector((0, 0, .045)), .082, "spine_01", dark)
    ring("waist_trim", spine1+Vector((0, 0, .02)), (0, 0, 1), .086, .008, "spine_01", gold)
    box("abdomen", spine2, (.19, .14, .14), "spine_02", dark)
    box("abdomen_plate", spine2+Vector((0, -.08, 0)), (.16, .022, .115), "spine_02", white)
    box("chest_frame", chest+Vector((0, 0, .025)), (.28, .16, .27), "spine_03", dark)
    for side in (-1, 1):
        box("chest_armor", chest+Vector((side*.087, -.091, .045)), (.105, .035, .235), "spine_03", white)
        box("chest_trace", chest+Vector((side*.027, -.095, .035)), (.006, .012, .19), "spine_03", cyan, .001)
    ring("core_rim", chest+Vector((0, -.112, .055)), (0, 1, 0), .033, .007, "spine_03", gold)
    sphere("core_lens", chest+Vector((0, -.116, .055)), (.024, .009, .024), "spine_03", cyan)
    box("backpack", chest+Vector((0, .112, .025)), (.17, .065, .19), "spine_03", dark)
    rod("neck", p("neck_01")-Vector((0, 0, .05)), head, .035, "neck_01", gold)
    sphere("head_shell", head+Vector((0, 0, .085)), (.102, .095, .125), "Head", white)
    box("visor", head+Vector((0, -.087, .096)), (.164, .038, .070), "Head", glass, .016)
    for side in (-1, 1):
        box("eye", head+Vector((side*.043, -.111, .10)), (.043, .006, .014), "Head", cyan, .004)
        sphere("temple", head+Vector((side*.102, 0, .085)), (.014, .036, .042), "Head", dark)
    box("crown_inlay", head+Vector((0, 0, .203)), (.025, .13, .012), "Head", gold, .003)

    for side in ("l", "r"):
        for source_name, end_name, radius in ((f"upperarm_{side}", f"lowerarm_{side}", .047),
                                               (f"lowerarm_{side}", f"hand_{side}", .043),
                                               (f"thigh_{side}", f"calf_{side}", .059),
                                               (f"calf_{side}", f"foot_{side}", .049)):
            a, b = p(source_name), p(end_name)
            direction = (b-a).normalized()
            sphere("joint", a, (radius*1.12,)*3, source_name, dark)
            rod("limb_armor", a+direction*.035, b-direction*.035, radius, source_name, white)
            ring("servo_trim", a+direction*.018, direction, radius*1.1, .006, source_name, gold)
            rod("limb_trace", a+direction*.065+Vector((0, -radius*.96, 0)), b-direction*.065+Vector((0, -radius*.96, 0)), .004, source_name, cyan)
        hand = p(f"hand_{side}")
        finger_base = sum((p(f"{n}_01_{side}") for n in ("index", "middle", "ring", "pinky")), Vector())/4
        direction = (finger_base-hand).normalized()
        rod("palm", hand, finger_base, .036, f"hand_{side}", dark)
        sphere("palm_armor", (hand+finger_base)/2+Vector((0, -.02, 0)), (.045, .025, .04), f"hand_{side}", white)
        for finger in ("thumb", "index", "middle", "ring", "pinky"):
            for number in (1, 2, 3):
                bone = f"{finger}_0{number}_{side}"
                next_bone = f"{finger}_0{number+1}_{side}" if number < 3 else f"{finger}_04_leaf_{side}"
                a, b = p(bone), p(next_bone)
                rod("finger", a, b, .009 if finger != "thumb" else .011, bone, white)
                sphere("knuckle", a, (.012,)*3, bone, dark)
        foot = p(f"foot_{side}")
        box("foot_sole", Vector((foot.x, -.005, .035)), (.11, .23, .07), f"foot_{side}", dark)
        box("foot_armor", Vector((foot.x, -.045, .074)), (.095, .14, .035), f"foot_{side}", white)
        box("foot_light", Vector((foot.x, -.119, .047)), (.064, .008, .008), f"foot_{side}", cyan, .002)

    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts: ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.object; body.name = "ZolaBody"
    modifier = body.modifiers.new("Zola articulation", "ARMATURE"); modifier.object = arm
    body.parent = arm; body.matrix_parent_inverse = arm.matrix_world.inverted()
    arm.location.z -= .905
    bpy.context.view_layer.update()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT / "zola.glb"), export_format="GLB", export_animations=False, export_skins=True)
    motion_bytes = sum(compact_motion(SOURCE / f"{name}.glb", OUTPUT / f"{name}.glb", bones) for name in MOTIONS)
    report = dict(version=11, bone_count=len(bones), motion_count=len(MOTIONS),
                  base_bytes=(OUTPUT / "zola.glb").stat().st_size, motion_bytes=motion_bytes,
                  source_rig="../bow_01.glb", skinning="explicit rigid bone weights",
                  visual_origin="feet at y=-0.905 in glTF", hardware_calibrated=False)
    (OUTPUT / "character.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print("ZOLA CHARACTER", json.dumps(report))

    if "--preview" in sys.argv:
        # Preview the same neutral shoulder pose applied by the web renderer.
        for side, angle in (("l", math.pi/2), ("r", -math.pi/2)):
            bone = arm.pose.bones[f"upperarm_{side}"]
            matrix = arm.matrix_world @ bone.matrix
            rotation = Quaternion((0, 1, 0), angle) @ matrix.to_quaternion()
            posed = rotation.to_matrix().to_4x4(); posed.translation = matrix.translation
            bone.matrix = arm.matrix_world.inverted() @ posed
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        evaluated = body.evaluated_get(graph)
        vertices = [evaluated.matrix_world @ v.co for v in evaluated.data.vertices]
        lo = Vector(tuple(min(p[i] for p in vertices) for i in range(3)))
        hi = Vector(tuple(max(p[i] for p in vertices) for i in range(3)))
        center = (lo+hi)/2
        bpy.ops.object.camera_add(location=center+Vector((2.5, -5, 1.5)))
        camera = bpy.context.object; camera.rotation_euler = (center-camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.type = "ORTHO"; camera.data.ortho_scale = (hi.z-lo.z)*1.25
        bpy.context.scene.camera = camera
        for position, energy, color in (((3, -4, 5), 1100, (1, .94, .85)), ((-3, -2, 2), 900, (.6, .8, 1)), ((1, 3, 4), 1500, (.2, .85, 1))):
            bpy.ops.object.light_add(type="AREA", location=position)
            light = bpy.context.object; light.data.energy=energy; light.data.color=color; light.data.shape="DISK"; light.data.size=3
            light.rotation_euler=(center-light.location).to_track_quat("-Z", "Y").to_euler()
        scene=bpy.context.scene; scene.render.engine="CYCLES"; scene.cycles.device="CPU"; scene.cycles.samples=24
        if scene.world is None: scene.world=bpy.data.worlds.new("Zola studio")
        scene.world.color=(.04, .055, .075)
        scene.render.resolution_x=800; scene.render.resolution_y=1000; scene.render.resolution_percentage=100
        preview=ROOT / "Saved/review/zola-v11.png"; preview.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath=str(preview); scene.render.image_settings.file_format="PNG"
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__": build()
