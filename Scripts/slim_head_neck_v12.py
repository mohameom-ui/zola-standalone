# slim_head_neck_v12.py — THE HEAD/NECK REFINEMENT (run in Blender)
#   blender --background --python Scripts/slim_head_neck_v12.py
#
# The runtime bone-scale slimming was REVERTED (non-uniform bone scale shears
# skinned vertices and reads flimsy). This pass does the job at the mesh
# level, at full quality:
#   - vertices weighted to the Head bone shrink in X/Z around the head bone's
#     origin, blended by their weight (smooth falloff, no seams)
#   - vertices weighted to the neck chain (neck_01) slim in X/Z around the
#     neck bone's axis line
# The skeleton, the rest pose, and every animation clip stay untouched — the
# clips animate the same bones, so compatibility is preserved exactly.
import bpy, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
BODY = os.path.abspath("public/assets/models/zola-anims/v3/zola.glb")

HEAD_SCALE = 0.87   # x/z slimming for skull vertices
NECK_SCALE = 0.80   # x/z slimming for the neck column
HEAD_WEIGHT_MIN = 0.25
NECK_WEIGHT_MIN = 0.25


def log(m): print(f"[slim_v12] {m}", flush=True)


def main():
    if not os.path.exists(BODY):
        raise SystemExit(f"body not found: {BODY}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    log(f"importing {BODY}")
    bpy.ops.import_scene.gltf(filepath=BODY)

    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not arm or not meshes:
        raise SystemExit("armature or mesh missing after import")
    log(f"armature '{arm.name}', {len(meshes)} mesh(es)")

    def bone_obj(name):
        return arm.pose.bones.get(name) or arm.data.bones.get(name)

    head_bone = bone_obj("Head")
    neck_bone = bone_obj("neck_01")
    if not head_bone or not neck_bone:
        raise SystemExit("Head/neck_01 bones not found")

    head_origin = arm.matrix_world @ Vector(head_bone.head)
    neck_head = arm.matrix_world @ Vector(neck_bone.head)
    neck_tail = arm.matrix_world @ Vector(neck_bone.tail)
    neck_axis = (neck_tail - neck_head)
    neck_len = max(neck_axis.length, 1e-6)
    neck_axis.normalize()

    total_moved = 0
    for mesh in meshes:
        me = mesh.data
        # group index lookup: vertex groups live on the OBJECT
        def group_index(name):
            for i, g in enumerate(mesh.vertex_groups):
                if g.name == name:
                    return i
            return None
        gi_head = group_index("Head")
        gi_neck = group_index("neck_01")
        if gi_head is None and gi_neck is None:
            log(f"  '{mesh.name}': no Head/neck groups — skipped")
            continue
        mw = mesh.matrix_world
        n_moved = 0
        for v in me.vertices:
            w_head = 0.0
            w_neck = 0.0
            if gi_head is not None:
                for g in v.groups:
                    if g.group == gi_head:
                        w_head = g.weight
                        break
            if gi_neck is not None:
                for g in v.groups:
                    if g.group == gi_neck:
                        w_neck = g.weight
                        break
            co_world = mw @ v.co
            if w_head >= HEAD_WEIGHT_MIN:
                # shrink X/Z around the head bone's origin, blended by weight
                factor = 1.0 - (1.0 - HEAD_SCALE) * min(1.0, (w_head - HEAD_WEIGHT_MIN) / (1.0 - HEAD_WEIGHT_MIN + 1e-6))
                d = co_world - head_origin
                d.x *= factor
                d.y *= factor
                new_world = head_origin + d
            elif w_neck >= NECK_WEIGHT_MIN:
                # slim the neck column: pull the vertex toward the neck AXIS
                # line by the slim factor, blended by weight
                rel = co_world - neck_head
                along = neck_axis * rel.dot(neck_axis)
                radial = rel - along
                factor = 1.0 - (1.0 - NECK_SCALE) * min(1.0, (w_neck - NECK_WEIGHT_MIN) / (1.0 - NECK_WEIGHT_MIN + 1e-6))
                new_world = neck_head + along + radial * factor
            else:
                continue
            v.co = mw.inverted() @ new_world
            n_moved += 1
        total_moved += n_moved
        if n_moved:
            me.update()
            log(f"  '{mesh.name}': {n_moved} vertices slimmed")

    log(f"total vertices moved: {total_moved}")
    bpy.ops.export_scene.gltf(filepath=BODY, export_skins=True, export_animations=False)
    log(f"exported {BODY} ({os.path.getsize(BODY)//1024} KB)")


main()
