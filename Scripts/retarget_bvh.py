# retarget_bvh.py — batch CMU BVH → Quaternius Universal rig → GLB (run inside Blender)
# Usage:
#   blender --background --python retarget_bvh.py -- \
#     --list gestures.txt --rig rig.gltf --out public/assets/models/zola-anims [--render 1]
# gestures.txt lines:  <path-or-relpath>:<gesture_name>   (e.g. 111_37.bvh:wave_01)
# BONE_MAP built from REAL names:
#   CMU BVH joints (read from data/111/*.bvh)  →  Quaternius Universal rig
#   (bone names parsed from Superhero_Female_FullBody.gltf skin.joints)

import bpy, sys, os, math

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opts = dict(zip(argv[0::2], argv[1::2]))
LIST, RIG = opts.get("--list", ""), opts.get("--rig", "")
OUT, RENDER = os.path.abspath(opts.get("--out", "zola-anims")), opts.get("--render", "0") == "1"
# --stride N: keyframe every Nth source frame. A BVH at 120 fps baked at the
# scene's 24 fps plays ~5x slow — acceptable for expressive gestures (the
# whole library is deliberately graceful), WRONG for locomotion: a walk must
# move at true gait speed. --stride 5 on a 120 fps BVH => real-time gait.
STRIDE = max(1, int(opts.get("--stride", "1")))

# CMU BVH joint  ->  Quaternius Universal rig bone (verified from both files)
BONE_MAP = {
    "Hips": "pelvis",
    "LowerBack": "spine_01",
    "Spine": "spine_02",
    "Spine1": "spine_03",
    "Neck": "neck_01",
    "Head": "Head",
    "LeftShoulder": "clavicle_l",
    "LeftArm": "upperarm_l",
    "LeftForeArm": "lowerarm_l",
    "LeftHand": "hand_l",
    "LeftUpLeg": "thigh_l",
    "LeftLeg": "calf_l",
    "LeftFoot": "foot_l",
    "LeftToeBase": "ball_l",
    "RightShoulder": "clavicle_r",
    "RightArm": "upperarm_r",
    "RightForeArm": "lowerarm_r",
    "RightHand": "hand_r",
    "RightUpLeg": "thigh_r",
    "RightLeg": "calf_r",
    "RightFoot": "foot_r",
    "RightToeBase": "ball_r",
}

def clean_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for block in (bpy.data.actions, bpy.data.meshes, bpy.data.armatures):
        for x in list(block):
            if x.users == 0:
                block.remove(x)

def import_bvh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=path, axis_forward="-Z", axis_up="Y")
    new = [o for o in set(bpy.data.objects) - before if o.type == "ARMATURE"]
    return new[0] if new else None

def import_rig(path):
    before = set(bpy.data.objects)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path)
    rigs = [o for o in set(bpy.data.objects) - before if o.type == "ARMATURE"]
    # prefer the armature that actually has the mapped bones
    for a in rigs:
        if "pelvis" in a.pose.bones and "upperarm_l" in a.pose.bones:
            return a
    return rigs[0] if rigs else None

def _depth(pb):
    d, b = 0, pb.bone
    while b.parent:
        d += 1
        b = b.parent
    return d

