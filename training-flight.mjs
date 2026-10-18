// Zola's training flight — the panel's drill sequence, run on the real flight stack:
// takeoff → hover-hold (graded) → square pattern → return home → land.
const URL = process.argv[2] ?? "ws://172.29.1.125:8765";
const ws = new WebSocket(URL);
let pos = { x: 0, y: 0, z: 0 };
let bat = 1;
const t0 = Date.now();
const say = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const vel = (vx, vy, vz, yaw = 0) => ws.send(JSON.stringify({ t: "vel", vx, vy, vz, yaw, led: "#f0b90b" }));

ws.onopen = () => {
  say(`linked — START (arm + takeoff to 0.8m)`);
  ws.send(JSON.stringify({ t: "start" }));

  // DRILL 1 — hover hold 10s, sample position for grading
  const samples = [];
  let start = { x: 0, y: 0 };
  setTimeout(() => { say("DRILL 1: hover hold — sampling stability…"); }, 8000);
  const hoverTimer = setInterval(() => {
    if (pos.z > 0.3 && samples.length === 0) start = { x: pos.x, y: pos.y };
    if (pos.z > 0.3) samples.push(Math.hypot(pos.x - start.x, pos.y - start.y));
  }, 200);
  setTimeout(() => {
    clearInterval(hoverTimer);
    const mean = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
    const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length || 1));
    const score = Math.max(0, Math.min(99, Math.round(100 - sd * 260)));
    say(`DRILL 1 GRADE — Hover hold: ${score}% (deviation σ = ${sd.toFixed(3)}m over ${samples.length} samples)`);
  }, 19000);

  // DRILL 2 — square pattern (4 legs × 3s)
  setTimeout(() => say("DRILL 2: square pattern — flying the legs…"), 20000);
  setTimeout(() => vel(0.35, 0, 0), 20000);
  setTimeout(() => vel(0, 0.35, 0), 23000);
  setTimeout(() => vel(-0.35, 0, 0), 26000);
  setTimeout(() => vel(0, -0.35, 0), 29000);
  setTimeout(() => say("DRILL 2 COMPLETE — square flown"), 32000);

  // DRILL 3 — return home + final hover
  setTimeout(() => say("DRILL 3: return to start + hold…"), 32000);
  setTimeout(() => vel(0.2, -0.2, 0), 32000);
  setTimeout(() => vel(0, 0, 0), 35000);
  setTimeout(() => say("Holding final hover…"), 35000);

  // LAND
  setTimeout(() => { say("LANDING"); ws.send(JSON.stringify({ t: "stop" })); }, 45000);
  setTimeout(() => {
    say(`TRAINING FLIGHT COMPLETE — flights logged. (final battery: ${(bat * 100).toFixed(0)}%)`);
    process.exit(0);
  }, 54000);
};

let n = 0;
ws.onmessage = (e) => {
  try {
    const d = JSON.parse(e.data);
    if (d.t === "pose") {
      n++;
      pos = d;
      bat = d.battery ?? bat;
      if (n % 15 === 0) say(`telemetry: pos=(${d.x.toFixed(2)}, ${d.y.toFixed(2)}) alt=${d.z.toFixed(2)}m bat=${(d.battery * 100).toFixed(0)}%`);
    }
  } catch { /* ignore */ }
};
ws.onerror = (e) => say(`link error: ${e?.message ?? "unknown"}`);
setTimeout(() => { say("TIMEOUT"); process.exit(1); }, 80000);