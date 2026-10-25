# Zola character and Isaac experiments

This is the reproducible source for Zola's v11 character, a 37-joint physics prototype, and two Isaac Lab tasks. The physical parameters are explicit simulation assumptions. No policy checkpoint has been trained or validated on hardware.

## What exists

| Artifact | Purpose |
| --- | --- |
| `build_character.py` | Builds dimensional ceramic/graphite robot geometry around the original 65-bone motion skeleton; rigid bone weights replace the broken cumulative remap |
| `../public/assets/models/zola-anims/v3/` | A roughly 1.25 MB body and 20 animation-only clips totaling roughly 3 MB |
| `zola_prototype.json` | Assumed dimensions, masses, joint drives, and contact settings; `hardware_calibrated` is false |
| `prepare.py` | Generates a connected URDF tree, analytic box inertias, limits, and an ordered action-joint map |
| `export_usd.py` | Authors the same model as a USD Physics articulation using `pxr` |
| `zola_isaac/assets/` | Generated URDF, USD, and exact model metadata |
| `zola_isaac/env.py`, `env_cfg.py`, `agent.py` | Isaac Lab 3.0 balance and flat-ground velocity-tracking task implementations, plus PPO settings |
| `zola_robot_contract.json` | Current capability and calibration status |

The 65 visual bones include fingers and animation helper bones. The physics proxy has 37 revolute joints, including simple finger flexion. These counts describe different representations; neither declares the future hardware actuator count. The initial learning tasks control twelve leg joints while holding the remaining joints at neutral targets.

## Rebuild and validate locally

From the repository root, on this Windows host:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python-exit-code 1 --python isaac/build_character.py -- --preview
& 'C:\Program Files\Blender Foundation\Blender 5.2\5.2\python\bin\python.exe' isaac/export_usd.py
node isaac/check-character.mjs
& 'C:\Program Files\Blender Foundation\Blender 5.2\5.2\python\bin\python.exe' -m unittest discover -s isaac/tests -v
```

Other hosts can use their Blender executable and any authoring Python with `pxr` installed. The task runtime below requires Python 3.12. The authoring tools also work with Blender's Python 3.13.

The character check loads every asset with Three.js, verifies skin weights and anatomically ordered landmarks, resolves every animation track, and confirms that every clip moves joints. The physics checks verify the articulation tree, mirrored limbs, positive inertia, joint limits, foot placement, reproducible output, and USD Physics relationships. These checks validate the artifacts; they do not execute an Isaac simulator.

## Run in Isaac Lab

The task code targets **Isaac Lab 3.0.0, Isaac Sim 6.2, and Python 3.12**. Prepare that environment using NVIDIA's [versioned installation guide](https://isaac-sim.github.io/IsaacLab/v3.0.0/source/isaaclab/installation.html), including its tested dependency overrides for the Isaac Sim extra. Then install this package into the same environment, from the repository root:

```powershell
python -m pip install --no-deps -e ./isaac
cd isaac
isaaclab list_envs --show_presets
isaaclab zero_agent --task Isaac-Zola-Balance-Prototype-v0 --num_envs 1 --viz kit physics=isaacsim_physx
isaaclab random_agent --task Isaac-Zola-Balance-Prototype-v0 --num_envs 1 --viz kit physics=isaacsim_physx
isaaclab train --rl_library rsl_rl --task Isaac-Zola-Balance-Prototype-v0 --num_envs 32 --max_iterations 1500 physics=isaacsim_physx
isaaclab play --rl_library rsl_rl --task Isaac-Zola-Balance-Prototype-v0 --checkpoint latest --num_envs 1 --viz kit physics=isaacsim_physx
```

First inspect one robot with zero actions: feet, gravity, joint directions, drive strength, collisions, resets, and numerical stability must behave correctly before a training run. Stop the inspection with Ctrl+C. First executed in Isaac Sim on 2026-10-24: both tasks trained end-to-end on a
local RTX 5060 Laptop (8 GB) headless — see [`TRAINING_RUN_2026-10-24.md`](TRAINING_RUN_2026-10-24.md)
for results, artifacts, and caveats.

After balance is validated, use `Isaac-Zola-Walk-Prototype-v0` to experiment with forward speeds of 0.15–0.5 m/s, lateral speeds up to 0.1 m/s, and yaw rates up to 0.3 rad/s. Balance and walking use separate experiment directories. A trained or successful gait is not implied by the presence of either task.

Both tasks use 120 Hz physics, 60 Hz limited position targets, 48 proprioceptive observations, randomized initial joint angles and slight body tilt, and ten-second episodes. Their rewards track velocity, heading rate, upright posture, and height while penalizing rapid action changes and joint motion. The asset profile SHA-256 is recorded in the environment configuration. Rendering and cameras are not policy inputs in this first stage.

This laptop reports an RTX 5060 Laptop GPU with 8 GB VRAM. It is below the current [Isaac Sim published 16 GB minimum](https://docs.isaacsim.omniverse.nvidia.com/6.2.0/installation/requirements.html); full Isaac Sim training should use a compatible workstation. No large simulator installation or cloud purchase has been performed.

## Coordinates and later hardware calibration

The URDF and USD use meters, kilograms, seconds, radians, and **x forward / y left / z up**. USD angular joint and drive values are converted to degrees by the exporter. The articulation asset is rooted at the pelvis at zero; the task supplies the 0.9318 m spawn height once. The web character uses glTF's y-up frame, with feet at y=-0.905 before the viewer's ground offset.

The original v10 remap inverted torso landmarks and widened the arms beyond the mesh. The v11 visual pipeline preserves the original motion skeleton and binds each mechanical part explicitly. It does not infer physical masses from the visual mesh. The physics body is a simpler box proxy using the same nominal proportions.

Before training for physical deployment, replace the assumptions with measured link geometry, mass/center-of-mass/inertia, joint axes/limits, motor torque-speed and latency data, foot/hand contact properties, encoder/IMU/camera frames and noise, and the actual controller rates. Validate self-collision and sensor availability, then add measured randomization and disturbances. The prototype's self-collision is currently disabled to avoid overlapping adjacent carrier joints.

The current ArduPilot relay controls flight only. This package has no physical limb bridge, ROS 2 actuation interface, policy deployment hook, or flight dynamics task. A future calibrated robot package should be versioned separately and pass deployment checks before it can drive hardware.

NVIDIA documents [URDF-to-USD import](https://docs.isaacsim.omniverse.nvidia.com/latest/importer_exporter/import_urdf.html), [external task discovery](https://isaac-sim.github.io/IsaacLab/v3.0.0/source/developer-tools/template_generator.html), and [training/replay](https://isaac-sim.github.io/IsaacLab/v3.0.0/source/concepts/reinforcement_learning.html). This project's USD exporter authors standard USD Physics directly; the URDF is also available for inspecting or using NVIDIA's importer.
