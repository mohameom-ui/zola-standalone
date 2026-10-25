"""Isaac Lab 3.0 / Isaac Sim 6.2 configuration for the uncalibrated proxy."""
import json
from pathlib import Path

import isaaclab.sim as sim_utils
from isaaclab.actuators import ImplicitActuatorCfg
from isaaclab.assets import ArticulationCfg, AssetBaseCfg
from isaaclab.envs import DirectRLEnvCfg
from isaaclab.scene import InteractiveSceneCfg
from isaaclab.sim import SimulationCfg
from isaaclab.utils import configclass
from isaaclab_physx.physics import PhysxCfg
from isaaclab_physx.sim.schemas import PhysxArticulationCfg
from isaaclab_tasks.utils import PresetCfg

ASSETS = Path(__file__).resolve().parent / "assets"
MODEL = json.loads((ASSETS / "zola_prototype.json").read_text())
if MODEL["hardware_calibrated"] is not False:
    raise ValueError("Prototype tasks must use the explicit simulation profile")

_groups = {}
for joint in MODEL["joints"]:
    key = tuple(joint["drive"][v] for v in ("effort", "velocity", "stiffness", "damping"))
    _groups.setdefault(key, []).append(joint["name"])
ACTUATORS = {
    f"drive_{number}": ImplicitActuatorCfg(
        joint_names_expr=names, joint_effort_limit=key[0], joint_velocity_limit=key[1],
        stiffness=key[2], damping=key[3],
    )
    for number, (key, names) in enumerate(_groups.items())
}


@configclass
class ZolaPhysicsCfg(PresetCfg):
    isaacsim_physx: PhysxCfg = PhysxCfg()
    default = isaacsim_physx


@configclass
class ZolaSceneCfg(InteractiveSceneCfg):
    ground = AssetBaseCfg(prim_path="/World/ground", spawn=sim_utils.GroundPlaneCfg())
    robot = ArticulationCfg(
        prim_path="{ENV_REGEX_NS}/Robot",
        spawn=sim_utils.UsdFileCfg(
            usd_path=str(ASSETS / "zola_prototype.usda"),
            articulation_props=[PhysxArticulationCfg(
                enabled_self_collisions=False,
                solver_position_iteration_count=8,
                solver_velocity_iteration_count=2,
            )],
        ),
        init_state=ArticulationCfg.InitialStateCfg(
            pos=(0.0, 0.0, MODEL["base_height"]+.005),
            joint_pos={".*": 0.0}, joint_vel={".*": 0.0},
        ),
        actuators=ACTUATORS,
    )
    light = AssetBaseCfg(prim_path="/World/light", spawn=sim_utils.DomeLightCfg(intensity=1500.0))


@configclass
class ZolaBalanceCfg(DirectRLEnvCfg):
    model_profile_sha256 = MODEL["profile_sha256"]
    hardware_calibrated = False
    decimation = 2
    episode_length_s = 10.0
    action_space = 12
    observation_space = 48
    state_space = 0
    action_scale = .35
    command_ranges = ((0.0, 0.0), (0.0, 0.0), (0.0, 0.0))
    sim: SimulationCfg = SimulationCfg(dt=1/120, render_interval=decimation, physics=ZolaPhysicsCfg())
    scene: ZolaSceneCfg = ZolaSceneCfg(num_envs=32, env_spacing=5.0, replicate_physics=True, clone_in_fabric=True)


@configclass
class ZolaWalkCfg(ZolaBalanceCfg):
    command_ranges = ((.15, .5), (-.1, .1), (-.3, .3))
