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

## The composer verdict — and its UNBLOCKING (2026-10-25)

The rotor experiments narrowed the law to:

> The wrench composer of this build applies **force at a body's CoM in the
> body frame** — and only that. Torques: dropped. Positioned forces:
> ineffective. World-frame wrenches (`is_global=True`): ineffective. The
> `body_ids` count must match the wrench batch exactly.
>

**The unblock:** make the rotors REAL BODIES. `prepare.py` now adds four
halo-thruster links (frozen ±0.001-rad mounts to the head — a fixed joint
would weld them away in PhysX), and each rotor's thrust becomes a legal
force-at-its-own-CoM wrench. **Coupled flight works**: the probe held
altitude and attitude with zero policy actions, and the trained hover policy
(reward 13.95, episodes 416/600 under gusts) flies on real four-rotor
physics where her limb motion genuinely shifts the COM, tilts the thrust,
and reckless flailing can crash the flight.

The USD is now regenerated with `usd-core` (pip) — the pxr-based unit test
runs for real instead of skipping.

## The Touchdown record (2026-10-25) — SOLVED on the seventh run

`Isaac-Zola-Touchdown-Prototype-v0` — the invented hero landing — is
**TRAINED**: touchdown_v8, reward 23.88, episodes 459/600, ONNX drift
4.77e-07 (checkpoint archived on disk). The six failed runs each taught one
named thing (full-flourish COM walk-out; one-knee asymmetry; the ankle
chain; the instant fake curriculum; the snapped-flourish reaction spin; the
depth sweep). The three fixes that generalized into the env:

1. **`drop_ramp_steps`** — a curriculum measured in ENV STEPS (the old
   reset-count threshold was consumed in ~2 iterations at 64 envs).
2. **`pose_approach_s`** — the pose ARRIVES over 1.5 s instead of snapping;
   the arm flourish at full actuator speed pumps ~30 N·m of reaction torque
   through her base and tops her over by itself.
3. **The holdable depth** — knee 0.45 between the stable 0.15 and the
   unholdable 0.7, with the ankle closing the chain.

## Runs 7–10 — the hardening pass (2026-10-25)

| Run | Task | Result |
|---|---|---|
| hover_v2 | hover, gusts DOUBLED to 6 N, 3000 iters | peak 15.18 / 464.23 — beats v1 under 2× the disturbance |
| takeoff_v1 | NEW: thrust ramps 0→hover over 1.2 s while she stands, then the ground lets go | 9.36 / 290.89 — she rides the spin-up and lift-off |
| touchdown_v9 | the signature move, deepened to 3500 iters | **34.02 / 594.92** — the hero landing now holds through 99% of episodes (was 459) |

`thrust_ramp_s` entered the autopilot for the takeoff task: the props spin
up from standstill while she stands — the most violent moment of flight, and
the one her body must ride calmly.

The Touchdown export supersedes v8: `zola_touchdown_model_3499.onnx`.

## Notes / caveats

- Windows console: the CLI loading screen can raise `UnicodeEncodeError`
  (cp1252) when output is redirected; `PYTHONUTF8=1` avoids it. Cosmetic only.
- `isaaclab play` accepts no `--max_steps`; it runs until interrupted.
- All profile parameters remain *assumed* (`hardware_calibrated: false`).
  The contract in `isaac/zola_robot_contract.json` still governs what must be
  measured before any hardware deployment.
- Environment seed was unset in these first runs (Kit warning); set `--seed`
  for reproducible reruns.

## Runs 11–13 — the sit campaign (2026-11-03)

The sit is the hardest expression in the library because it is a controlled
collapse: the COM walks toward the support-polygon edge as the knees fold.
Six runs of record (the v1–v5 record lives in the git history, commit
75de187): five at knee 1.0 (all ~100/600 — statically unholdable), then the
holdable-depth attempt:

| Run | Config | Result |
|---|---|---|
| sit_v7 | knee 0.7, rigid gains, full depth from step one | 8.95 / 199 |
| sit_v8 | sit_v7 + 3 cm spawn drop | 9.27 / 204 |
| sit_v9 | sit_v7 + collar weight-relief (50% thrust fraction) | 5.14 / 132 |
| sit_v10 | knee 0.55 (hip = ankle = 0.275), no thrust, no drop | **33.55 / 591.27** |

