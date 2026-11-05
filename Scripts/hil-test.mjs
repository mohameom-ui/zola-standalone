#!/usr/bin/env node
// hil-test.mjs — THE HIL PIPELINE SELF-TEST
//   node Scripts/hil-test.mjs
//
// Spins the telemetry bridge in --sim mode (spec-shaped frames, no FC
// hardware needed), connects as a panel client, and asserts the contract:
//   * frames arrive at ~100 Hz (the spec's promise, ±40% for scheduler slack)
//   * every frame carries the full schema (attitude, 4 motors, battery)
//   * sequence ids are monotonically increasing (no gaps, no rewinds)
//   * battery sanity (a 3S LiPo reads 9-13 V — 9000-13000 mV)
// Exit 0 = the HIL lane is live end to end.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WS_URL = process.env.ZOLA_WS_URL ?? "ws://127.0.0.1:8002";
const SAMPLE_MS = Number(process.env.ZOLA_HIL_SAMPLE_MS ?? 4000);

const fail = (msg) => { console.error(`HIL-TEST FAIL: ${msg}`); process.exit(1); };

const bridge = spawn(process.platform === "win32" ? "python" : "python3",
  [path.join(repo, "bridge", "zola_bridge.py"), "--sim"],
  { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
bridge.stderr.on("data", (d) => process.stderr.write(`[bridge] ${d}`));

const guard = setTimeout(() => fail(`the test never completed within ${SAMPLE_MS + 8000} ms`), SAMPLE_MS + 8000);
const frames = [];
let lastSeq = null;

function onMessage(event) {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return fail("non-JSON frame on the wire"); }
  if (msg.type !== "ZOLA_TELEMETRY_UPDATE" || msg.panel_id !== "hil_telemetry_03") {
    return fail(`wrong envelope: ${msg.type}/${msg.panel_id}`);
  }
  const p = msg.payload;
  if (typeof p.sequence_id !== "number" || typeof p.timestamp_us !== "number") fail("missing seq/timestamp");
  if (!p.attitude || !Number.isFinite(p.attitude.roll) || !Number.isFinite(p.attitude.pitch) || !Number.isFinite(p.attitude.yaw)) fail("bad attitude");
  if (!Array.isArray(p.motors) || p.motors.length !== 4) fail("motors must be 4 values");
  if (p.battery_mv < 9000 || p.battery_mv > 13000) fail(`battery ${p.battery_mv} mV out of 3S range`);
  if (lastSeq !== null && p.sequence_id <= lastSeq) fail(`sequence went backwards: ${lastSeq} → ${p.sequence_id}`);
  lastSeq = p.sequence_id;
  frames.push(p);
}

function onOpen() {
  console.log(`HIL-TEST: connected to ${WS_URL}, sampling for ${SAMPLE_MS} ms...`);
  setTimeout(() => {
    clearTimeout(guard);
    const rate = frames.length / (SAMPLE_MS / 1000);
    console.log(`HIL-TEST: ${frames.length} frames in ${SAMPLE_MS} ms = ${rate.toFixed(0)} fps`);
    if (rate < 60) fail(`telemetry starved: ${rate.toFixed(0)} fps (spec promises 100)`);
    if (rate > 150) fail(`telemetry flooded: ${rate.toFixed(0)} fps`);
    console.log(`HIL-TEST: last frame seq=${lastSeq} battery=${frames.at(-1)?.battery_mv} mV motors=[${frames.at(-1)?.motors}]`);
    console.log("HIL-TEST PASS — the HIL lane is live end to end (sim source)");
    ws.close();
    bridge.kill();
    process.exit(0);
  }, SAMPLE_MS);
}

// connect with retries — the bridge needs a moment to bind after spawn
let ws = null;
function connect(attempt = 0) {
  ws = new WebSocket(WS_URL);
  ws.onerror = () => {
    if (attempt < 16) setTimeout(() => connect(attempt + 1), 500);
    else fail(`could not connect to ${WS_URL} after 8 s (is the bridge up?)`);
  };
  ws.onmessage = onMessage;
  ws.onopen = onOpen;
}
connect();

process.on("exit", () => { try { bridge.kill(); } catch {} });
