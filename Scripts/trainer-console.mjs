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
import { readdirSync, readFileSync, existsSync, openSync, copyFileSync, statSync } from "node:fs";
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
  talk: { id: "Isaac-Zola-Talk-Prototype-v0", label: "talking expression", iters: 1500 },
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
  // the run's own captured log — the server KNOWS which file it started;
  // no directory archaeology
  if (!current || !current.consoleLog) return null;
  let log = "";
  try { log = readFileSync(current.consoleLog, "utf8"); } catch { return null; }
  const matches = [...log.matchAll(/Learning iteration (\d+)\/(\d+)/g)];
  const last = matches.at(-1);
  const tail = log.split("\n").map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trim()).filter((l) => /^(Learning iteration|Mean reward|Mean episode length)/.test(l)).slice(-6);
  return { iteration: last ? Number(last[1]) : null, total: last ? Number(last[2]) : null, tail };
};

const ENGINES = [
  ["MOTOR (Isaac Sim)", "REAL RL — PPO training, best-checkpoint selection, ONNX export"],
  ["HEARING", "online — she learns YOUR phrases permanently (correct her: 'no, I said…')"],
  ["PERSONALITY", "online reinforcement — warmth and bond move with every interaction"],
  ["SCANNING + VISION", "online memory — recognition trains by encounter (the aura cache)"],
  ["TALKING", "fixed Kokoro weights; her expressiveness lives in the persona engine"],
  ["MEMORY", "online — facts, items, nightly consolidation, EXPORT LIFE reincarnation"],
];

