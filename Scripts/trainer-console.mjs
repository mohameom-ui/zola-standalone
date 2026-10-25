// THE TRAINER CONSOLE — localhost:3002
// Your command center for Zola's training: start/stop any skill's training
// round, watch progress, open the LIVE 3D SIM WINDOW (isaaclab play --viz kit
// — her actual physics body, rendered, moving, in real time), and jump to
// TensorBoard for the curves. No dependencies — plain node http.
//
//   node Scripts/trainer-console.mjs        # serves http://localhost:3002
//
// POST /start?task=Hover      begin a training round (kills any current one)
// POST /stop                  stop the current training round
// POST /viewer?task=Hover     open the LIVE 3D window of the trained policy
// POST /killviewer            close the 3D window
// GET  /status                JSON: current round, progress, shelf
import http from "node:http";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venv = process.env.ZOLA_VENV ?? String.raw`C:\Users\self_\.lmstudio\scratchpads\p\isaac-venv\Scripts`;
const isaaclab = path.join(venv, "isaaclab.exe");
const logsRoot = process.env.ZOLA_LOGS ?? String.raw`C:\Users\self_\.lmstudio\scratchpads\p\logs\rsl_rl`;

const TASKS = {
  balance: { id: "Isaac-Zola-Balance-Prototype-v0", label: "balance", iters: 1500 },
  walk: { id: "Isaac-Zola-Walk-Prototype-v0", label: "walk", iters: 2000 },
  hands: { id: "Isaac-Zola-Hands-Prototype-v0", label: "hands", iters: 1500 },
  flight: { id: "Isaac-Zola-Flight-Prototype-v0", label: "flight posture", iters: 1500 },
  hover: { id: "Isaac-Zola-Hover-Prototype-v0", label: "hover (real rotor flight)", iters: 2500 },
  takeoff: { id: "Isaac-Zola-Takeoff-Prototype-v0", label: "takeoff", iters: 2000 },
  sit: { id: "Isaac-Zola-Sit-Prototype-v0", label: "sit", iters: 1500 },
  picture: { id: "Isaac-Zola-Picture-Prototype-v0", label: "picture pose", iters: 1200 },
  thumbs: { id: "Isaac-Zola-Thumbs-Prototype-v0", label: "thumbs up", iters: 1200 },
  dance: { id: "Isaac-Zola-Dance-Prototype-v0", label: "the halobeat (dance)", iters: 2000 },
  touchdown: { id: "Isaac-Zola-Touchdown-Prototype-v0", label: "the halo touchdown", iters: 2500 },
};

let current = null;
let viewer = null;

const shelf = () => {
  const dir = path.join(repo, "isaac", "policies");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".onnx")).map((f) => f.replace(".onnx", ""));
};

const progress = () => {
  // count the latest "Learning iteration N/M" in the newest run of the active experiment
  if (!current) return null;
  const exp = current.name;
  const dir = path.join(logsRoot, exp);
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir).filter((r) => !r.startsWith(".")).sort().at(-1);
  if (!runs) return null;
  try {
    const log = readFileSync(path.join(dir, runs, "training.log"), "utf8");
    const matches = [...log.matchAll(/Learning iteration (\d+)\/(\d+)/g)];
    const last = matches.at(-1);
    return last ? { iteration: Number(last[1]), total: Number(last[2]) } : null;
  } catch { return null; }
};

