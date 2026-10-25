// Zola's ArduPilot SITL-only first-flight script. It waits for authenticated,
// fresh battery/armed/altitude telemetry before sending any movement setpoints.
const URL = process.argv[2] ?? "ws://localhost:8765";
const ws = new WebSocket(URL);
const timers = new Set();
let authenticated = false;
let startRequested = false;
let flightPlanStarted = false;
let stopRequested = false;
let finished = false;
let n = 0;
let maxAlt = 0;
let activeSetpoint = { vx: 0, vy: 0, vz: 0, yaw: 0, led: "#f0b90b" };
const t0 = Date.now();

const say = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const send = (message) => {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try { ws.send(JSON.stringify(message)); return true; } catch { return false; }
};
const later = (fn, delay) => {
  const id = setTimeout(() => { timers.delete(id); fn(); }, delay);
  timers.add(id);
  return id;
};
const clearTimers = () => { for (const id of timers) clearTimeout(id); timers.clear(); };
function finish(code, message) {
  if (finished) return;
  finished = true;
  if (message) say(message);
  clearTimers();
  process.exitCode = code;
  if (ws.readyState === WebSocket.OPEN) ws.close();
  setTimeout(() => process.exit(code), 250);
}
function fail(message) {
  if (finished) return;
  say(message);
  process.exitCode = 1;
  if (startRequested && !stopRequested) {
    stopRequested = true;
    send({ t: "stop" });
    later(() => finish(1, "flight script stopped after requesting landing"), 50000);
  } else {
    finish(1);
  }
}
function beginFlightPlan() {
  flightPlanStarted = true;
  say("ArduPilot reports armed at flight altitude — beginning the SITL motion plan");
  const vel = (vx, vy, vz, yaw = 0) => {
    activeSetpoint = { vx, vy, vz, yaw, led: "#f0b90b" };
    send({ t: "vel", ...activeSetpoint });
  };
  later(() => { say("PHASE 2: gentle drift"); vel(0.3, 0, 0); }, 12000);
  later(() => vel(0.3, 0.2, 0), 16000);
  later(() => vel(-0.2, 0.3, 0), 20000);
  later(() => vel(-0.3, -0.2, 0), 24000);
  later(() => { vel(0, 0, 0); say("PHASE 3: holding hover, checking telemetry"); }, 28000);
  later(() => {
    stopRequested = true;
    say("PHASE 4: requesting a controlled landing");
    send({ t: "stop" });
  }, 38000);
  later(() => finish(0, `FLIGHT COMPLETE — max altitude ${maxAlt.toFixed(2)}m, ${n} telemetry messages`), 52000);
}

ws.onopen = () => {
  say(`connected to ${URL} — authenticating with the ground relay`);
  send({ t: "auth", token: process.env.ZOLA_RELAY_TOKEN ?? "" });
};

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.t === "auth") {
      if (data.ok !== true) {
        fail("relay authentication failed — check ZOLA_RELAY_TOKEN");
        return;
      }
      if (!authenticated) {
        authenticated = true;
        say("authenticated — waiting for fresh battery telemetry before requesting takeoff");
        later(() => { if (!startRequested) fail("no valid battery telemetry received within 15 seconds"); }, 15000);
      }
      return;
    }
    if (data.t !== "pose") return;

    n++;
    if (typeof data.z === "number" && Number.isFinite(data.z)) maxAlt = Math.max(maxAlt, data.z);
    if (n % 10 === 0) {
      const positionValid = [data.x, data.y, data.z, data.yaw].every((value) => typeof value === "number" && Number.isFinite(value));
      const battery = typeof data.battery === "number" && Number.isFinite(data.battery)
        ? `${(data.battery * 100).toFixed(0)}%`
        : "—";
      if (positionValid) say(`telemetry: pos=(${data.x.toFixed(2)}, ${data.y.toFixed(2)}) alt=${data.z.toFixed(2)}m yaw=${(data.yaw * 57.3).toFixed(0)}° bat=${battery}`);
    }

    if (!startRequested && typeof data.battery === "number" && Number.isFinite(data.battery)) {
      if (data.battery < 0.15) {
        fail(`takeoff refused — battery telemetry is below 15% (${(data.battery * 100).toFixed(0)}%)`);
        return;
      }
      startRequested = true;
      say("fresh battery telemetry received — requesting START");
      if (!send({ t: "start" })) fail("could not send START to the relay");
      const keepalive = () => {
        if (startRequested && !stopRequested && !finished) {
          send({ t: "vel", ...activeSetpoint });
          later(keepalive, 500);
        }
      };
      later(keepalive, 500);
      later(() => {
        if (!flightPlanStarted) fail("takeoff was not confirmed within 45 seconds");
      }, 45000);
    }

    if (startRequested && !flightPlanStarted && data.flying === true && typeof data.z === "number" && data.z >= 0.5) {
      beginFlightPlan();
    }
  } catch { /* ignore malformed telemetry */ }
};
ws.onclose = () => {
  if (!finished && startRequested && !stopRequested) fail("relay link closed during flight — landing request could not be confirmed");
  else if (!finished && !authenticated) fail("link closed before relay authentication");
};
ws.onerror = (event) => { if (!finished) say(`link error: ${event.message ?? "unknown"}`); };
later(() => fail("timeout — aborting"), 90000);
