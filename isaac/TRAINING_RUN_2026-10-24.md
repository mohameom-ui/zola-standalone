# Zola Isaac training run — 2026-10-24

First Isaac Sim execution of the prototype tasks, on the local RTX 5060 Laptop
(8 GB, driver 610.88), Isaac Lab 3.0.0 + Isaac Sim 6.2.0 pip wheel, PhysX
backend (`isaacsim_physx` preset), Windows host.

## Logic verification (all checks passed before training)

- `isaac/tests`: 6/6 runnable tests pass; USD test skipped (needs `pxr`,
  present only inside the Isaac environment).
- Profile integrity: `isaac/zola_prototype.json` SHA-256 matches the embedded
  `profile_sha256` in `assets/zola_prototype.json` (3b475f4d…).
- API surface verified against the Isaac Lab 3.0 migration guide: the
  `.torch` ProxyArray accessors, `root_link_*` data names, quaternion **xyzw**
  reset composition (verified algebraically as Ry(pitch)·Rx(roll)),
  `write_*_to_sim_index` writers, `actuators.target_command.set_position_index`,
  and the `RslRlMLPModelCfg` / `GaussianDistributionCfg` runner config are all
  current 3.0 APIs. Observation math checks: 12+12+3+3+3+3+12 = 48 dims.
- Smoke test: `isaaclab zero_agent` ran 100 steps with zero actions, one env —
  clean boot, no NaNs, clean shutdown.
- `isaaclab list_envs` registers both tasks (Isaac-Zola-Balance-Prototype-v0,
  Isaac-Zola-Walk-Prototype-v0) via the `zola_isaac.tasks` entry point.

## Training results

| Run | Task | Steps | Wall time | Final mean reward | Final episode length |
|---|---|---|---|---|---|
| `balance_v1` | Balance (zero command) | 1,152,000 | 10 m 26 s | 25.75 | 599/600 |
| `walk_v1` | Walk (0.15–0.5 m/s fwd, ±0.1 m/s lat, ±0.3 rad/s yaw) | 1,152,000 | 18 m 27 s | 22.01 | ~high 500s |

- Balance: episode length pinned at 599/600 from early training — no falls in
  the final phase; reward plateaued at ~25.3; action std annealed 0.30 → 0.18.
- Walk: episodes grew 6 → 577/600 over the run (policy learned not to fall
  while tracking velocity commands). This is a prototype proxy result, not a
  hardware-ready gait.
- GPU peak ~3.3 GB / 8 GB at 32 envs — the laptop runs headless training fine
  despite being below Isaac Sim's published 16 GB workstation minimum.

## Artifacts

`isaac/logs/` is gitignored. Each run directory contains the final policy
(`model_1499.pt`), the frozen env/agent config (`params/`), and `run.json`:

- `isaac/logs/rsl_rl/zola_balance_prototype/2026-10-24_balance_v1/`
- `isaac/logs/rsl_rl/zola_walk_prototype/2026-10-24_walk_v1/`

## Run 3 — walk_v2 (2026-10-25)

64 envs (double), 2,500 iterations: 3,840,000 steps in 19 m 40 s, final mean
reward 21.91, episode length pinned at 599/600 (no falls in the final phase).
Exported with `isaac/export_policy_onnx.py` — round-trip drift 5.96e-07.

## Policy export — the deployment hook (2026-10-25)

`isaac/export_policy_onnx.py` loads a checkpoint's actor (48→128→128→12 MLP,
ELU, running obs normalizer folded into the graph), exports the deterministic
Gaussian mean as ONNX, and round-trip-verifies against torch with
IN-DISTRIBUTION probes (mean + n·std) before shipping. The balance task's
command inputs are always zero (std = 0 exactly) — naive randn probes
normalize to ±1e8 and measure fp32 chaos, not graph fidelity; that cost one
failed verification before the fix. Artifacts + manifests in `isaac/policies/`.

## Run 4 — hands_v1 (2026-10-25): she uses her hands

New task `Isaac-Zola-Hands-Prototype-v0`: 22 upper-limb joints (shoulders,
elbows, wrists, five finger-flex per hand) track a random commanded pose per
episode while staying upright. Two design failures are part of the record:

- **hands attempt 1** (arm-joints-only actions, full-travel targets): reward
  plateaued at 4.9, episodes 125/600 — full-travel shoulder targets are
  violently destabilizing.
- **hands attempt 2** (arm-joints-only, ±0.35 rad deliberate poses): same
  plateau — the REAL problem was that her legs were not in the action space;
  she was a rigid-legged statue with no way to counterbalance her own arm
  torques.
- **hands_v1 (final)**: WHOLE-BODY control — 34 actions (22 arm/hand + 12
  legs), pose targets on the arm subset only. 2,304,000 steps in 21 m 18 s,
  final reward 34.70, episodes 597.96/600. Exported: round-trip drift
  5.96e-07.

The env now generalizes: `controlled_joints` (everything actuated),
`pose_joints` (the tracked subset), `pose_tracking_weight` (0 keeps the
balance/walk contracts byte-identical), and `pose_target_scale`.

## Runs 5–6 — the flight posture and the probe record (2026-10-25)

`Isaac-Zola-Flight-Prototype-v0` trains the air discipline: hold the compact
tuck, don't flail. Getting there honestly took a probe campaign worth
recording:

- The deprecated `set_external_force_and_torque` is a **silent no-op** in
  this build — she free-fell with it "applied" (probe evidence).
- The `WrenchComposer` force path works (verified: stable hover), but its
  **torque path silently drops** — A/B/C stiffness probes (0/−80/+80) were
  byte-identical.
- A thrust point ABOVE the total COM is an **inverted pendulum** — diverging
  at sqrt(mgh/I) ≈ 3.7 rad/s, matching the observed ~1 s deaths exactly.
- State-level attitude writes fought the integrator (orientation/velocity
  mismatch pumped a roll oscillation).

Conclusion: the airborne base-coupled dynamics need a proper thruster model
(halo thruster links in the URDF with per-rotor forces) — next phase. The
flight-posture policy trains the same neuromuscular discipline on the stable
platform: **reward 34.03, episodes 596/600**, exported with drift 7.15e-07.

The body-language layer generalized the env: `fixed_pose` (named poses held
every episode), `spawn_drop_m` (+ `drop_curriculum`), `escape_radius` (the
fence is a ground artifact — the air needs a bigger one).

## The composer verdict (final, 2026-10-25)

The follow-up rotor experiments (four halo forces with differential mixing,
world/body-frame variants, positioned forces) narrowed the law to:

> The wrench composer of this build reliably applies **force at the body CoM
> in the body frame** — nothing else. Torques: dropped. Positioned forces:
> ineffective. World-frame wrenches (`is_global=True`): ineffective. A
> `body_ids` list shorter than the wrench batch reads garbage.
>

The rotor-wrench code was retired; the hover task is not registered. Honest
coupled flight needs the thruster-URDF phase (halo thruster links with
per-rotor force applications at the solver level, or the Newton backend's
wrench path once verified).

## The Touchdown record (2026-10-25)

`Isaac-Zola-Touchdown-Prototype-v0` — the invented hero landing — remains
**untrained after five named attempts** (COM outside the support polygon
twice; the ankle-chain mismatch; impact absorption beyond position-target
policies). `HERO_POSE` (symmetric power stance, dramatic arms) and the drop
curriculum are in the code; the policy is the open item.

## Notes / caveats

- Windows console: the CLI loading screen can raise `UnicodeEncodeError`
  (cp1252) when output is redirected; `PYTHONUTF8=1` avoids it. Cosmetic only.
- `isaaclab play` accepts no `--max_steps`; it runs until interrupted.
- All profile parameters remain *assumed* (`hardware_calibrated: false`).
  The contract in `isaac/zola_robot_contract.json` still governs what must be
  measured before any hardware deployment.
- Environment seed was unset in these first runs (Kit warning); set `--seed`
  for reproducible reruns.

## Reproduce

```powershell
# venv: isaaclab[isaacsim,rsl-rl]==3.0.0 (see isaac/README.md for overrides)
python -m pip install --no-deps -e ./isaac
isaaclab train --rl_library rsl_rl --task Isaac-Zola-Balance-Prototype-v0 `
  --num_envs 32 --max_iterations 1500 --run_name balance_v2
isaaclab play --rl_library rsl_rl --task Isaac-Zola-Balance-Prototype-v0 `
  --checkpoint latest --num_envs 1
```