const page = () => `<!doctype html><meta charset="utf-8"><title>ZOLA TRAINER</title>
<body style="background:#0b0e13;color:#cfd6e4;font-family:Consolas,monospace;max-width:900px;margin:30px auto">
<h1 style="color:#f0b90b">🛸 ZOLA TRAINER CONSOLE</h1>
<p>Live curves: <a href="http://localhost:6006" style="color:#5ac8fa" target="_blank">TensorBoard :6006</a>
 · Her panel: <a href="http://localhost:3001" style="color:#5ac8fa" target="_blank">:3001</a></p>
<div id="status" style="border:1px solid #233;padding:10px;margin:10px 0"></div>
<h2>start a training round</h2>
<div id="tasks" style="display:flex;flex-wrap:wrap;gap:8px"></div>
<h2>watch her live, in 3D</h2>
<p style="color:#8b93a5">opens the Isaac Sim window rendering her trained policy — one at a time (it shares the GPU with training)</p>
<div id="viewers" style="display:flex;flex-wrap:wrap;gap:8px"></div>
<div style="margin-top:14px"><button onclick="fetch('/killviewer',{method:'POST'})" style="background:#331">close 3D window</button></div>
<pre id="shelf" style="color:#6d7588;font-size:11px"></pre>
<script>
const TASKS = ${JSON.stringify(TASKS)};
for (const [k, t] of Object.entries(TASKS)) {
  const b = document.createElement("button");
  b.textContent = "▶ train " + t.label;
  b.style.cssText = "padding:8px 12px;background:#132038;border:1px solid #2a4a7a;color:#cfe3ff;cursor:pointer";
  b.onclick = () => fetch("/start?task=" + k, { method: "POST" }).then(() => tick());
  document.getElementById("tasks").append(b);
  const v = document.createElement("button");
  v.textContent = "🎬 3D: " + t.label;
  v.style.cssText = "padding:8px 12px;background:#231a10;border:1px solid #7a5a2a;color:#ffe8c0;cursor:pointer";
  v.onclick = () => fetch("/viewer?task=" + k, { method: "POST" });
  document.getElementById("viewers").append(v);
}
async function tick() {
  const s = await (await fetch("/status")).json();
  document.getElementById("status").innerHTML = s.training
    ? "TRAINING <b style='color:#ffd27a'>" + s.training.label + "</b> — iteration " + (s.progress?.iteration ?? "?") + " / " + (s.progress?.total ?? "?") + " · started " + new Date(s.training.startedAt).toLocaleTimeString()
    : "idle — no training round running";
  document.getElementById("shelf").textContent = "policy shelf: " + s.shelf.join("  ·  ");
}
setInterval(tick, 2000); tick();
</script>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:3002");
  if (url.pathname === "/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ training: current ? { label: current.name, startedAt: current.startedAt } : null, progress: progress(), shelf: shelf() }));
    return;
  }
  if (url.pathname === "/start" && req.method === "POST") {
    const key = url.searchParams.get("task") ?? "";
    const t = TASKS[key];
    if (!t || current) { res.writeHead(409); res.end("busy or unknown task"); return; }
    const runName = `console_${key}_${Date.now().toString(36)}`;
    const proc = spawn(isaaclab, ["train", "--rl_library", "rsl_rl", "--task", t.id,
      "--num_envs", "64", "--max_iterations", String(t.iters), "--run_name", runName],
      { cwd: repo, detached: false, stdio: "ignore" });
    current = { name: t.id.split("-")[2] ?? key, proc, startedAt: Date.now() };
    proc.on("exit", () => { current = null; });
    res.writeHead(200); res.end("started " + t.label);
    return;
  }
  if (url.pathname === "/stop" && req.method === "POST") {
    if (current) { current.proc.kill(); current = null; }
    res.writeHead(200); res.end("stopped");
    return;
  }
  if (url.pathname === "/viewer" && req.method === "POST") {
    const key = url.searchParams.get("task") ?? "touchdown";
    const t = TASKS[key] ?? TASKS.touchdown;
    if (viewer) { viewer.kill(); viewer = null; }
    // the LIVE 3D window: her trained policy, rendered, in real time
    viewer = spawn(isaaclab, ["play", "--rl_library", "rsl_rl", "--task", t.id,
      "--checkpoint", "latest", "--num_envs", "1", "--viz", "kit"], { cwd: repo, stdio: "ignore" });
    viewer.on("exit", () => { viewer = null; });
    res.writeHead(200); res.end("3D window opening for " + t.label);
    return;
  }
  if (url.pathname === "/killviewer" && req.method === "POST") {
    if (viewer) { viewer.kill(); viewer = null; }
    res.writeHead(200); res.end("viewer closed");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(page());
});

server.listen(3002, "127.0.0.1", () => {
  console.log("ZOLA TRAINER CONSOLE → http://localhost:3002");
});
