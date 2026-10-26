# pose_physics_check.py — THE INDEPENDENT PHYSICS VERDICT (MuJoCo)
#   python Scripts/pose_physics_check.py
#
# Isaac's effort-write path is broken in this build, so the poses' physics
# verdicts were unanswerable there. MuJoCo loads her URDF directly (pure box
# geometry — no meshes needed) and answers the real question for every canon
# pose: is it PHYSICALLY HOLDABLE by her actuator limits, or does she topple?
# Also verifies the hover: the collar thrust via xfrc_applied — MuJoCo's
# external-wrench path WORKS, unlike this Isaac build's composer.
#
# THE POSE DICTS mirror env_cfg.py's canon (SIT_POSE, HERO_POSE, FLIGHT_POSE,
# THUMBS_UP_POSE, PICTURE_POSE) — keep in sync; they are the same offsets.
import json, os
import numpy as np
import mujoco

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE_PATH = os.path.abspath(os.path.join(HERE, "..", "isaac", "zola_isaac", "assets", "zola_prototype.json"))
SOURCE_PATH = os.path.abspath(os.path.join(HERE, "..", "isaac", "zola_prototype.json"))
MJCF_PATH = os.path.abspath(os.path.join(HERE, "..", "isaac", "zola_isaac", "assets", "zola_prototype_mjcf.xml"))
PROFILE = json.load(open(PROFILE_PATH))
SOURCE = json.load(open(SOURCE_PATH))  # the dimensions live in the source profile
BASE = PROFILE["base_height"]
EFFORTS = {j["name"]: j["drive"]["effort"] for j in PROFILE["joints"]}
G = 9.81

# the canon poses (mirrored from env_cfg.py — keep in sync)
SIT_POSE = {
    "left_hip_pitch": .55, "right_hip_pitch": .55,
    "left_knee": 1.0, "right_knee": 1.0,
    "left_ankle_pitch": .45, "right_ankle_pitch": .45,
    "left_shoulder_pitch": .5, "right_shoulder_pitch": .5,
    "left_elbow": -.8, "right_elbow": -.8,
    "left_wrist_pitch": .15, "right_wrist_pitch": .15,
}
HERO_POSE = {
    "left_hip_pitch": .35, "right_hip_pitch": .35,
    "left_knee": .7, "right_knee": .7,
    "left_ankle_pitch": .35, "right_ankle_pitch": .35,
    "left_shoulder_pitch": .9, "left_elbow": -.6, "left_wrist_pitch": .15,
    "right_shoulder_pitch": -1.2, "right_elbow": -.9,
    "waist_yaw": .15, "neck_pitch": .1,
}
FLIGHT_POSE = {
    "left_shoulder_pitch": .08, "right_shoulder_pitch": .08,
    "left_shoulder_roll": .1, "right_shoulder_roll": -.1,
    "left_elbow": -.3, "right_elbow": -.3,
    "left_wrist_pitch": .05, "right_wrist_pitch": .05,
    "left_thumb_flex": -.25, "right_thumb_flex": -.25,
    "left_index_flex": -.25, "right_index_flex": -.25,
    "left_middle_flex": -.25, "right_middle_flex": -.25,
    "left_ring_flex": -.25, "right_ring_flex": -.25,
    "left_pinky_flex": -.25, "right_pinky_flex": -.25,
    "left_hip_pitch": .05, "right_hip_pitch": .05,
    "left_knee": .15, "right_knee": .15,
    "left_ankle_pitch": .03, "right_ankle_pitch": .03,
}
THUMBS_POSE = {
    "right_thumb_flex": -1.1,
    "right_index_flex": .08, "right_middle_flex": .08,
    "right_ring_flex": .08, "right_pinky_flex": .08,
    "right_shoulder_pitch": -.55, "right_elbow": -.35,
    "neck_yaw": -.2,
}
PICTURE_POSE = {
    "left_hip_roll": .08, "right_hip_roll": -.08,
    "right_shoulder_roll": .9, "right_elbow": -1.8,
    "left_shoulder_pitch": .12,
    "neck_yaw": .3, "waist_yaw": -.2,
}

