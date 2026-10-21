// Zola's first flight — an automated brain: connect, take off, fly, land.
const URL = process.argv[2] ?? "ws://localhost:8765"; // WSL2 localhost forwarding reaches the relay
const ws = new WebSocket(URL);
let last = null;
let armed = false;
const t0 = Date.now();

const say = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

ws.onopen = () => {
  say(`linked to ${URL} — sending START (arm + takeoff)`);
  ws.send(JSON.stringify({ t: "start" }));
  // flight plan: hover 12s -> figure-8-ish drift -> hover -> land
  const vel = (vx, vy, vz, yaw = 0) => ws.send(JSON.stringify({ t: "vel", vx, vy, vz, yaw, led: "#f0b90b" }));
  setTimeout(() => say("PHASE 2: gentle drift"), 12000);
  setTimeout(() => vel(0.3, 0, 0), 12000);
  setTimeout(() => vel(0.3, 0.2, 0), 16000);
  setTimeout(() => vel(-0.2, 0.3, 0), 20000);
  setTimeout(() => vel(-0.3, -0.2, 0), 24000);
  setTimeout(() => vel(0, 0, 0), 28000);
  setTimeout(() => say("PHASE 3: holding hover, checking telemetry"), 28000);
  setTimeout(() => { say("PHASE 4: landing"); ws.send(JSON.stringify({ t: "stop" })); }, 38000);
  setTimeout(() => {
    say(`FLIGHT COMPLETE — max alt seen: ${maxAlt.toFixed(2)}m, positions received: ${n}`);
    process.exit(0);
  }, 46000);
};

let n = 0;
let maxAlt = 0;
ws.onmessage = (e) => {
  try {
    const d = JSON.parse(e.data);
    if (d.t === "pose") {
      n++;
      last = d;
      if (d.z > maxAlt) maxAlt = d.z;
      if (n % 10 === 0) say(`telemetry: pos=(${d.x.toFixed(2)}, ${d.y.toFixed(2)}) alt=${d.z.toFixed(2)}m yaw=${(d.yaw * 57.3).toFixed(0)}° bat=${(d.battery * 100).toFixed(0)}%`);
    }
  } catch { /* ignore */ }
};
ws.onclose = () => { if (!armed) say("link closed"); };
ws.onerror = (e) => say(`link error: ${e.message ?? "unknown"}`);
setTimeout(() => { say("TIMEOUT — aborting"); process.exit(1); }, 90000);