**sit_v8's verdict:** the drop did NOT unlock the catch — the reward curve
tracked sit_v7 within noise for the full 2500 iterations (v8 was actually a
hair BEHIND at matched iterations: 5.10/130 vs v7's 6.55/156 at iter 2000).
The drop is retired from the sit.

**A record correction:** an earlier note claimed "the touchdown proves knee
0.7 is dynamically stable." The frozen params say otherwise — touchdown_v9
(594.92/600) trained at knee **0.45**. The measured depth ladder is:
0.45 holds under full gravity, 0.7 plateaus at ~200/600 for the sit, 1.0 is
statically unholdable (five runs).

**sit_v9 — the prop-assisted sit (the dynamics-aware interface):** her own
collar rotors carried a fixed 50% of her weight while she folded
(`collar_thrust_fraction`, a cfg-gated autopilot mode: no altitude hold,
fixed partial thrust + the attitude loop). The theory was sound — half
weight halves the fold's momentum — but the verdict is a clear REJECTION:
5.14/132, well below v7. The mechanism: in free flight the neck-height
thrust + attitude loop is the stabilizer; on the GROUND it fights the leg
servos (the thrust line sits above the COM — the inverted-pendulum lesson
again, now fighting the feet's own contact forces). The
`collar_thrust_fraction` mode stays in the env, cfg-gated, but no grounded
task should use it. Partial thrust belongs to flight, not to sitting.

**sit_v10 — the depth fix: SOLVED.** knee 0.55, the untested rung between
the proven-holdable 0.45 and the plateauing 0.7 (hip = ankle = knee/2, the
touchdown's chain rule). One variable vs v7. Result: **33.55 reward,
591.27/600 episodes** — from 199 to 591, ahead of v7's curve at every
checkpoint from iteration 200 on. Exported `zola_sit_model_2499.onnx`
(drift 7.15e-07) and wired into the brain's policy shelf. The sit's lesson
joins the touchdown's in the canon: THE POSE ADAPTS TO THE PHYSICS — the
training record is the measurement, not the wish.

## Run 14 — the sigmoid A/B (2026-11-05)

The activation question, answered by training rather than by opinion. One
variable: `Isaac-Zola-TouchdownSigmoid-Prototype-v0` — the touchdown task
byte-for-byte (including the OLD lr 3e-4, pinned) with sigmoid in the actor
and critic instead of ELU. Referee: touchdown_v10 (ELU, peak smoothed reward
33.8, 533/600 episodes).

| Network | Final reward | Final episodes | Peak reward |
|---|---|---|---|
| ELU (touchdown_v10) | 33.8 (peak) | 533/600 | 33.8 |
| **sigmoid (the A/B)** | 3.64 | 101/600 | 4.54 |

**Verdict: sigmoid is REJECTED for the policy networks.** The curve never
left the floor — the saturating tails (output pinned to 0/1) pass near-zero
gradients exactly where the policy needs to move. ELU stays the canon; the
sigmoid task stays registered as the experiment of record. This matches the
standard prediction, but now the shelf's activation choice is MEASURED, not
inherited.

## The hyperparameter tune (2026-11-05) — the optimizer contract

Documented in `isaac/zola_isaac/agent.py` (the OPTIMIZER CONTRACT comment):
learning rate 3e-4 → **1e-3** (initial; the adaptive-KL schedule still
governs the live value — desired_kl=.01 remains the ceiling on per-update
policy change); Adam's momentum β₁=0.9, β₂=0.999 documented (the RslRl
wrapper does not expose betas — its optimizer field is a name string only);
the three real bias layers documented (Linear biases, the observation
normalizer's offset, init_noise_std=.3 as the exploration bias). The lr
tune's validation round: touchdown at 1e-3, 2500 iters, referee
again touchdown_v10.

## Reproduce

```powershell
# venv: isaaclab[isaacsim,rsl-rl]==3.0.0 (see isaac/README.md for overrides)
python -m pip install --no-deps -e ./isaac
isaaclab train --rl_library rsl_rl --task Isaac-Zola-Balance-Prototype-v0 `
  --num_envs 32 --max_iterations 1500 --run_name balance_v2
isaaclab play --rl_library rsl_rl --task Isaac-Zola-Balance-Prototype-v0 `
  --checkpoint latest --num_envs 1
```
