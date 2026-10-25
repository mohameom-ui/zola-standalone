"""Structural tests for the prototype's physical and control contracts."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prepare import ASSETS, CONTROLLED_JOINTS, build_model, generate, inertia, load_profile, urdf_xml, validate_model


class PrototypeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        repository = Path(__file__).resolve().parents[2]
        cls.temp_root = (repository/"Saved"/"isaac-tests").resolve()
        if not cls.temp_root.is_relative_to(repository):
            raise ValueError("Test temporary output must stay in the repository")
        cls.temp_root.mkdir(parents=True, exist_ok=True)

    def setUp(self):
        self.profile = load_profile()
        self.model = build_model(self.profile)

    def test_articulation_tree_and_action_contract(self):
        self.assertEqual(len(self.model["joints"]), 37)
        self.assertEqual(len(self.model["links"]), 38)
        self.assertEqual(len(CONTROLLED_JOINTS), 12)
        self.assertFalse(self.model["hardware_calibrated"])
        validate_model(self.model)

    def test_urdf_encodes_mass_inertia_and_limits_for_every_link_and_joint(self):
        tree = ET.fromstring(urdf_xml(self.model))
        for body in tree.findall("link"):
            self.assertGreater(float(body.find("inertial/mass").get("value")), 0)
            tensor = body.find("inertial/inertia")
            diagonal = [float(tensor.get(key)) for key in ("ixx", "iyy", "izz")]
            self.assertTrue(all(v > 0 for v in diagonal))
            self.assertTrue(all(2*v <= sum(diagonal)+1e-12 for v in diagonal))
        for joint in tree.findall("joint"):
            limit = joint.find("limit")
            self.assertLess(float(limit.get("lower")), float(limit.get("upper")))
            self.assertGreater(float(limit.get("effort")), 0)
            self.assertGreater(float(limit.get("velocity")), 0)

    def test_left_right_geometry_and_mass_match(self):
        links = {v["name"]: v for v in self.model["links"]}
        for name, link in links.items():
            if name.startswith("left_"):
                other = links[name.replace("left_", "right_", 1)]
                self.assertEqual(link["mass"], other["mass"])
                self.assertEqual(link["size"], other["size"])
                self.assertEqual(inertia(link), inertia(other))
        joints = {v["name"]: v for v in self.model["joints"]}
        for name, joint in joints.items():
            if name.startswith("left_"):
                other = joints[name.replace("left_", "right_", 1)]
                self.assertEqual(joint["origin"][0], other["origin"][0])
                self.assertAlmostEqual(joint["origin"][1], -other["origin"][1])
                self.assertEqual(joint["origin"][2], other["origin"][2])

    def test_feet_start_on_ground_and_head_is_above_hips(self):
        positions = {"pelvis": (0, 0, self.model["base_height"])}
        for j in self.model["joints"]:
            positions[j["child"]] = tuple(a+b for a, b in zip(positions[j["parent"]], j["origin"]))
        for link in self.model["links"]:
            if link["name"].endswith("_foot"):
                bottom = positions[link["name"]][2]+link["center"][2]-link["size"][2]/2
                self.assertAlmostEqual(bottom, 0)
        self.assertGreater(positions["head"][2], positions["pelvis"][2]+.5)

    def test_invalid_physics_and_hardware_mode_are_rejected(self):
        bad = copy.deepcopy(self.model)
        bad["links"][0]["mass"] = -1
        with self.assertRaises(ValueError): validate_model(bad)
        bad = copy.deepcopy(self.model)
        bad["joints"][0]["parent"] = "head"
        with self.assertRaises(ValueError): validate_model(bad)
        with tempfile.TemporaryDirectory(dir=self.temp_root) as folder:
            path = Path(folder)/"profile.json"
            self.profile["hardware_calibrated"] = True
            path.write_text(json.dumps(self.profile))
            with self.assertRaises(ValueError): load_profile(path)

    def test_output_is_reproducible(self):
        with tempfile.TemporaryDirectory(dir=self.temp_root) as folder:
            path = Path(folder)
            generate(output=path)
            first = (path/"zola_prototype.urdf").read_bytes()
            generate(output=path)
            self.assertEqual(first, (path/"zola_prototype.urdf").read_bytes())

    def test_usd_physics_matches_urdf(self):
        try:
            from pxr import Usd, UsdPhysics
            from export_usd import export_model
        except ImportError:
            self.skipTest("pxr is needed to validate the USD Physics artifact")
        with tempfile.TemporaryDirectory(dir=self.temp_root) as folder:
            stage = Usd.Stage.Open(str(export_model(Path(folder)/"robot.usda")))
            self.assertEqual(stage.GetDefaultPrim().GetPath().pathString, "/Zola")
            bodies = [p for p in stage.Traverse() if p.HasAPI(UsdPhysics.RigidBodyAPI)]
            joints = [p for p in stage.Traverse() if p.IsA(UsdPhysics.RevoluteJoint)]
            self.assertEqual(len(bodies), 38)
            self.assertEqual(len(joints), 37)
            for prim in bodies:
                self.assertGreater(UsdPhysics.MassAPI(prim).GetMassAttr().Get(), 0)
            for prim in joints:
                joint = UsdPhysics.RevoluteJoint(prim)
                self.assertTrue(stage.GetPrimAtPath(joint.GetBody0Rel().GetTargets()[0]))
                self.assertTrue(stage.GetPrimAtPath(joint.GetBody1Rel().GetTargets()[0]))


if __name__ == "__main__": unittest.main()
