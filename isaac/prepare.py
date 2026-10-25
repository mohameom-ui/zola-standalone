"""Build the explicit, uncalibrated Zola physics prototype using the standard library.

This tool never connects to hardware. Generated URDF and metadata are versioned
alongside the task so the exact mechanics used by an experiment are reviewable.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "zola_isaac" / "assets"
CONTROLLED_JOINTS = tuple(
    f"{side}_{role}"
    for side in ("left", "right")
    for role in ("hip_yaw", "hip_roll", "hip_pitch", "knee", "ankle_pitch", "ankle_roll")
)
COLORS = {"white": (0.78, 0.85, 0.9, 1), "dark": (0.025, 0.055, 0.085, 1),
          "gold": (0.65, 0.43, 0.13, 1), "cyan": (0.04, 0.75, 0.8, 1)}


def load_profile(path: Path = HERE / "zola_prototype.json") -> dict:
    profile = json.loads(path.read_text(encoding="utf-8"))
    if profile.get("hardware_calibrated") is not False:
        raise ValueError("This generator is for the simulation prototype only")
    for group in ("dimensions", "masses_kg"):
        for name, value in profile[group].items():
            if not isinstance(value, (float, int)) or not math.isfinite(value) or value <= 0:
                raise ValueError(f"{group}.{name} must be finite and positive")
    for name, drive in profile["drives"].items():
        if any(not math.isfinite(v) or v <= 0 for v in drive.values()):
            raise ValueError(f"Invalid drive {name}")
    d = profile["dimensions"]
    if not 0 < d["ankle_height"] < d["knee_height"] < d["hip_joint_height"] < d["waist_height"] < d["shoulder_height"] < d["neck_height"]:
        raise ValueError("Prototype anatomical landmarks must be ordered bottom to top")
    if not 0 <= profile["contact"]["dynamic_friction"] <= profile["contact"]["static_friction"]:
        raise ValueError("Invalid contact friction")
    return profile


def build_model(profile: dict) -> dict:
    d, masses = profile["dimensions"], profile["masses_kg"]
    links, joints = [], []

    def link(name, size, mass, center=(0, 0, 0), color="white", collision=True):
        links.append(dict(name=name, size=list(size), mass=mass, center=list(center),
                          color=color, collision=collision))
        return name

    def joint(name, parent, child, origin, axis, limits, drive, source_bone=None):
        joints.append(dict(name=name, parent=parent, child=child, origin=list(origin),
                           axis=list(axis), lower=limits[0], upper=limits[1],
                           drive=dict(profile["drives"][drive]), source_bone=source_bone))
        return child

    def carrier(name):
        return link(name, (.025, .025, .025), masses["carrier"], color="dark", collision=False)

    pelvis = link("pelvis", (.18, .25, .17), masses["pelvis"], color="dark")
    torso = link("torso", (.18, .32, .40), masses["torso"], (0, 0, .18), "white")
    joint("waist_yaw", pelvis, torso, (0, 0, d["waist_height"]-d["hip_height"]), (0, 0, 1), (-.5, .5), "waist", "spine_01")
    neck = carrier("neck_yaw_link")
    joint("neck_yaw", torso, neck, (0, 0, d["neck_height"]-d["waist_height"]), (0, 0, 1), (-1.1, 1.1), "neck", "neck_01")
    head = link("head", (.18, .20, .24), masses["head"], (0, 0, .145), "white")
    joint("neck_pitch", neck, head, (0, 0, 0), (0, 1, 0), (-.6, .6), "neck", "Head")
    # THE COLLAR'S FOUR ROTORS (the V12 canon): separate links frozen to the
    # NECK by ±0.001-rad joints — a fixed joint would weld them away in
    # PhysX, and external wrenches only reach force-at-CoM in this build, so
    # the rotors must be their OWN bodies. Two fans per side of the neck,
    # mounted at the collar (the neck base) — the V12 design's docking hub.
    for corner, (cx, cy) in (("front_left", (1, 1)), ("front_right", (1, -1)),
                             ("rear_left", (-1, 1)), ("rear_right", (-1, -1))):
        thruster = link(f"collar_{corner}_thruster", (.035, .035, .03), masses["carrier"],
                        (cx*d["collar_half_width"], cy*d["collar_half_depth"], .02), "cyan", collision=False)
        joint(f"collar_{corner}_mount", neck, thruster,
              (cx*d["collar_half_width"], cy*d["collar_half_depth"], .02), (0, 0, 1), (-.001, .001), "neck", None)

    for side, sign, suffix in (("left", 1, "l"), ("right", -1, "r")):
        shoulder_pitch = carrier(f"{side}_shoulder_pitch_link")
        joint(f"{side}_shoulder_pitch", torso, shoulder_pitch,
              (0, sign*d["shoulder_half_width"], d["shoulder_height"]-d["waist_height"]),
              (0, 1, 0), (-2.4, 1.2), "shoulder", f"upperarm_{suffix}")
        shoulder_roll = carrier(f"{side}_shoulder_roll_link")
        joint(f"{side}_shoulder_roll", shoulder_pitch, shoulder_roll, (0, 0, 0), (1, 0, 0), (-1.6, 1.6), "shoulder", f"upperarm_{suffix}")
        upper_arm = link(f"{side}_upper_arm", (.08, .08, d["upper_arm_length"]*.88), masses["upper_arm"], (0, 0, -d["upper_arm_length"]/2))
        joint(f"{side}_shoulder_yaw", shoulder_roll, upper_arm, (0, 0, 0), (0, 0, 1), (-1.5, 1.5), "shoulder", f"upperarm_{suffix}")
        forearm = link(f"{side}_forearm", (.075, .075, d["forearm_length"]*.88), masses["forearm"], (0, 0, -d["forearm_length"]/2))
        joint(f"{side}_elbow", upper_arm, forearm, (0, 0, -d["upper_arm_length"]), (0, 1, 0), (-2.3, .15), "elbow", f"lowerarm_{suffix}")
        wrist = carrier(f"{side}_wrist_pitch_link")
        joint(f"{side}_wrist_pitch", forearm, wrist, (0, 0, -d["forearm_length"]), (0, 1, 0), (-.7, .7), "wrist", f"hand_{suffix}")
        palm = link(f"{side}_palm", (.045, .08, d["palm_length"]), masses["palm"], (0, 0, -d["palm_length"]/2))
        joint(f"{side}_wrist_roll", wrist, palm, (0, 0, 0), (1, 0, 0), (-.7, .7), "wrist", f"hand_{suffix}")
        for number, finger in enumerate(("thumb", "index", "middle", "ring", "pinky")):
            finger_link = link(f"{side}_{finger}", (.018, .013, d["finger_length"]), masses["finger"], (0, 0, -d["finger_length"]/2), "dark")
            joint(f"{side}_{finger}_flex", palm, finger_link,
                  (.012 if finger == "thumb" else 0, sign*(number-2)*.016, -d["palm_length"]),
                  (0, 1, 0), (-1.2, .1), "finger", f"{finger}_01_{suffix}")

        hip_yaw = carrier(f"{side}_hip_yaw_link")
        joint(f"{side}_hip_yaw", pelvis, hip_yaw,
              (0, sign*d["hip_half_width"], d["hip_joint_height"]-d["hip_height"]), (0, 0, 1), (-.7, .7), "hip", f"thigh_{suffix}")
        hip_roll = carrier(f"{side}_hip_roll_link")
        joint(f"{side}_hip_roll", hip_yaw, hip_roll, (0, 0, 0), (1, 0, 0), (-.6, .6), "hip", f"thigh_{suffix}")
        thigh_length = d["hip_joint_height"]-d["knee_height"]
        thigh = link(f"{side}_thigh", (.11, .11, thigh_length*.9), masses["thigh"], (0, 0, -thigh_length/2))
        joint(f"{side}_hip_pitch", hip_roll, thigh, (0, 0, 0), (0, 1, 0), (-1.5, 1), "hip", f"thigh_{suffix}")
        shin_length = d["knee_height"]-d["ankle_height"]
        shin = link(f"{side}_shin", (.09, .09, shin_length*.9), masses["shin"], (0, 0, -shin_length/2))
        joint(f"{side}_knee", thigh, shin, (0, 0, -thigh_length), (0, 1, 0), (0, 2.3), "knee", f"calf_{suffix}")
        ankle = carrier(f"{side}_ankle_pitch_link")
        joint(f"{side}_ankle_pitch", shin, ankle, (0, 0, -shin_length), (0, 1, 0), (-.8, .6), "ankle", f"foot_{suffix}")
        foot = link(f"{side}_foot", (d["foot_length"], d["foot_width"], d["foot_height"]), masses["foot"], (.045, 0, d["foot_height"]/2-d["ankle_height"]), "dark")
        joint(f"{side}_ankle_roll", ankle, foot, (0, 0, 0), (1, 0, 0), (-.45, .45), "ankle", f"foot_{suffix}")

    model = dict(name=profile["name"], root="pelvis", base_height=d["hip_height"],
                 links=links, joints=joints, controlled_joints=list(CONTROLLED_JOINTS),
                 hardware_calibrated=False, provenance=profile["provenance"], contact=profile["contact"])
    validate_model(model)
    return model


def inertia(link):
    x, y, z = link["size"]
    m = link["mass"]
    return (m*(y*y+z*z)/12, m*(x*x+z*z)/12, m*(x*x+y*y)/12)


def validate_model(model):
    links = {link["name"]: link for link in model["links"]}
    if len(links) != len(model["links"]):
        raise ValueError("Duplicate links")
    children, names = set(), set()
    reachable = {model["root"]}
    for joint in model["joints"]:
        if joint["name"] in names or joint["child"] in children:
            raise ValueError("Duplicate joint or multiply parented link")
        names.add(joint["name"]); children.add(joint["child"])
        if joint["parent"] not in reachable or joint["child"] not in links:
            raise ValueError("Disconnected or cyclic articulation")
        reachable.add(joint["child"])
        if not joint["lower"] <= 0 <= joint["upper"] or joint["lower"] >= joint["upper"]:
            raise ValueError("Joint zero pose must be inside its limits")
        if not math.isclose(sum(v*v for v in joint["axis"]), 1):
            raise ValueError("Joint axis must be a unit vector")
    if reachable != set(links) or not set(model["controlled_joints"]).issubset(names):
        raise ValueError("Invalid articulation or action joint map")
    for link in links.values():
        if link["mass"] <= 0 or min(link["size"]) <= 0:
            raise ValueError("Invalid mass or geometry")
        moments = inertia(link)
        if min(moments) <= 0 or any(moments[i] > sum(moments)-moments[i]+1e-12 for i in range(3)):
            raise ValueError("Invalid inertia tensor")


def urdf_xml(model):
    def vec(values): return " ".join(f"{v:.9g}" for v in values)
    root = ET.Element("robot", name=model["name"])
    root.append(ET.Comment(" SIMULATION PROTOTYPE: assumed mechanics, never hardware-calibrated "))
    for link in model["links"]:
        node = ET.SubElement(root, "link", name=link["name"])
        body = ET.SubElement(node, "inertial")
        ET.SubElement(body, "origin", xyz=vec(link["center"]), rpy="0 0 0")
        ET.SubElement(body, "mass", value=str(link["mass"]))
        ix, iy, iz = inertia(link)
        ET.SubElement(body, "inertia", ixx=str(ix), iyy=str(iy), izz=str(iz), ixy="0", ixz="0", iyz="0")
        for role in ("visual", "collision") if link["collision"] else ("visual",):
            shape = ET.SubElement(node, role)
            ET.SubElement(shape, "origin", xyz=vec(link["center"]), rpy="0 0 0")
            ET.SubElement(ET.SubElement(shape, "geometry"), "box", size=vec(link["size"]))
            if role == "visual":
                material = ET.SubElement(shape, "material", name=link["color"])
                ET.SubElement(material, "color", rgba=vec(COLORS[link["color"]]))
    for joint in model["joints"]:
        node = ET.SubElement(root, "joint", name=joint["name"], type="revolute")
        ET.SubElement(node, "parent", link=joint["parent"])
        ET.SubElement(node, "child", link=joint["child"])
        ET.SubElement(node, "origin", xyz=vec(joint["origin"]), rpy="0 0 0")
        ET.SubElement(node, "axis", xyz=vec(joint["axis"]))
        ET.SubElement(node, "limit", lower=str(joint["lower"]), upper=str(joint["upper"]), effort=str(joint["drive"]["effort"]), velocity=str(joint["drive"]["velocity"]))
        ET.SubElement(node, "dynamics", damping=str(joint["drive"]["damping"]), friction="0")
    ET.indent(root)
    return ET.tostring(root, encoding="unicode")+"\n"


def generate(profile_path=HERE / "zola_prototype.json", output=ASSETS):
    profile = load_profile(profile_path)
    model = build_model(profile)
    model["profile_sha256"] = hashlib.sha256(profile_path.read_bytes()).hexdigest()
    model["total_mass_kg"] = sum(link["mass"] for link in model["links"])
    output.mkdir(parents=True, exist_ok=True)
    (output / "zola_prototype.urdf").write_text(urdf_xml(model), encoding="utf-8")
    (output / "zola_prototype.json").write_text(json.dumps(model, indent=2)+"\n", encoding="utf-8")
    return model


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, default=HERE / "zola_prototype.json")
    args = parser.parse_args()
    model = generate(args.profile)
    print(f"Generated simulation prototype: {len(model['joints'])} joints, {len(model['links'])} links, {model['total_mass_kg']:.2f} kg (assumed)")