const page = () => `<!doctype html><meta charset="utf-8"><title>ZOLA TRAINER</title>
<body style="background:#0b0e13;color:#cfd6e4;font-family:Consolas,monospace;margin:0">
<div style="display:flex;align-items:center;gap:18px;padding:10px 18px;border-bottom:1px solid #1a2233;position:sticky;top:0;background:#0b0e13;z-index:9">
  <b style="color:#f0b90b">🛸 ZOLA TRAINER</b>
  <nav id="nav" style="display:flex;gap:6px"></nav>
  <span style="margin-left:auto;color:#8b93a5" id="statusmini"></span>
</div>
<div id="status" style="padding:8px 18px;color:#ffd27a;min-height:20px"></div>
<div id="pages"></div>
<script>
const TASKS = ${JSON.stringify(TASKS)};
const ENGINES = ${JSON.stringify(ENGINES)};
function post(u) { return fetch(u, { method: "POST" }).then(r => r.text()).then(t => { document.getElementById("status").textContent = t; tick(); }); }
const PAGES = {
  control: { title: "⏺ control", render(el) {
    el.innerHTML = '<div id="status2" style="padding:4px 18px"></div><pre id="logtail" style="background:#0d1117;border:1px solid #1a2233;padding:8px;color:#7ee787;font-size:11px;max-height:140px;overflow:auto;margin:8px 18px"></pre><h3 style="padding:0 18px">start a round</h3><div id="tasks" style="display:flex;flex-wrap:wrap;gap:8px;padding:0 18px"></div><pre id="shelf" style="color:#6d7588;font-size:11px;padding:12px 18px"></pre>';
    for (const [k, t] of Object.entries(TASKS)) {
      const b = document.createElement("button");
      b.textContent = "▶ " + t.label;
      b.style.cssText = "padding:8px 12px;background:#132038;border:1px solid #2a4a7a;color:#cfe3ff;cursor:pointer";
      b.onclick = () => post("/start?task=" + k);
      el.querySelector("#tasks").append(b);
    }
    const stop = document.createElement("button");
    stop.textContent = "■ stop round";
    stop.style.cssText = "padding:8px 12px;background:#331122;color:#ff9ab0;border:0;cursor:pointer";
    stop.onclick = () => post("/stop");
    el.querySelector("#tasks").append(stop);
  }},
  view3d: { title: "🎬 3D her", render(el) {
    el.innerHTML = '<p style="padding:0 18px;color:#8b93a5">the real Isaac Sim window renders her trained policy live — one 3D window at a time (it shares the GPU with training)</p><div id="viewers" style="display:flex;flex-wrap:wrap;gap:8px;padding:0 18px"></div><div style="padding:12px 18px"><button onclick=\"post(\'/killviewer\')\" style="padding:8px 12px;background:#331122;color:#ff9ab0;border:0;cursor:pointer">close the 3D window</button></div>';
    for (const [k, t] of Object.entries(TASKS)) {
      const v = document.createElement("button");
      v.textContent = "🎬 " + t.label;
      v.style.cssText = "padding:8px 12px;background:#231a10;border:1px solid #7a5a2a;color:#ffe8c0;cursor:pointer";
      v.onclick = () => post("/viewer?task=" + k);
      el.querySelector("#viewers").append(v);
    }
  }},
  curves: { title: "📈 curves", render(el) {
    el.innerHTML = '<iframe src="http://localhost:6006" style="width:100%;height:calc(100vh - 110px);border:0;background:#0b0e13"></iframe>';
  }},
  panel: { title: "🤖 her panel", render(el) {
    el.innerHTML = '<iframe src="http://localhost:3001" style="width:100%;height:calc(100vh - 110px);border:0;background:#0b0e13"></iframe>';
  }},
  engines: { title: "🧠 engines", render(el) {
    el.innerHTML = '<table style="border-collapse:collapse;width:calc(100% - 36px);margin:12px 18px">' +
      ENGINES.map(([n, m]) => '<tr><td style="border:1px solid #1a2233;padding:6px;color:#f0b90b;white-space:nowrap">' + n + '</td><td style="border:1px solid #1a2233;padding:6px">' + m + '</td></tr>').join("") + '</table>';
  }},
};
let active = "control";
for (const [k, p] of Object.entries(PAGES)) {
  const b = document.createElement("button");
  b.textContent = p.title; b.dataset.k = k;
  b.style.cssText = "padding:6px 12px;background:transparent;border:1px solid #233;color:#8b93a5;cursor:pointer";
  b.onclick = () => { active = k; for (const n of document.getElementById("nav").children) n.style.background = n.dataset.k === k ? "#132038" : "transparent", n.style.color = n.dataset.k === k ? "#cfe3ff" : "#8b93a5"; document.getElementById("pages").innerHTML = ""; p.render(document.getElementById("pages")); tick(); };
  document.getElementById("nav").append(b);
}
async function tick() {
  const s = await (await fetch("/status")).json();
  const line = s.training
    ? "TRAINING " + s.training.label + " — " + (s.progress?.iteration ?? "?") + "/" + (s.progress?.total ?? "?")
    : "idle";
  document.getElementById("statusmini").textContent = line;
  const st = document.getElementById("status2");
  if (st) st.textContent = s.training ? "TRAINING " + s.training.label + " — iteration " + (s.progress?.iteration ?? "?") + " / " + (s.progress?.total ?? "?") + " · started " + new Date(s.training.startedAt).toLocaleTimeString() : "idle — no round running";
  const lt = document.getElementById("logtail");
  if (lt) lt.textContent = (s.logtail || []).join("\n") || "(no live training log)";
  const sh = document.getElementById("shelf");
  if (sh) sh.textContent = "policy shelf (" + s.shelf.length + "): " + s.shelf.join("  ·  ");
}
setInterval(tick, 2000);
document.getElementById("nav").children[0].click();
</script>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:3002");
  if (url.pathname === "/status") {
    const p = progress();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ training: current ? { label: current.name, startedAt: current.startedAt } : null, progress: p ? { iteration: p.iteration, total: p.total } : null, logtail: p?.tail ?? [], shelf: shelf() }));
    return;
  }
  if (url.pathname === "/start" && req.method === "POST") {
    const key = url.searchParams.get("task") ?? "";
    const t = TASKS[key];
    if (!t || current) { res.writeHead(409); res.end("busy or unknown task"); return; }
    const runName = `console_${key}_${Date.now().toString(36)}`;
    const exp = "zola_" + (t.id.split("-")[2] ?? key).toLowerCase();
    // the run's stdout IS its training log — captured per-experiment so the
    // progress tail works live, and archived into the run dir on exit so the
    // best-checkpoint selector can do its job
    const expDir = path.join(logsRoot, exp);
    if (!existsSync(expDir)) { res.writeHead(500); res.end("no experiment dir yet — train it once manually first"); return; }
    const consoleLog = path.join(expDir, `console_${Date.now().toString(36)}.log`);
    const out = openSync(consoleLog, "a");
    const proc = spawn(isaaclab, ["train", "--rl_library", "rsl_rl", "--task", t.id,
      "--num_envs", "64", "--max_iterations", String(t.iters), "--run_name", runName],
      { cwd: repo, detached: false, stdio: ["ignore", out, out],
        env: { ...process.env, OMNI_KIT_ACCEPT_EULA: "YES", PYTHONUTF8: "1" } });
    current = { name: t.label, exp, proc, startedAt: Date.now(), consoleLog };
    proc.on("exit", () => {
      current = null;
      try {
        const dir = path.join(logsRoot, exp);
        const runs = readdirSync(dir).filter((r) => statSyncSafe(path.join(dir, r))).sort().at(-1);
        if (runs) copyFileSync(consoleLog, path.join(dir, runs, "training.log"));
      } catch {}
    });
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
      "--checkpoint", "latest", "--num_envs", "1", "--viz", "kit"],
      { cwd: repo, stdio: "ignore", env: { ...process.env, OMNI_KIT_ACCEPT_EULA: "YES", PYTHONUTF8: "1" } });
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
