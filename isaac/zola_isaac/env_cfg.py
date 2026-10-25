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


# the upper-limb vocabulary: shoulders, elbows, wrists, and every finger flex
ARM_JOINTS = [j["name"] for j in MODEL["joints"]
              if any(s in j["name"] for s in ("shoulder", "elbow", "wrist"))
              or j["name"].endswith("_flex")]


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
    # None = the profile's 12 leg joints; a list overrides (the hands task).
    controlled_joints: list[str] | None = None
    # >0 adds commanded-pose tracking to the reward and the targets to the
    # observations (the hands task). 0 keeps balance/walk contracts identical.
    pose_tracking_weight = 0.0
    command_ranges = ((0.0, 0.0), (0.0, 0.0), (0.0, 0.0))
    sim: SimulationCfg = SimulationCfg(dt=1/120, render_interval=decimation, physics=ZolaPhysicsCfg())
    scene: ZolaSceneCfg = ZolaSceneCfg(num_envs=32, env_spacing=5.0, replicate_physics=True, clone_in_fabric=True)


@configclass
class ZolaWalkCfg(ZolaBalanceCfg):
    command_ranges = ((.15, .5), (-.1, .1), (-.3, .3))


@configclass
class ZolaHandsCfg(ZolaBalanceCfg):
    """She USES her hands: track a random arm/wrist/finger pose per episode
    while staying upright. WHOLE-BODY control — the 12 leg joints stay in the
    action space so she can counterbalance her own arm torques (rigid-legged
    arm-swinging toppled her in hands_v1/v2); pose targets apply to the 22
    arm/hand joints only. 34 actions, 136 observations."""
    controlled_joints = ARM_JOINTS + MODEL["controlled_joints"]
    pose_joints = ARM_JOINTS
    pose_tracking_weight = 1.0
    # deliberate poses, not flailing: ±0.35 rad around default per joint —
    # a full-travel target (±2.4 rad shoulders) topples her before she can
    # learn anything (hands_v1 plateaued at 2-second episodes)
    pose_target_scale = .35
    action_scale = .3
    action_space = len(ARM_JOINTS)+12
    observation_space = 4*len(ARM_JOINTS)+48  # 2*(34) states + 12 base + 22 targets + 34 actions
    # the named body-language layer: a FIXED pose held every episode, halo
    # thrust at the head, wind gusts, aero drag, an air spawn for landings
    fixed_pose: dict[str, float] | None = None
    halo_thrust = False
    gust_force = 0.0
    aero_drag = 2.0
    spawn_drop_m = 0.0
    # the escape fence — a GROUND artifact; the airborne tasks widen it
    escape_radius = 3.0


# THE FLIGHT POSTURE — compact and still, and BALANCEABLE: a mild tuck that
# keeps her COM over her feet (the first draft crouched — hip .2/knee .45/
# arms forward — and the COM walked straight out of the support polygon;
# she faceplants in 11 steps with ZERO actions. The lesson of the flight
# pose is compactness, not crouching.)
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

# THE HALO TOUCHDOWN — her invented signature landing. From a short drop she
# folds into a one-knee hero crouch: right knee deep, left leg braced, left
# arm planted down, right arm swept back, chin up. Body language for the
# moment the props stop.
HERO_POSE = {
    # legs SYMMETRIC — an athletic squat keeps the COM over the feet (the
    # one-knee crouch was unholdable: asymmetric leg loading walks the COM
    # out of the support polygon, and no position-target policy can recover
    # that). The ARMS carry the drama — they are light enough to style with.
    # DEPTH 0.45, not 0.7: the deep squat was measured unholdable — six
    # training runs agree (touchdown_v2..v6, episodes never past ~100); the
    # 0.15-knee flight pose holds at 596/600, so the holdable depth is
    # between. 0.45 with the ankle closing the chain (ankle ≈ knee − hip).
    "left_hip_pitch": .22, "right_hip_pitch": .22,
    "left_knee": .45, "right_knee": .45,
    "left_ankle_pitch": .23, "right_ankle_pitch": .23,
    "left_shoulder_pitch": .9, "left_elbow": -.6, "left_wrist_pitch": .15,
    "right_shoulder_pitch": -1.2, "right_elbow": -.9,
    "waist_yaw": .15, "neck_pitch": .1,
}