TESTS = [
    ("BALANCE (stand)",   {},                          dict(hover=False, drop=0.0,    seconds=3.0)),
    ("FLIGHT (hover)",    FLIGHT_POSE,                 dict(hover=True,  drop=0.0,    seconds=5.0)),
    ("SIT (knee 1.0)",    SIT_POSE,                    dict(hover=False, drop=0.0,    seconds=4.0)),
    ("TOUCHDOWN (hero)",  HERO_POSE,                   dict(hover=False, drop=0.06,   seconds=4.0)),
    ("THUMBS UP",         THUMBS_POSE,                 dict(hover=False, drop=0.0,    seconds=3.0)),
    ("PICTURE POSE",      PICTURE_POSE,                dict(hover=False, drop=0.0,    seconds=3.0)),
]

def log(m): print(f"[pose-physics] {m}", flush=True)

def box_inertia(size, mass):
    x, y, z = size
    return (mass * (y * y + z * z) / 12, mass * (x * x + z * z) / 12, mass * (x * x + y * y) / 12)

def generate_mjcf():
    """THE MUJOCO TWIN — generated from the same canon profile as Isaac's
    URDF/USD, via ElementTree (the string-formatting draft produced broken
    nesting). The pelvis is a FREE body at the standing height; the collar
    thrusters are rigid bodies (no joint = welded to the neck); every other
    joint is a hinge with the profile's axis, range, and damping."""
    import xml.etree.ElementTree as ET
    d = SOURCE["dimensions"]
    children = {}
    for j in PROFILE["joints"]:
        children.setdefault(j["parent"], []).append(j)
    links = {l["name"]: l for l in PROFILE["links"]}

    root = ET.Element("mujoco", model="zola_prototype")
    ET.SubElement(root, "compiler", angle="radian")
    ET.SubElement(root, "option", timestep="0.002", gravity="0 0 -9.81")
    world = ET.SubElement(root, "worldbody")
    ET.SubElement(world, "geom", name="floor", type="plane", size="5 5 0.1", rgba="0.2 0.25 0.3 1")
    ET.SubElement(world, "light", pos="0 0 3", dir="0 0 -1", diffuse="0.8 0.8 0.9")

    def emit(link_name, pos, parent_el, joint=None):
        link = links[link_name]
        ix, iy, iz = box_inertia(link["size"], link["mass"])
        cx, cy, cz = link["center"]
        attrs = {"name": link_name, "pos": f"{pos[0]:.9g} {pos[1]:.9g} {pos[2]:.9g}"}
        body_el = ET.SubElement(parent_el, "body", **attrs)
        if joint is not None:
            ET.SubElement(body_el, "freejoint", name="root") if joint == "FREE" else                 ET.SubElement(body_el, "joint", name=joint["name"], type="hinge",
                              axis=f'{joint["axis"][0]:g} {joint["axis"][1]:g} {joint["axis"][2]:g}',
                              range=f'{joint["lower"]:.6g} {joint["upper"]:.6g}',
                              damping=f'{joint["drive"]["damping"]:g}')
        ET.SubElement(body_el, "inertial", pos=f"{cx:.9g} {cy:.9g} {cz:.9g}",
                      mass=f'{link["mass"]:.9g}',
                      diaginertia=f"{ix:.9g} {iy:.9g} {iz:.9g}")
        half = [s / 2 for s in link["size"]]
        ET.SubElement(body_el, "geom", name=f"{link_name}_geom", type="box",
                      size=f"{half[0]:.6g} {half[1]:.6g} {half[2]:.6g}",
                      pos=f"{cx:.9g} {cy:.9g} {cz:.9g}",
                      rgba="0.78 0.85 0.9 1")
        if not link.get("collision", True):
            body_el[-1].set("contype", "0")
            body_el[-1].set("conaffinity", "0")
        for j in children.get(link_name, []):
            frozen = j["upper"] - j["lower"] < 0.0021  # the collar mounts
            child_pos = tuple(float(v) for v in j["origin"])
            if frozen:
                emit(j["child"], child_pos, body_el, joint=None)
            else:
                emit(j["child"], child_pos, body_el, joint=j)

    emit("pelvis", (0, 0, BASE), world, joint="FREE")
    ET.indent(root, space="  ")
    xml = ET.tostring(root, encoding="unicode")
    open(MJCF_PATH, "w", encoding="utf-8").write(xml)
    log(f"MuJoCo twin generated: {MJCF_PATH}")
    return xml

