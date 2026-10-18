# retarget_bvh.py — batch CMU BVH → Quaternius rig → GLB (run inside Blender)
# Usage:
#   blender --background --python retarget_bvh.py -- --list bvh_paths.txt --rig rig.fbx --out out_dir
# Requires a Quaternius rig exported as FBX with its armature (see recipe doc).
# BONE_MAP may need one or two edits after inspecting both armatures' bone names.

import bpy, sys, math, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opts = dict(zip(argv[0::2], argv[1::2]))
LIST, RIG, OUT = opts.get("--list", ""), opts.get("--rig", ""), opts.get("--out", "zola-anims")

# CMU BVH joint  ->  Quaternius rig joint
BONE_MAP = {
    "Hips": "Hips",
    "Spine": "Spine",
    "Spine1": "Spine1",
    "Spine2": "Chest",
    "Neck": "Neck",
    "Head": "Head",
    "LeftShoulder": "Shoulder.L",
    "LeftArm": "Arm.L",
    "LeftForeArm": "ForeArm.L",
    "LeftHand": "Hand.L",
    "RightShoulder": "Shoulder.R",
    "RightArm": "Arm.R",
    "RightForeArm": "ForeArm.R",
    "RightHand": "Hand.R",
    "LeftUpLeg": "UpLeg.L",
    "LeftLeg": "LowerLeg.L",
    "LeftFoot": "Foot.L",
    "RightUpLeg": "UpLeg.R",
    "RightLeg": "LowerLeg.R",
    "RightFoot": "Foot.R",
}

def clean_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unbind=True)

def import_bvh(path):
    bpy.ops.import_anim.bvh(filepath=path, axis_forward="-Z", axis_up="Y")
    return [o for o in bpy.context.selected_objects if o.type == "ARMATURE"][0]

def import_rig(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in set(bpy.data.objects) - before if o.type == "ARMATURE"][0]

def retarget(src, dst):
    for bone in src.pose.bones:
        target = BONE_MAP.get(bone.name)
        if not target or target not in dst.pose.bones:
            continue
        dst_bone = dst.pose.bones[target]
        # copy-constraint: source drives target
        con = dst_bone.constraints.new("COPY_ROTATION")
        con.target = src
        con.subtarget = bone.name
    # bake: sample to keyframes, clear constraints
    bpy.context.view_layer.objects.active = dst
    bpy.ops.nla.bake(frame_start=1, frame_end=int(bpy.context.scene.frame_end),
                     only_selected=True, visual_keying=True, clear_constraints=True,
                     use_current_frame=False, bake_types={"POSE"})

def export_glb(name):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{name}.glb"), export_format="GLB")

if __name__ == "__main__":
    with open(LIST) as f:
        paths = [l.strip() for l in f if l.strip() and not l.startswith("#")]
    for i, rel in enumerate(paths):
        full = os.path.join(os.path.dirname(LIST), rel) if not os.path.isabs(rel) else rel
        clean_scene()
        src = import_bvh(full)
        dst = import_rig(RIG)
        retarget(src, dst)
        name = f"gesture_{i:02d}"
        export_glb(name)
        print(f"[retarget] exported {name}.glb from {rel}")
    print("[retarget] BATCH COMPLETE")