@configclass
class ZolaFlightCfg(ZolaHandsCfg):
    """The flight-posture DISCIPLINE, trained on the stable ground platform:
    hold the compact tuck under reset noise. The airborne base-coupled
    dynamics (halo thrust, gusts as base wrenches) are deliberately NOT in
    this prototype — the probe record in TRAINING_RUN documents why: the
    wrench tooling in this Isaac build can't carry them honestly yet. The
    neuromuscular skill is the same either way: in the air, she does not
    flail."""
    pose_joints = ARM_JOINTS + MODEL["controlled_joints"]
    fixed_pose = FLIGHT_POSE
    action_space = len(ARM_JOINTS)+12
    observation_space = 4*(len(ARM_JOINTS)+12)+12


@configclass
class ZolaHoverCfg(ZolaFlightCfg):
    """She flies FOR REAL: the halo's four thruster bodies carry her with a
    scripted differential-thrust autopilot (altitude + attitude). Body-frame
    rotor forces tilt with her — her attitude steers the flight, and her limb
    motion moves the COM she must keep under the thrust. The policy owns the
    body: hold the flight posture while the platform is alive underneath."""
    collar_rotors = True
    # doubled gusts for hover_v2 — the first policy learned at 3 N
    gust_force = 6.0
    escape_radius = 12.0
    action_space = len(ARM_JOINTS)+12
    observation_space = 4*(len(ARM_JOINTS)+12)+12


@configclass
class ZolaTakeoffCfg(ZolaHoverCfg):
    """The violent moment: props spin up from standstill over 1.2 s while she
    stands, then the ground lets go. Her body rides the transition — the
    flight posture held through spin-up, lift-off, and settle."""
    thrust_ramp_s = 1.2
    gust_force = 3.0


# ===================== THE EXPRESSION LIBRARY =====================
# Body language as named, trainable poses and routines — the social layer.
# Amplitudes respect the two hard lessons of this repo: the COM stays over
# the feet (a crouch past the holdable depth is a fall), and the flourish
# ARRIVES (the approach ramp) rather than snapping.

SIT_POSE = {
    # the sit: a deep-but-holdable squat. The knee-1.6 draft failed like the
    # touchdown's deep crouch — the COM lesson again. Depth 1.0 with the
    # ankle closing the chain (ankle = knee - hip), hands resting on the knees
    "left_hip_pitch": .55, "right_hip_pitch": .55,
    "left_knee": 1.0, "right_knee": 1.0,
    "left_ankle_pitch": .45, "right_ankle_pitch": .45,
    "left_shoulder_pitch": .5, "right_shoulder_pitch": .5,
    "left_elbow": -.8, "right_elbow": -.8,
    "left_wrist_pitch": .15, "right_wrist_pitch": .15,
}

PICTURE_POSE = {
    # the photo pose: weight shifted, one hand at the hip, head turned
    # to the lens, chin level — confidence as geometry
    "left_hip_roll": .08, "right_hip_roll": -.08,
    "right_shoulder_roll": .9, "right_elbow": -1.8,
    "left_shoulder_pitch": .12,
    "neck_yaw": .3, "waist_yaw": -.2,
}

THUMBS_UP_POSE = {
    # FINGER DEXTERITY: the thumb holds up while the other four curl to a
    # fist — five independent joints doing five different things
    "right_thumb_flex": -1.1,
    "right_index_flex": .08, "right_middle_flex": .08,
    "right_ring_flex": .08, "right_pinky_flex": .08,
    "right_shoulder_pitch": -.55, "right_elbow": -.35,
    "neck_yaw": -.2,
}

# THE TALKING ROUTINE — conversational body expression: small head tilts,
# a gentle hand emphasis, shoulder life — the way a person punctuates speech
# with their body. Gentle amplitudes: conversation, not a performance.
TALKING_ROUTINE = [
    {"neck_yaw": .18, "right_shoulder_pitch": .3, "right_elbow": -.7, "left_elbow": -.2},
    {"neck_yaw": -.14, "right_elbow": -.35, "left_shoulder_pitch": .18},
    {"neck_pitch": .1, "right_shoulder_pitch": .12, "left_elbow": -.55},
    {"neck_yaw": .06, "right_elbow": -.6, "left_shoulder_pitch": .05},
]

