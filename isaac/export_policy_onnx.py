"""Export a trained RSL-RL actor checkpoint to ONNX — the deployment hook.

The contract (zola_robot_contract.json) forbids implying hardware readiness:
these exports are SIMULATION artifacts. The manifest records provenance and
keeps `hardware_calibrated: false` until measured data replaces the profile.

Usage (from the Isaac venv):
    python isaac/export_policy_onnx.py RUN_DIR --out isaac/policies
Exports the deterministic actor (the Gaussian mean) with the observation
normalizer folded into the graph, then round-trip-verifies the ONNX output
against the torch reference on random inputs.
"""
import argparse
import hashlib
import json
from pathlib import Path

import torch


def select_best_checkpoint(run_dir: Path):
    """MAX-TECH SELECTION: the last checkpoint is not automatically the best.
    Parse the run's training.log (Learning iteration / Mean reward pairs),
    smooth over a 5-reading window (250 iterations), and export the checkpoint
    at the smoothed peak — mid-run peaks are real and the last save can be a
    variance dip."""
    import re
    log = run_dir / "training.log"
    last = max(run_dir.glob("model_*.pt"), key=lambda p: int(p.stem.split("_")[1]))
    if not log.exists():
        return last, None
    pairs = []
    iteration = None
    for raw in log.read_text(encoding="utf-8", errors="ignore").splitlines():
        m = re.search(r"Learning iteration (\d+)/\d+", raw)
        if m:
            iteration = int(m.group(1))
            continue
        m = re.search(r"Mean reward: ([\d.eE+-]+)", raw)
        if m and iteration is not None:
            pairs.append((iteration, float(m.group(1))))
            iteration = None
    if not pairs:
        return last, None
    rewards = [r for _, r in pairs]
    window = 5
    smoothed = [sum(rewards[max(0, i-window+1):i+1])/(i-max(0, i-window+1)+1) for i in range(len(rewards))]
    best_i = max(range(len(smoothed)), key=lambda i: smoothed[i])
    best_iteration, best_reward = pairs[best_i]
    available = {int(p.stem.split("_")[1]): p for p in run_dir.glob("model_*.pt")}
    at_or_before = sorted(a for a in available if a <= best_iteration)
    chosen = available[at_or_before[-1]] if at_or_before else last
    info = {"mode": "best", "metric": "smoothed_mean_reward", "window_readings": window,
            "peak_iteration": best_iteration, "peak_mean_reward": best_reward,
            "peak_smoothed": round(smoothed[best_i], 4), "selected_checkpoint": chosen.name,
            "candidates_on_disk": len(available), "log": log.name}
    return chosen, info


def export_run(run_dir: Path, out_dir: Path, task: str, select: str = "best") -> dict:
    if select == "best":
        ckpt_path, selection = select_best_checkpoint(run_dir)
    else:
        ckpt_path, selection = max(run_dir.glob("model_*.pt"), key=lambda p: int(p.stem.split("_")[1])), None
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    actor = ckpt["actor_state_dict"]
    obs_dim, act_dim = actor["mlp.0.weight"].shape[1], actor["mlp.4.weight"].shape[0]
    hidden = actor["mlp.0.weight"].shape[0]

    # the actor: Linear→ELU→Linear→ELU→Linear (weights load by position)
    policy = torch.nn.Sequential(
        torch.nn.Linear(obs_dim, hidden), torch.nn.ELU(),
        torch.nn.Linear(hidden, hidden), torch.nn.ELU(),
        torch.nn.Linear(hidden, act_dim),
    )
    policy[0].weight.data = actor["mlp.0.weight"]; policy[0].bias.data = actor["mlp.0.bias"]
    policy[2].weight.data = actor["mlp.2.weight"]; policy[2].bias.data = actor["mlp.2.bias"]
    policy[4].weight.data = actor["mlp.4.weight"]; policy[4].bias.data = actor["mlp.4.bias"]
    mean = float(actor["obs_normalizer._mean"].flatten()[0])
    std = float(actor["obs_normalizer._std"].flatten()[0])

    class Normed(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.body = policy
            self.n_mean = torch.nn.Parameter(actor["obs_normalizer._mean"].clone(), requires_grad=False)
            self.n_std = torch.nn.Parameter(actor["obs_normalizer._std"].clone(), requires_grad=False)

        def forward(self, obs: torch.Tensor) -> torch.Tensor:
            x = (obs - self.n_mean) / (self.n_std + 1e-8)
            return self.body(x)

    normed = Normed().eval()
    sample = torch.zeros(1, obs_dim)
    with torch.no_grad():
        reference = normed(sample)

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{task}_{ckpt_path.stem}"
    onnx_path = out_dir / f"{stem}.onnx"
    torch.onnx.export(normed, sample, onnx_path, input_names=["obs"], output_names=["action"],
                      dynamic_axes={"obs": {0: "envs"}, "action": {0: "envs"}}, opset_version=18)

    # round-trip: the ONNX graph must match the torch reference. Probes are
    # IN-DISTRIBUTION (mean + n*std): the balance task's command inputs are
    # always zero, so their std is exactly 0 — a naive randn probe normalizes
    # to ±1e8 and measures fp32 chaos, not graph fidelity.
    import onnxruntime as ort  # noqa: PLC0415
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    torch.manual_seed(0)
    probes = actor["obs_normalizer._mean"] + torch.randn(8, obs_dim) * actor["obs_normalizer._std"]
    with torch.no_grad():
        expected = normed(probes)
    got = torch.from_numpy(session.run(None, {"obs": probes.numpy()})[0])
    drift = float((expected - got).abs().max())
    if drift > 1e-4:
        raise SystemExit(f"ONNX round-trip drift {drift} exceeds 1e-4 — refusing to ship a wrong policy")

    data = onnx_path.read_bytes()
    manifest = {
        "task": task,
        "run": run_dir.name,
        "checkpoint": ckpt_path.name,
        "iteration": int(ckpt["iter"]),
        "obs_dim": obs_dim, "action_dim": act_dim, "hidden": [hidden, hidden],
        "normalizer": {"mean_head": mean, "std_head": std, "folded": True},
        "deterministic": True, "note": "Gaussian mean exported; the sampled policy adds log-std noise",
        "onnx_sha256": hashlib.sha256(data).hexdigest(),
        "roundtrip_max_abs_drift": drift,
        "hardware_calibrated": False,
        "source": "simulation-only artifact; not a hardware controller",
        "selection": selection or {"mode": "last"},
    }
    (out_dir / f"{stem}.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"exported {onnx_path} (iter {ckpt['iter']}, drift {drift:.2e})")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--task", default="zola_balance")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "policies")
    parser.add_argument("--select", choices=("best", "last"), default="best")
    args = parser.parse_args()
    export_run(args.run_dir, args.out, args.task, args.select)