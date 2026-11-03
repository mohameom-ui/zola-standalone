// THE 24/7 TRAINING LOOP — Isaac trains her brain in the background, forever.
//
// Each round: pick the next skill from the rotation, train it for a slice of
// iterations, best-select-export the result, then move on. Run it and walk
// away — her policy shelf upgrades itself. Watch the curves live with
// TensorBoard on :6006 (see TRAINING_RUN).
//
//   node Scripts/isaac-continuous.mjs              # one full rotation
//   ZOLA_ROUNDS=0 node Scripts/isaac-continuous.mjs # forever (24/7)
//
// Environment knobs:
//   ZOLA_ROUNDS          how many rounds (0 = infinite; default 1)
//   ZOLA_ITERS           iterations per round (default 1500)
//   ZOLA_NUM_ENVS        parallel environments (default 64)
//   ZOLA_VENV            path to the Isaac venv (default: the session venv)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// the persistent in-repo venv (the old scratchpad venv was deleted)
const venv = process.env.ZOLA_VENV ?? path.join(repo, ".venv-isaac", "Scripts");
const isaaclab = path.join(venv, process.platform === "win32" ? "isaaclab.exe" : "isaaclab");
const python = path.join(venv, process.platform === "win32" ? "python.exe" : "python");
const logsRoot = process.env.ZOLA_LOGS ?? path.join(repo, "logs", "rsl_rl");
const rounds = Number(process.env.ZOLA_ROUNDS ?? 1);
const iters = Number(process.env.ZOLA_ITERS ?? 1500);
const numEnvs = Number(process.env.ZOLA_NUM_ENVS ?? 64);

// the rotation — every skill gets its turn; new tasks append here
const ROTATION = [
  ["Isaac-Zola-Balance-Prototype-v0", "zola_balance", "balance"],
  ["Isaac-Zola-Walk-Prototype-v0", "zola_walk", "walk"],
  ["Isaac-Zola-Hands-Prototype-v0", "zola_hands", "hands"],
  ["Isaac-Zola-Flight-Prototype-v0", "zola_flight", "flight-posture"],
  ["Isaac-Zola-Hover-Prototype-v0", "zola_hover", "hover"],
  ["Isaac-Zola-Takeoff-Prototype-v0", "zola_takeoff", "takeoff"],
  ["Isaac-Zola-Sit-Prototype-v0", "zola_sit", "sit"],
  ["Isaac-Zola-Picture-Prototype-v0", "zola_picture", "picture-pose"],
  ["Isaac-Zola-Thumbs-Prototype-v0", "zola_thumbs", "thumbs-up"],
  ["Isaac-Zola-Dance-Prototype-v0", "zola_dance", "the halobeat (dance)"],
  ["Isaac-Zola-Talk-Prototype-v0", "zola_talk", "talking expression"],
  ["Isaac-Zola-Touchdown-Prototype-v0", "zola_touchdown", "the halo touchdown"],
];

const say = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const newestRun = (experiment) => {
  const dir = path.join(logsRoot, experiment);
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir).filter((r) => statSync(path.join(dir, r)).isDirectory());
  return runs.length ? path.join(dir, runs.at(-1)) : null;
};

function run(cmd, args) {
  say(`> ${path.basename(cmd)} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], cwd: repo });
}

for (let round = 0; rounds === 0 || round < rounds; round++) {
  say(`=== ROUND ${round + 1}${rounds === 0 ? " (24/7 mode)" : ""} ===`);
  for (const [task, experiment, label] of ROTATION) {
    const runName = `auto_${label.replace(/\W+/g, "_")}_${new Date().toISOString().slice(5, 16).replace(/\W+/g, "")}`;
    say(`training ${label} (${iters} iters, ${numEnvs} envs)`);
    try {
      run(isaaclab, ["train", "--rl_library", "rsl_rl", "--task", task,
        "--num_envs", String(numEnvs), "--max_iterations", String(iters), "--run_name", runName]);
    } catch (e) {
      say(`!! training ${label} failed — moving to the next skill`);
      continue;
    }
    const runDir = newestRun(experiment);
    if (!runDir) continue;
    // keep the training log with the checkpoints so best-selection works
    try { copyFileSync(path.join(repo, "..", ".trainlog-current.log"), path.join(runDir, "training.log")); } catch {}
    try {
      run(python, ["isaac/export_policy_onnx.py", runDir, "--task", experiment]);
      say(`✓ ${label} trained and exported`);
    } catch (e) {
      say(`!! export failed for ${label}: ${e.message?.slice(0, 120)}`);
    }
  }
}
say("rotation complete — her shelf is upgraded");