# THE HALOBEAT — her dance routine: a four-count at 2 s per bar. Arms pump,
# hips answer, the count repeats. The song is the period; the steps are the
# keyframes; the policy learns to dance on the beat.
HALOBEAT = [
    {"left_shoulder_pitch": .5, "right_shoulder_pitch": .5, "left_elbow": -.6, "right_elbow": -.6, "left_hip_yaw": .22, "right_hip_yaw": .22},
    {"left_shoulder_pitch": -.15, "right_shoulder_pitch": -.15, "left_elbow": -.2, "right_elbow": -.2, "left_hip_yaw": -.1, "right_hip_yaw": -.1},
    {"left_shoulder_roll": .45, "right_shoulder_roll": -.45, "left_elbow": -.9, "right_elbow": -.9, "left_hip_yaw": -.22, "right_hip_yaw": -.22},
    {"left_shoulder_pitch": .15, "right_shoulder_pitch": .15, "left_elbow": -.3, "right_elbow": -.3},
]


@configclass
class ZolaSitCfg(ZolaHandsCfg):
    """She sits down and holds it — the social baseline of a companion."""
    pose_joints = ARM_JOINTS + MODEL["controlled_joints"]
    fixed_pose = SIT_POSE
    pose_approach_s = 1.2
    action_space = len(ARM_JOINTS)+12
    observation_space = 4*(len(ARM_JOINTS)+12)+12


@configclass
class ZolaPictureCfg(ZolaHandsCfg):
    """Pose for a picture: weight shift, hand at the hip, head to the lens."""
    pose_joints = ARM_JOINTS + MODEL["controlled_joints"]
    fixed_pose = PICTURE_POSE
    pose_approach_s = .8
    action_space = len(ARM_JOINTS)+12
    observation_space = 4*(len(ARM_JOINTS)+12)+12


@configclass
class ZolaThumbsCfg(ZolaHandsCfg):
    """THUMBS UP — five finger joints, five different angles: dexterity."""
    pose_joints = ARM_JOINTS + MODEL["controlled_joints"]
    fixed_pose = THUMBS_UP_POSE
    pose_approach_s = .6
    action_space = len(ARM_JOINTS)+12
    observation_space = 4*(len(ARM_JOINTS)+12)+12


@configclass
class ZolaDanceCfg(ZolaHandsCfg):
    """THE HALOBEAT — she dances on the beat: a four-count keyframe routine
    at 2 s per bar, cosine-eased between steps. Faster and smoother: the
    choreography itself teaches fluid motion."""
    pose_joints = ARM_JOINTS + MODEL["controlled_joints"]
    pose_sequence = HALOBEAT
    pose_period_s = 2.0
    action_space = len(ARM_JOINTS)+12
    observation_space = 4*(len(ARM_JOINTS)+12)+12


@configclass
class ZolaTalkCfg(ZolaHandsCfg):
    """BODY EXPRESSION WHILE TALKING: the conversational routine — head tilts
    and soft hand emphasis cycling at 1.6 s, the body punctuating speech the
    way a person does. Gentle by design: emphasis, not performance."""
    pose_joints = ARM_JOINTS + MODEL["controlled_joints"]
    pose_sequence = TALKING_ROUTINE
    pose_period_s = 1.6
    action_space = len(ARM_JOINTS)+12
    observation_space = 4*(len(ARM_JOINTS)+12)+12


@configclass
class ZolaTouchdownCfg(ZolaHandsCfg):
    """The Halo Touchdown: a short real drop (6 cm — contact physics on),
    then fold into the hero crouch and HOLD it — body language for the
    moment the props stop."""
    pose_joints = ARM_JOINTS + MODEL["controlled_joints"]
    fixed_pose = HERO_POSE
    spawn_drop_m = .06
    # curriculum: the drop grows from zero over ~1.5M env steps — first she
    # masters the hero crouch from standing, THEN the drop arrives. (The old
    # reset-count ramp was instant: 2000 resets = ~2 iterations at 64 envs,
    # so touchdown_v2/v3/v5 all actually trained at full drop from step one.)
    drop_curriculum = True
    drop_ramp_steps = 1_500_000
    # and the pose ARRIVES over 1.5 s — no snapped flourish, no reaction spin
    pose_approach_s = 1.5
    action_space = len(ARM_JOINTS)+12
    observation_space = 4*(len(ARM_JOINTS)+12)+12