def main():
    generate_mjcf()
    m = mujoco.MjModel.from_xml_path(MJCF_PATH)
    d = mujoco.MjData(m)
    # spawn STANDING: the freejoint's z at the pelvis height — the feet on 0
    d.qpos[2] = BASE
    mujoco.mj_forward(m, d)
    log(f"loaded: {m.njnt} joints, {m.nbody} bodies, {sum(m.body_mass):.2f} kg (free base: {m.jnt_type[0] == mujoco.mjtJoint.mjJNT_FREE})")
    jnames = [m.joint(i).name for i in range(m.njnt)]
    jmap = {n: i for i, n in enumerate(jnames)}
    qadr = [m.jnt_qposadr[j] for j in range(m.njnt)]
    vadr = [m.jnt_dofadr[j] for j in range(m.njnt)]
    rng = [m.jnt_range[j] for j in range(m.njnt)]
    eff = np.array([EFFORTS.get(n, 30.0) for n in jnames])
    kp, kd = 30.0, 2.0
    mass_total = float(sum(m.body_mass))
    head_bid = next(i for i in range(m.nbody) if m.body(i).name == "head")

    def run(label, pose, hover, drop, seconds):
        mujoco.mj_resetData(m, d)
        d.qpos[2] += drop
        targets = np.zeros(m.njnt)
        for jname, offset in pose.items():
            if jname in jmap:
                j = jmap[jname]
                lo, hi = rng[j]
                targets[j] = np.clip(offset, lo, hi)
        steps = int(seconds / m.opt.timestep)
        toppled_at = None
        for step in range(steps):
            for j in range(m.njnt):
                if m.jnt_type[j] != mujoco.mjtJoint.mjJNT_HINGE: continue
                q = d.qpos[qadr[j]]
                v = d.qvel[vadr[j]]
                d.qfrc_actuator[j] = np.clip(kp * (targets[j] - q) - kd * v, -eff[j], eff[j])
            if hover:
                d.xfrc_applied[head_bid, 2] = mass_total * G  # the collar thrust
            mujoco.mj_step(m, d)
            quat = d.qpos[3:7]  # MuJoCo: wxyz
            w, x, y, z = quat
            tilt = np.degrees(np.arccos(np.clip(1 - 2 * (x * x + y * y), -1, 1)))
            if tilt > 30 and toppled_at is None:
                toppled_at = step * m.opt.timestep
        height_mm = (d.qpos[2] - BASE) * 1000
        state = "HOLDS" if toppled_at is None else f"TOPPLES at {toppled_at:.2f} s"
        print(f"  {label:20s} {state:24s} tilt {tilt:5.1f}°  pelvis {height_mm:+7.1f} mm", flush=True)
        return toppled_at is None

    print(f"[pose-physics] her URDF: {m.njnt} joints, {mass_total:.2f} kg — the verdicts, by real physics:")
    results = {}
    for label, pose, opts in TESTS:
        ok = run(label, pose, **opts)
        results[label] = "HOLDS" if ok else "TOPPLES"
    print(json.dumps(results, indent=1))


main()
