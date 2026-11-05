// zola-brief.js — builds the professor brief as a self-contained HTML file
//   node Scripts/zola-brief.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const read64 = (p) => fs.readFileSync(p).toString("base64");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url || __filename)), "..");

// the V12 canon render — rescued from the ephemeral scratchpad into the repo
const conceptRender = read64(path.join(repo, "Saved", "canon", "zola-v12-render.jpg"));
const panelShot = read64(path.join(repo, "Saved", "audit-collar-v2.png"));

let isaacHover = null, isaacTouchdown = null;
try { isaacHover = read64(path.join(repo, "Saved", "isaac-showcase", "frame-hover.png")); } catch {}
try { isaacTouchdown = read64(path.join(repo, "Saved", "isaac-showcase", "frame-touchdown.png")); } catch {}

const img = (b64, mime, w) => b64 ? `<img src="data:image/${mime};base64,${b64}" style="max-width:${w};border-radius:8px;margin:8px auto;display:block" />` : "";

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ZOLA — Project Brief</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1a1a2e; background: #f5f6fa; max-width: 820px; margin: 0 auto; padding: 40px 24px; line-height: 1.65; }
  h1 { font-size: 2em; color: #0a0a2e; border-bottom: 3px solid #2ee6c8; padding-bottom: 12px; margin-bottom: 6px; }
  .subtitle { color: #555; font-size: 1.1em; margin-bottom: 24px; }
  h2 { font-size: 1.3em; color: #0a0a2e; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #ddd; }
  h3 { font-size: 1.05em; color: #333; margin: 18px 0 6px; }
  p { margin: 8px 0; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 16px 0; }
  .stat { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; text-align: center; }
  .stat .num { font-size: 1.6em; font-weight: bold; color: #1a9e8e; }
  .stat .label { font-size: 0.8em; color: #666; }
  .img-cap { text-align: center; font-size: 0.8em; color: #888; margin-top: 4px; }
  .code-block { background: #0a0a2e; color: #2ee6c8; padding: 12px 16px; border-radius: 6px; font-family: Consolas, monospace; font-size: 0.85em; margin: 10px 0; overflow-x: auto; white-space: pre-wrap; }
  .callout { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin: 14px 0; border-radius: 4px; font-size: 0.92em; }
  .callout.success { background: #d4edda; border-left: 4px solid #28a745; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.9em; }
  th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
  th { background: #f0f0f0; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media print { body { background: white; padding: 20px; } }
</style></head><body>

<h1>ZOLA — Autonomous Companion &amp; Flight-Control Platform</h1>
<p class="subtitle">A full-stack engineering project: web application, reinforcement-learning-trained robot body, 3D-printable physical design, and a live operational console — built and verified end-to-end.</p>

<div class="stat-grid">
  <div class="stat"><div class="num">162</div><div class="label">unit tests passing</div></div>
  <div class="stat"><div class="num">12</div><div class="label">RL training runs</div></div>
  <div class="stat"><div class="num">~30M</div><div class="label">simulation steps</div></div>
  <div class="stat"><div class="num">11</div><div class="label">verified ONNX policies</div></div>
  <div class="stat"><div class="num">7</div><div class="label">trained skills</div></div>
  <div class="stat"><div class="num">41</div><div class="label">physics joints</div></div>
</div>

<h2>What Zola Is</h2>
<p>Zola is an autonomous companion built as three representations of one design, all generated from the same source profile:</p>
<div class="two-col">
  <div><h3>The Web Body</h3><p>A Next.js application serving a 65-bone animated 3D humanoid with a quad-drone collar rig, real-time neural voice, camera vision (MediaPipe + SmolVLM), and a personality engine that adapts to the human. Runs at localhost:3001.</p></div>
  <div><h3>The Physics Body</h3><p>A 41-joint, 42.18 kg humanoid robot trained in NVIDIA Isaac Sim via reinforcement learning (PPO / RSL-RL). Seven skills: balance, walking, arm-and-hand poses, flight posture, the Halo Touchdown, coupled hover, and the takeoff transition — each exported as a verified ONNX artifact.</p></div>
</div>
<div class="two-col">
  <div><h3>The Physical Body</h3><p>A 3D-printable design for the Ender 3 Max Neo (300 mm bed): a 280 mm desktop one-piece or a 45 cm figure in 10 joint-centered parts, plus the neck-collar drone rig and every hardware mount.</p></div>
  <div><h3>The Living Console</h3><p>A trainer console (:3002) that commands training rounds, a debug engine (:3003) checking 15 systems, a defense watch (:3004) monitoring the host, and TensorBoard (:6006) streaming every curve.</p></div>
</div>

<h2>The Design</h2>
${img(conceptRender, "jpeg", 380)}
<p class="img-cap">The V12 design canon — white ceramic armor, matte-black chassis, single lens eye, four ducted fans on a neck collar</p>
<p>The design was iterated across 12 committed revisions. The current form: an athletic feminine silhouette in polished white ceramic and dark carbon-fiber, a minimalist face plate carrying a single monocular AI sensor, and a functional quad-drone collar that provides real thrust. The proportions, joint ranges, and mass distribution come from the physics profile — the same artifact that generates the URDF, the USD, and the MuJoCo twin.</p>

<h2>The Training</h2>
<p>Her motor skills are trained in NVIDIA Isaac Sim using PPO (RSL-RL) across 12 runs totaling ~30 million simulation steps. Each run produces a checkpoint that is exported to ONNX with a round-trip verification against the training framework (max drift enforced at ≤ 1e-4).</p>
${img(isaacHover, "png", 380)}
<p class="img-cap">The coupled-hover policy in Isaac Sim — she rides her collar rotors at 6 N gusts</p>

<table>
<tr><th>Skill</th><th>Result</th><th>Episodes</th></tr>
<tr><td>Standing balance</td><td>25.75 reward</td><td>599/600</td></tr>
<tr><td>Walking (velocity tracking)</td><td>22.26 reward</td><td>599/600</td></tr>
<tr><td>Arm &amp; hand pose control</td><td>34.70 reward</td><td>598/600</td></tr>
<tr><td>Flight posture discipline</td><td>34.03 reward</td><td>596/600</td></tr>
<tr><td>The Halo Touchdown (invented)</td><td>34.02 reward</td><td>595/600</td></tr>
<tr><td>Coupled hover (real rotor physics)</td><td>28.43 reward</td><td>599/600</td></tr>
</table>

<h2>The Engineering Discipline</h2>
<div class="callout success">
<b>Every failure is on the record with its named cause.</b> The Halo Touchdown took six failed runs before the seventh succeeded — each failure taught one thing (COM outside the support polygon, the ankle must close the kinematic chain, the arm flourish's reaction torque, the instant fake curriculum, the snapped-flourish spin). The sit pose remains untrained after five attempts across three control modes — the evidence chain is preserved.
</div>

<p>The project maintains:</p>
<ul style="padding-left:20px;margin:8px 0">
<li><b>162 unit tests</b> covering the brain, the safety governor, the expression library, and the physics contracts</li>
<li><b>A MuJoCo physics twin</b> generated from the same canon profile — an independent verification layer</li>
<li><b>A debug engine</b> checking 15 systems in under two minutes</li>
<li><b>A trainer console</b> where the human commands training rounds and watches the 3D body live</li>
<li><b>A 24/7 training loop</b> that rotates through every skill, best-select-exports, and repeats</li>
</ul>

<h2>The Brain</h2>
<p>Her cognition runs on a three-tier local pipeline: Ollama (8B, conversational), a local Qwen model (on-device), and a reflex layer for known commands. A personality engine adapts warmth, energy, and sass across sessions. A nightly dream engine consolidates the day's memories.</p>
<p>Her body expression is a choreography engine — keyframe poses at a fixed tempo, cosine-eased between steps. She has eleven voice-commanded tricks, a defense monitor, a body map she recites from her own physics profile, and a self-builder that writes new capabilities through an AST sandbox gate.</p>

<h2>The Architecture</h2>
<div class="code-block">browser brain (Next.js :3001)          her body
┌──────────────────────────────┐   WebSocket  ┌──────────────────────┐
│ reflex brain + Ollama brain  │ ───────────> │ ground relay         │
│ moods · tasks · memory       │              │ (pymavlink)          │
│ vision · hearing · speech    │ <─────────── │ MAVLink              │
│ self-builder (AST sandbox)   │   telemetry  │ ↓                   │
│ defense monitor              │              │ ArduPilot SITL /     │
│ 11 ONNX policies             │              │ real FC (Pi 5)       │
└──────────────────────────────┘              └──────────────────────┘

trainer console (:3002) · debug engine (:3003) · defense watch (:3004) · tensorboard (:6006)
Scripts/isaac-continuous.mjs — the 24/7 training loop</div>

<h2>What's Next</h2>
<div class="callout">
<b>Honest open items, with their evidence:</b><br>
① The sit pose needs a working torque-write kernel in Isaac (this build's Warp kernel is broken on this GPU) — three control modes attempted.<br>
② The hardware build needs a servo bridge — the physics profile is calibrated in simulation only.<br>
③ The coupled flight needs a longer hover hardening pass at higher gust rates.<br>
④ The sortie chain (takeoff → hover → touchdown as one continuous policy) is designed but not yet trained.
</div>

<h2>Repository Structure</h2>
<div class="code-block">src/lib/pet/        her brain — 30+ modules, 162 tests
src/components/pet/ her body — 3D rig, HUD, the design layer
isaac/              the training ground — profile, URDF, USD, MJCF,
                    RL tasks, PPO configs, 11 ONNX exports
Scripts/            the pipeline — Blender passes, the print exporter,
                    the 24/7 trainer, the debug engine, the defense watch
bridge/             the ground relay — pymavlink ↔ WebSocket
docs/               the dictionary, the specs, the print guide,
                    the hardware fit sheet
Saved/print/        the STLs — 280 mm one-piece, 45 cm in 10 parts,
                    the collar drone</div>

<p style="color:#888;font-size:0.85em;margin-top:32px;border-top:1px solid #ddd;padding-top:12px">
ZOLA — built by one developer. Every number in this document is reproducible from the committed code.
</p>

</body></html>`;

const outPath = path.join(repo, "Saved", "zola-professor-brief.html");
fs.writeFileSync(outPath, html);
console.log(`brief written: ${outPath} (${Math.round(html.length / 1024)} KB)`);
