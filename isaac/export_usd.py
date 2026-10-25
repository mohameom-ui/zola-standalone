"""Author a portable USD Physics articulation from the generated model.

Run with an interpreter containing pxr (Isaac Sim or Blender's bundled Python).
No Isaac runtime is required for authoring; simulator validation is a separate step.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from pxr import Gf, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade

from prepare import ASSETS, COLORS, generate, inertia


def export_model(output: Path = ASSETS / "zola_prototype.usda") -> Path:
    model = generate()
    stage = Usd.Stage.CreateNew(str(output))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    UsdPhysics.SetStageKilogramsPerUnit(stage, 1.0)
    root = UsdGeom.Xform.Define(stage, "/Zola")
    stage.SetDefaultPrim(root.GetPrim())
    root.GetPrim().SetCustomDataByKey("zola:hardwareCalibrated", False)
    root.GetPrim().SetCustomDataByKey("zola:profileSHA256", model["profile_sha256"])
    root.GetPrim().SetCustomDataByKey("zola:provenance", model["provenance"])
    root.GetPrim().SetCustomDataByKey("zola:spawnHeight", model["base_height"])

    material = UsdShade.Material.Define(stage, "/Zola/contact")
    contact = UsdPhysics.MaterialAPI.Apply(material.GetPrim())
    contact.CreateStaticFrictionAttr(model["contact"]["static_friction"])
    contact.CreateDynamicFrictionAttr(model["contact"]["dynamic_friction"])
    contact.CreateRestitutionAttr(model["contact"]["restitution"])

    # Like the URDF, the asset is rooted at the pelvis. Task spawn height
    # supplies the ground clearance once, rather than baking it into every link.
    positions = {model["root"]: (0.0, 0.0, 0.0)}
    for joint in model["joints"]:
        positions[joint["child"]] = tuple(a+b for a, b in zip(positions[joint["parent"]], joint["origin"]))

    for link in model["links"]:
        path = f"/Zola/{link['name']}"
        body = UsdGeom.Xform.Define(stage, path)
        body.AddTranslateOp().Set(Gf.Vec3d(*positions[link["name"]]))
        UsdPhysics.RigidBodyAPI.Apply(body.GetPrim())
        mass = UsdPhysics.MassAPI.Apply(body.GetPrim())
        mass.CreateMassAttr(link["mass"])
        mass.CreateCenterOfMassAttr(Gf.Vec3f(*link["center"]))
        mass.CreateDiagonalInertiaAttr(Gf.Vec3f(*inertia(link)))
        mass.CreatePrincipalAxesAttr(Gf.Quatf(1.0))
        shape = UsdGeom.Cube.Define(stage, path+"/shape")
        shape.CreateSizeAttr(1.0)
        shape.AddTranslateOp().Set(Gf.Vec3d(*link["center"]))
        shape.AddScaleOp().Set(Gf.Vec3f(*link["size"]))
        shape.CreateDisplayColorAttr([Gf.Vec3f(*COLORS[link["color"]][:3])])
        if link["collision"]:
            UsdPhysics.CollisionAPI.Apply(shape.GetPrim())
            UsdShade.MaterialBindingAPI.Apply(shape.GetPrim()).Bind(material, materialPurpose="physics")
    UsdPhysics.ArticulationRootAPI.Apply(stage.GetPrimAtPath("/Zola/"+model["root"]))

    for joint in model["joints"]:
        constraint = UsdPhysics.RevoluteJoint.Define(stage, "/Zola/joints/"+joint["name"])
        constraint.CreateBody0Rel().SetTargets([Sdf.Path("/Zola/"+joint["parent"])])
        constraint.CreateBody1Rel().SetTargets([Sdf.Path("/Zola/"+joint["child"])])
        constraint.CreateLocalPos0Attr(Gf.Vec3f(*joint["origin"]))
        constraint.CreateLocalPos1Attr(Gf.Vec3f(0.0))
        constraint.CreateLocalRot0Attr(Gf.Quatf(1.0))
        constraint.CreateLocalRot1Attr(Gf.Quatf(1.0))
        constraint.CreateAxisAttr(("X", "Y", "Z")[joint["axis"].index(1)])
        constraint.CreateLowerLimitAttr(math.degrees(joint["lower"]))
        constraint.CreateUpperLimitAttr(math.degrees(joint["upper"]))
        drive = UsdPhysics.DriveAPI.Apply(constraint.GetPrim(), "angular")
        drive.CreateTypeAttr("force")
        # USD angular targets are degrees; profile gains are Nm/radian.
        drive.CreateStiffnessAttr(joint["drive"]["stiffness"]*math.pi/180)
        drive.CreateDampingAttr(joint["drive"]["damping"]*math.pi/180)
        drive.CreateMaxForceAttr(joint["drive"]["effort"])
        drive.CreateTargetPositionAttr(0.0)
    stage.GetRootLayer().Save()
    return output


if __name__ == "__main__":
    print(export_model())
