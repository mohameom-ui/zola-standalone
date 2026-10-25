"""Balance and velocity-tracking tasks for the prototype, with no hardware output.

The first policy controls twelve leg joints. Remaining arm, wrist, finger, neck,
and waist joints retain their neutral targets through the same limited actuators.
"""
from collections.abc import Sequence

import torch
from isaaclab.envs import DirectRLEnv

from .env_cfg import MODEL, ZolaBalanceCfg


class ZolaPrototypeEnv(DirectRLEnv):
    cfg: ZolaBalanceCfg

    def __init__(self, cfg, render_mode=None, **kwargs):
        super().__init__(cfg, render_mode, **kwargs)
        self.robot = self.scene["robot"]
        names = self.robot.joint_names
        # EVERY controlled joint is actuated (the hands task adds the legs so
        # she can counterbalance her own arm torques); the POSE subset is the
        # smaller set that receives commanded targets (arms/hands only).
        controlled = getattr(cfg, "controlled_joints", None) or MODEL["controlled_joints"]
        self.ctrl_ids = torch.tensor([names.index(n) for n in controlled], device=self.device, dtype=torch.long)
        pose_joints = getattr(cfg, "pose_joints", None) or []
        self.pose_ids = torch.tensor([names.index(n) for n in pose_joints], device=self.device, dtype=torch.long) if pose_joints else None
        count = len(controlled)
        self.actions = torch.zeros((self.num_envs, count), device=self.device)
        self.previous_actions = torch.zeros_like(self.actions)
        self.commands = torch.zeros((self.num_envs, 3), device=self.device)
        self.targets = self.robot.data.default_joint_pos.torch.clone()
        # POSE TRACKING (the hands task): a commanded arm/hand pose per episode.
        # Zero weight keeps the balance/walk tasks byte-identical to their
        # trained observation and reward contracts.
        self.track_pose = getattr(cfg, "pose_tracking_weight", 0.0) > 0 and self.pose_ids is not None
        self.pos_targets = torch.zeros((self.num_envs, len(pose_joints)), device=self.device)

    def _pre_physics_step(self, actions):
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
        escaped = torch.any(torch.abs(local_position[:, :2]) > 3.0, dim=1)
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
        root_velocity = self.robot.data.default_root_vel.torch[env_ids].clone()
        self.robot.write_root_pose_to_sim_index(root_pose=root_pose, env_ids=env_ids)
        self.robot.write_root_velocity_to_sim_index(root_velocity=root_velocity, env_ids=env_ids)
        self.robot.write_joint_position_to_sim_index(position=positions, env_ids=env_ids)
        self.robot.write_joint_velocity_to_sim_index(velocity=velocities, env_ids=env_ids)
        self.actions[env_ids] = 0
        self.previous_actions[env_ids] = 0
        for column, (low, high) in enumerate(self.cfg.command_ranges):
            self.commands[env_ids, column] = low+(high-low)*torch.rand(count, device=self.device)
        if self.track_pose:
            # a fresh arm/hand pose per episode: a DELIBERATE pose — each
            # controlled joint offset by up to cfg.pose_target_scale radians
            # around its default, clamped to the soft limits the actuators
            # enforce (full-travel targets topple her; hands_v1 proved it)
            scale = getattr(self.cfg, "pose_target_scale", .35)
            arm_limits = self.robot.data.soft_joint_pos_limits.torch[env_ids][:, self.pose_ids]
            default = self.robot.data.default_joint_pos.torch[env_ids][:, self.pose_ids]
            offset = ((torch.rand((count, self.pose_ids.numel()), device=self.device)*2-1)*scale)
            target = (default+offset).clamp(arm_limits[..., 0], arm_limits[..., 1])
            self.pos_targets[env_ids] = target-default
