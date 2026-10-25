"""Zola's prototype tasks: balance, walking, hands, flight posture, touchdown.

Whatever the task, the shape is the same: a whole-body (or leg-only) position
policy that must hold or reach poses while the platform does what platforms
do — swing, get shoved, drop. No hardware output anywhere.
"""
from collections.abc import Sequence

import torch
from isaaclab.envs import DirectRLEnv
from isaaclab.utils.math import quat_apply, quat_apply_inverse, quat_rotate

from .env_cfg import MODEL, ZolaBalanceCfg


class ZolaPrototypeEnv(DirectRLEnv):
    cfg: ZolaBalanceCfg

    def __init__(self, cfg, render_mode=None, **kwargs):
        super().__init__(cfg, render_mode, **kwargs)
        self.robot = self.scene["robot"]
        names = self.robot.joint_names
        # EVERY controlled joint is actuated (the whole-body tasks add the legs
        # so she can counterbalance her own arm torques); the POSE subset is
        # the smaller set that receives commanded targets.
        controlled = getattr(cfg, "controlled_joints", None) or MODEL["controlled_joints"]
        self.ctrl_ids = torch.tensor([names.index(n) for n in controlled], device=self.device, dtype=torch.long)
        pose_joints = getattr(cfg, "pose_joints", None) or []
        self.pose_ids = torch.tensor([names.index(n) for n in pose_joints], device=self.device, dtype=torch.long) if pose_joints else None
        count = len(controlled)
        self.actions = torch.zeros((self.num_envs, count), device=self.device)
        self.previous_actions = torch.zeros_like(self.actions)
        self.commands = torch.zeros((self.num_envs, 3), device=self.device)
        self.targets = self.robot.data.default_joint_pos.torch.clone()
        # POSE TRACKING: a commanded pose per episode. Zero weight keeps the
        # balance/walk tasks byte-identical to their trained contracts.
        self.track_pose = getattr(cfg, "pose_tracking_weight", 0.0) > 0 and self.pose_ids is not None
        self.pos_targets = torch.zeros((self.num_envs, len(pose_joints)), device=self.device)
        # FIXED POSE (body language): a named pose held every episode — the
        # reset does not resample it.
        self.fixed_pose = getattr(cfg, "fixed_pose", None)
        self.pose_approach_s = getattr(cfg, "pose_approach_s", 0.0)
        if self.fixed_pose:
            self.fixed_offsets = torch.tensor(
                [self.fixed_pose.get(n, 0.0) for n in pose_joints], device=self.device)
            self.pos_targets[:] = self.fixed_offsets
        else:
            self.fixed_offsets = None
        # the probe record for the (retired) wrench-based halo experiments
        # lives in TRAINING_RUN — this build's composer applies only
        # force-at-CoM in the body frame; everything else fails silently
        self.drop = getattr(cfg, "spawn_drop_m", 0.0)
        self.drop_curriculum = getattr(cfg, "drop_curriculum", False)
        # the ramp is measured in ENV STEPS, not resets: with 64 envs the old
        # reset-count threshold (2000) was consumed within ~2 training
        # iterations — every "curriculum" run actually trained at full drop
        self.env_steps = 0
        self.drop_ramp_steps = getattr(cfg, "drop_ramp_steps", 1_500_000)
        self.escape_radius = getattr(cfg, "escape_radius", 3.0)
        # THE REAL HALO: the four thruster links are REAL BODIES now, so the
        # one wrench path this build honors (force-at-CoM, body frame) reaches
        # them — each rotor's thrust is a legal wrench at its own center, and
        # because the forces are body-frame they TILT WITH HER: attitude steers
        # the flight, for real. A scripted differential-thrust autopilot holds
        # altitude and attitude; the POLICY owns the body.
        self.rotors = getattr(cfg, "halo_rotors", False)
        self.root_body_ids = [0]  # the pelvis: body 0 in any ordering
        if self.rotors:
            self.rotor_body_ids, self.rotor_body_names = self.robot.find_bodies("halo_.*_thruster")
            self.rotor_body_ids = torch.as_tensor(self.rotor_body_ids, device=self.device, dtype=torch.long)
            self.hover_target_z = MODEL["base_height"]+.12
            self.kp_z, self.kd_z = 40.0, 8.0
            self.kp_att, self.kd_att = 4.0, 1.5
            self.mass = MODEL["total_mass_kg"]
            self.gust_step = 0
            self.gust_mag = getattr(cfg, "gust_force", 0.0)
            self.gust_vec = torch.zeros((self.num_envs, 3), device=self.device)

    def _pre_physics_step(self, actions):
        self.env_steps += self.num_envs
        if self.fixed_offsets is not None and self.pose_approach_s > 0:
            # MOVE INTO the pose instead of snapping to it: the arm flourish
            # reached at full actuator speed pumps ~30 N·m of reaction torque
            # through her base — the swing itself tops her over. The approach
            # ramp is also the realistic motion: body language arrives smoothly.
            frac = (self.episode_length_buf.to(torch.float32)*self.step_dt/self.pose_approach_s).clamp(0.0, 1.0).unsqueeze(1)
            self.pos_targets[:] = self.fixed_offsets*frac
        self.previous_actions.copy_(self.actions)
        self.actions.mul_(.6).add_(actions.clamp(-1, 1), alpha=.4)
        self.targets.copy_(self.robot.data.default_joint_pos.torch)
        if self.track_pose:
            self.targets[:, self.pose_ids] += self.pos_targets
        self.targets[:, self.ctrl_ids] += self.actions*self.cfg.action_scale
        limits = self.robot.data.soft_joint_pos_limits.torch
        self.targets.clamp_(limits[..., 0], limits[..., 1])

    def _apply_action(self):
        self.robot.actuators.target_command.set_position_index(value=self.targets)
        if self.rotors:
            data = self.robot.data
            z = data.root_link_pose_w.torch[:, 2]
            vel_w = data.root_link_lin_vel_w.torch
            # ALTITUDE: total thrust = weight + PD toward the hover height
            thrust = (self.mass*9.81
                      + self.kp_z*(self.hover_target_z-z)
                      - self.kd_z*vel_w[:, 2]).clamp(0.0, 2*self.mass*9.81)
            # ATTITUDE: PD on the tilt (axis that rotates the measured world
            # gravity direction back to straight down), expressed in the BODY
            # frame for the rotor mixing
            q_xyzw = data.root_link_quat_w.torch
            q_wxyz = torch.stack((q_xyzw[:, 3], q_xyzw[:, 0], q_xyzw[:, 1], q_xyzw[:, 2]), dim=1)
            g_w = quat_rotate(q_wxyz, data.projected_gravity_b.torch)
            down = torch.tensor((0., 0., -1.), device=self.device).expand_as(g_w)
            tau_w = self.kp_att*torch.cross(g_w, down, dim=1)-self.kd_att*data.root_link_ang_vel_w.torch
            tau_b = quat_apply_inverse(q_wxyz, tau_w)
            # QUADROTOR MIXING: rotor i at (±d, ±d): δF_i = (τ_x·y_i + τ_y·x_i)/(4d²)
            d = 0.065
            rx = torch.tensor((d, d, -d, -d), device=self.device)
            ry = torch.tensor((d, -d, d, -d), device=self.device)
            delta = (tau_b[:, 0:1]*ry + tau_b[:, 1:2]*rx)/(4*d*d)
            f_i = (thrust/4).unsqueeze(1)+delta
            f_i = f_i.clamp(min=0.0)  # props push, they do not pull
            forces = torch.zeros((self.num_envs, 4, 3), device=self.device)
            forces[:, :, 2] = f_i  # thrust along each thruster's up: tilt = steer
            zeros_t = torch.zeros_like(forces)
            # force-at-CoM on four REAL bodies — the one path this build honors
            self.robot.instantaneous_wrench_composer.set_forces_and_torques_index(
                forces=forces, torques=zeros_t, body_ids=self.rotor_body_ids, is_global=False)
            # GUSTS + DRAG: rotated into the body frame (the world-frame path
            # drops silently)
            self.gust_step += 1
            if self.gust_step % 30 == 1:
                dirs = torch.randn((self.num_envs, 2), device=self.device)
                dirs = dirs/(dirs.norm(dim=1, keepdim=True)+1e-8)
                self.gust_vec[:, :2] = dirs*self.gust_mag*torch.rand((self.num_envs, 1), device=self.device)
            extra_w = torch.zeros((self.num_envs, 3), device=self.device)
            extra_w[:, 0] = self.gust_vec[:, 0]-2.0*vel_w[:, 0]
            extra_w[:, 1] = self.gust_vec[:, 1]-2.0*vel_w[:, 1]
            extra_w[:, 2] = -2.0*vel_w[:, 2]
            extra_b = quat_apply_inverse(q_wxyz, extra_w).unsqueeze(1)
            self.robot.instantaneous_wrench_composer.add_forces_and_torques_index(
                forces=extra_b, body_ids=self.root_body_ids, is_global=False)

    def _get_observations(self):
        data = self.robot.data
        parts = [
            data.joint_pos.torch[:, self.ctrl_ids]-data.default_joint_pos.torch[:, self.ctrl_ids],
            data.joint_vel.torch[:, self.ctrl_ids]*.1,
            data.root_link_lin_vel_b.torch,
            data.root_link_ang_vel_b.torch*.25,
            data.projected_gravity_b.torch,
            self.commands,
        ]
        if self.track_pose:
            parts.append(self.pos_targets)
        parts.append(self.actions)
        observations = torch.cat(parts, dim=-1)
        return {"policy": observations}

    def _get_rewards(self):
        data = self.robot.data
        velocity = data.root_link_lin_vel_b.torch
        angular = data.root_link_ang_vel_b.torch
        height = data.root_link_pose_w.torch[:, 2]-self.scene.env_origins[:, 2]
        linear_tracking = torch.exp(-4*torch.sum((velocity[:, :2]-self.commands[:, :2])**2, dim=1))
        yaw_tracking = torch.exp(-4*(angular[:, 2]-self.commands[:, 2])**2)
        upright = (-data.projected_gravity_b.torch[:, 2]).clamp(0, 1)
        stance_height = torch.exp(-((height-MODEL["base_height"])/.08)**2)
        action_rate = torch.sum((self.actions-self.previous_actions)**2, dim=1)
        joint_speed = torch.sum(data.joint_vel.torch[:, self.ctrl_ids]**2, dim=1)
        reward = (linear_tracking+ .4*yaw_tracking+ .6*upright+ .6*stance_height
                  -.02*action_rate-.0005*joint_speed-.2*velocity[:, 2]**2
                  -.05*torch.sum(angular[:, :2]**2, dim=1))
        if self.track_pose:
            pose_err = (data.joint_pos.torch[:, self.pose_ids]
                        - (data.default_joint_pos.torch[:, self.pose_ids] + self.pos_targets))
            pose_tracking = torch.exp(-2*torch.mean(pose_err**2, dim=1))
            reward = reward + self.cfg.pose_tracking_weight*pose_tracking
        return reward*self.step_dt-self.reset_terminated.float()

    def _get_dones(self):
        data = self.robot.data
        pose = data.root_link_pose_w.torch
        local_position = pose[:, :3]-self.scene.env_origins
        fall = (local_position[:, 2] < MODEL["base_height"]*.65) | (data.projected_gravity_b.torch[:, 2] > -.5)
        escaped = torch.any(torch.abs(local_position[:, :2]) > self.escape_radius, dim=1)
        invalid = ~torch.isfinite(pose).all(dim=1) | ~torch.isfinite(data.joint_pos.torch).all(dim=1)
        timeout = self.episode_length_buf >= self.max_episode_length-1
        return fall | escaped | invalid, timeout

    def _reset_idx(self, env_ids: Sequence[int] | None):
        if env_ids is None:
            env_ids = self.robot._ALL_INDICES
        super()._reset_idx(env_ids)
        count = len(env_ids)
        positions = self.robot.data.default_joint_pos.torch[env_ids].clone()
        controlled = self.ctrl_ids.numel()
        positions[:, self.ctrl_ids] += (torch.rand((count, controlled), device=self.device)-.5)*.06
        limits = self.robot.data.soft_joint_pos_limits.torch[env_ids]
        positions.clamp_(limits[..., 0], limits[..., 1])
        velocities = self.robot.data.default_joint_vel.torch[env_ids].clone()
        root_pose = self.robot.data.default_root_pose.torch[env_ids].clone()
        root_pose[:, :3] += self.scene.env_origins[env_ids]
        roll, pitch = ((torch.rand((count, 2), device=self.device)-.5)*.06).unbind(dim=1)
        sr, cr, sp, cp = torch.sin(roll/2), torch.cos(roll/2), torch.sin(pitch/2), torch.cos(pitch/2)
        root_pose[:, 3:] = torch.stack((sr*cp, cr*sp, -sr*sp, cr*cp), dim=1)  # Isaac Lab 3: xyzw
        if self.drop:
            # the touchdown begins in the air — unless the curriculum is still
            # walking the drop height up from zero (a true env-step ramp)
            effective = self.drop
            if self.drop_curriculum:
                effective = self.drop*min(1.0, self.env_steps/self.drop_ramp_steps)
            if effective > 0:
                root_pose[:, 2] += effective
        root_velocity = self.robot.data.default_root_vel.torch[env_ids].clone()
        self.robot.write_root_pose_to_sim_index(root_pose=root_pose, env_ids=env_ids)
        self.robot.write_root_velocity_to_sim_index(root_velocity=root_velocity, env_ids=env_ids)
        self.robot.write_joint_position_to_sim_index(position=positions, env_ids=env_ids)
        self.robot.write_joint_velocity_to_sim_index(velocity=velocities, env_ids=env_ids)
        self.actions[env_ids] = 0
        self.previous_actions[env_ids] = 0
        for column, (low, high) in enumerate(self.cfg.command_ranges):
            self.commands[env_ids, column] = low+(high-low)*torch.rand(count, device=self.device)
        if self.track_pose and not self.fixed_pose:
            # a fresh arm/hand pose per episode: a DELIBERATE pose — each
            # controlled joint offset by up to cfg.pose_target_scale radians
            # around its default, clamped to the soft limits the actuators
            # enforce (full-travel targets topple her; the first hands attempt
            # proved it)
            scale = getattr(self.cfg, "pose_target_scale", .35)
            arm_limits = self.robot.data.soft_joint_pos_limits.torch[env_ids][:, self.pose_ids]
            default = self.robot.data.default_joint_pos.torch[env_ids][:, self.pose_ids]
            offset = ((torch.rand((count, self.pose_ids.numel()), device=self.device)*2-1)*scale)
            target = (default+offset).clamp(arm_limits[..., 0], arm_limits[..., 1])
            self.pos_targets[env_ids] = target-default