def retarget(src, dst, frame_end):
    """World-space retarget with per-bone rest-offset alignment.
    For each mapped bone: desired world rotation = rest_offset @ src_world_rot,
    where rest_offset maps the source bone's rest orientation onto the target
    bone's rest orientation. Converted to local rotation against the PARENT'S
    evaluated pose (parents processed first), then keyframed directly.
    Tolerates different bone-axis conventions between the two skeletons."""
    from mathutils import Matrix
    W_src = src.matrix_world.to_quaternion()
    W_dst = dst.matrix_world.to_quaternion()
    W_dst_inv = W_dst.inverted()
    pairs = []
    for bone in src.pose.bones:
        target = BONE_MAP.get(bone.name)
        if not target or target not in dst.pose.bones:
            continue
        db = dst.pose.bones[target]
        db.rotation_mode = "QUATERNION"
        src_rest_world = (W_src.to_matrix().to_4x4() @ bone.bone.matrix_local).to_quaternion()
        dst_rest_world = (W_dst.to_matrix().to_4x4() @ db.bone.matrix_local).to_quaternion()
        offset = dst_rest_world @ src_rest_world.inverted()   # src rest -> dst rest
        parent_rest = db.bone.parent.matrix_local.to_quaternion() if db.bone.parent else None
        bone_rest = db.bone.matrix_local.to_quaternion()
        pairs.append((bone, db, offset, parent_rest, bone_rest, _depth(db)))
    pairs.sort(key=lambda p: p[5])
    scene = bpy.context.scene
    action = bpy.data.actions.new("zola_tmp")
    dst.animation_data_create()
    dst.animation_data.action = action
    for f in range(1, frame_end + 1, STRIDE):
        scene.frame_set(f)
        out_frame = (f - 1) // STRIDE + 1   # resampled timeline: stride 5 on a
                                            # 120 fps BVH = real-time at 24 fps
        for sb, db, offset, parent_rest, bone_rest, _ in pairs:
            src_world = (src.matrix_world @ sb.matrix).to_quaternion()
            desired_arm = W_dst_inv @ (offset @ src_world)     # dst armature space
            if db.bone.parent:
                parent_eval = db.parent.matrix.to_quaternion()
                base = parent_rest.inverted() @ bone_rest      # rest offset from parent
                local = (parent_eval @ base).inverted() @ desired_arm
            else:
                local = bone_rest.inverted() @ desired_arm
            db.rotation_quaternion = local
            db.keyframe_insert("rotation_quaternion", frame=out_frame)
    scene.frame_set(1)
    return len(pairs)

def rename_action(dst, name):
    if dst.animation_data and dst.animation_data.action:
        dst.animation_data.action.name = name
        dst.name = name

def export_glb(name):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, f"{name}.glb"),
        export_format="GLB",
        export_yup=True,
        export_animation_mode="ACTIONS",
    )

def render_check(name, frame):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 480, 640
    scene.render.filepath = os.path.join(OUT, f"_check_{name}.png")
    scene.render.image_settings.file_format = "PNG"
    cam_data = bpy.data.cameras.new("checkcam")
    cam = bpy.data.objects.new("checkcam", cam_data)
    scene.collection.objects.link(cam)
    cam.location, cam.rotation_euler = (0, -3.2, 1.3), (math.radians(80), 0, 0)
    light_data = bpy.data.lights.new("checklight", type="SUN")
    light_data.energy = 3.0
    light = bpy.data.objects.new("checklight", light_data)
    scene.collection.objects.link(light)
    light.rotation_euler = (math.radians(45), 0, math.radians(30))
    scene.camera = cam
    scene.frame_set(frame)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(light, do_unlink=True)

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(LIST))
    with open(LIST) as f:
        entries = []
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            path_part, _, gesture = line.rpartition(":")
            entries.append((path_part.strip(), gesture.strip() or f"gesture_{len(entries):02d}"))
    rig_cache = None
    for rel, name in entries:
        full = rel if os.path.isabs(rel) else os.path.join(here, rel)
        clean_scene()
        src = import_bvh(full)
        if src is None:
            print(f"[retarget] SKIP {name}: no armature in {rel}")
            continue
        # the BVH's own action knows its true length — the scene may still be
        # sitting at Blender's default frame_end (250), which silently TRUNCATED
        # every earlier bake to its first 250 source frames
        src_action_probe = src.animation_data.action if src.animation_data else None
        true_end = int(src_action_probe.frame_range[1]) if src_action_probe else 0
        frame_end = max(true_end, int(bpy.context.scene.frame_end), 2)
        dst = import_rig(RIG)
        if dst is None:
            print(f"[retarget] SKIP {name}: no rig armature found")
            continue
        n = retarget(src, dst, frame_end)
        # remove the CMU skeleton AND its action so only her rig + her action ship
        src_action = src.animation_data.action if src.animation_data else None
        bpy.data.objects.remove(src, do_unlink=True)
        if src_action:
            bpy.data.actions.remove(src_action)
        rename_action(dst, name)
        print(f"[retarget] exporting {name}: dst action = {dst.animation_data.action.name if dst.animation_data and dst.animation_data.action else 'NONE'}")
        export_glb(name)
        print(f"[retarget] {name}.glb  <-  {rel}  ({n} bones mapped, {frame_end} frames)")
        if RENDER:
            render_check(name, frame_end // 2)
        # keep the rig in cache-free flow: every pass re-imports for a clean scene
    print("[retarget] BATCH COMPLETE")
