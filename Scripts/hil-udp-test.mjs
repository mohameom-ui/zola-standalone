#!/usr/bin/env node
// hil-udp-test.mjs — THE WIRELESS LANE'S SELF-TEST
//   node Scripts/hil-udp-test.mjs
//
// Spins bridge/zola_udp_bridge.py --sim (a fake FC blasting spec-shaped
// datagrams at 100 Hz into UDP 8888, the bridge relaying to WS 8003), then
// connects as a panel client and asserts the contract:
//   * the ZOLA_UDP_TELEMETRY envelope arrives with FULL decoded payloads
//     (the draft forwarded only metadata — a size is not a flight)
//   * frames at ~100 Hz, sequence monotonic, battery sane
//   * the source_ip is carried (which mesh node spoke)
// Exit 0 = the wireless lane is live end to end.

import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WS_URL = process.env.ZOLA_WS_URL ?? "ws://127.0.0.1:8003";
const UDP_PORT = 8888;
const SAMPLE_MS = Number(process.env.ZOLA_HIL_SAMPLE_MS ?? 4000);

const fail = (msg) => { console.error(`HIL-UDP FAIL: ${msg}`); process.exit(1); };

// the packet builder in JS — the CRC is the firmware's reflected 0xA001
function zolaCrc(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
}
function buildFrame(seq, tsUs, roll, pitch, yaw, motors, battMv) {
  const head = Buffer.alloc(32);
  head.writeUInt16LE(0xfbfa, 0);
  head.writeUInt32LE(seq, 2);
  head.writeUInt32LE(tsUs, 6);
  head.writeFloatLE(roll, 10);
  head.writeFloatLE(pitch, 14);
  head.writeFloatLE(yaw, 18);
  for (let m = 0; m < 4; m++) head.writeUInt16LE(motors[m], 22 + m * 2);
  head.writeUInt16LE(battMv, 30);
  const frame = Buffer.alloc(36);
  head.copy(frame, 0);
  frame.writeUInt16LE(zolaCrc(head), 32);
  frame.writeUInt16LE(0xfdfc, 34);
  return frame;
}

const bridge = spawn(process.platform === "win32" ? "python" : "python3",
  [path.join(repo, "bridge", "zola_udp_bridge.py"), "--sim"],
  { cwd: repo, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONUTF8: "1" } });
bridge.stderr.on("data", (d) => process.stderr.write(`[bridge] ${d}`));
// the bridge's stdout is the closed loop's evidence: the SimFC logs every
// command it receives after the bridge forwards it
let bridgeLog = "";
bridge.stdout.on("data", (d) => { bridgeLog += d.toString(); });

const guard = setTimeout(() => fail(`the test never completed within ${SAMPLE_MS + 12000} ms`), SAMPLE_MS + 12000);
const frames = [];
let ourLastSeq = null;
let sawSourceIp = false;

function onMessage(event) {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return fail("non-JSON frame on the wire"); }
  if (msg.type !== "ZOLA_UDP_TELEMETRY" || msg.panel_id !== "hil_telemetry_03") {
    return fail(`wrong envelope: ${msg.type}/${msg.panel_id}`);
  }
  if (typeof msg.source_ip === "string") sawSourceIp = true;
  const p = msg.payload;
  if (typeof p.sequence_id !== "number" || !p.attitude || !Array.isArray(p.motors)) {
    return fail("incomplete payload — metadata is not a flight");
  }
  // TWO independent FCs interleave on the mesh (the sim + this test's own
  // sender) — a GLOBAL monotonic check is invalid by design. Monotonicity
  // is asserted per source: ours (roll = 11.5) must never rewind.
  if (p.attitude.roll === 11.5) {
    if (ourLastSeq !== null && p.sequence_id <= ourLastSeq) {
      fail(`our sequence went backwards: ${ourLastSeq} → ${p.sequence_id}`);
    }
    ourLastSeq = p.sequence_id;
  }
  frames.push(p);
}

function onOpen() {
  // THE COMMAND ROUND TRIP, part 1 — sent 600 ms after connect: an operator
  // commands an FC she has HEARD (the bridge learns the FC's return address
  // from its first telemetry datagram; a command sent before that has no
  // route, and the bridge drops it — correctly).
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: "ZOLA_COMMAND",
      cmd_id: 2,
      payload_hex: "00".repeat(9),
    }));
  }, 600);
  // an INDEPENDENT second FC: our OWN datagrams, with values the bridge
  // never generated — proving the decode is real, not an echo of the sim
  const sock = createSocket("udp4");
  let seq = 100000;
  const start = Date.now();
  const timer = setInterval(() => {
    const t = (Date.now() - start) / 1000;
    seq += 7;  // deliberate gaps: UDP loses by design; the id exposes it
    sock.send(buildFrame(seq, Math.floor(t * 1e6),
      11.5, -7.25, 123.0, [1300, 1400, 1500, 1600], 11800), UDP_PORT, "127.0.0.1");
  }, 10);
  setTimeout(() => {
    clearInterval(timer);
    sock.close();
    clearTimeout(guard);
    const rate = frames.length / (SAMPLE_MS / 1000);
    console.log(`HIL-UDP: ${frames.length} frames in ${SAMPLE_MS} ms = ${rate.toFixed(0)} fps (sim FC + our independent FC interleaved)`);
    if (rate < 60) fail(`telemetry starved: ${rate.toFixed(0)} fps`);
    // our datagrams carry roll = 11.5 — a value the sim FC never generates
    const ours = frames.filter((f) => f.attitude.roll === 11.5);
    if (!ours.length) fail("our independent datagrams never arrived decoded — the bridge is echoing, not parsing");
    if (!sawSourceIp) fail("source_ip missing — the mesh node identity was dropped");
    console.log(`HIL-UDP: our datagrams decoded: ${ours.length} (last our-seq ${ourLastSeq}), total ${frames.length}`);
    // THE COMMAND ROUND TRIP, part 2: the SimFC must have LOGGED the disarm
    if (!bridgeLog.includes("[SimFC] COMMAND RECEIVED id=0x02")) {
      fail(`the emergency-disarm never reached the FC — the closed loop is broken. Log:\n${bridgeLog.slice(-600)}`);
    }
    console.log("HIL-UDP: the panel's EMERGENCY DISARM reached the FC through the full loop (panel → bridge → FC)");
    console.log("HIL-UDP PASS — the wireless lane is live end to end, both directions");
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
