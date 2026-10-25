# 📋 ZOLA UPGRADE NOTES — provenance log (canonical; the other session owns UPGRADE_NOTES.md)

## 2026-10-18 — V13 HANDOFF PROMPT SAVED (with corrections)
`ZOLA_V13_HANDOFF_PROMPT.md` — the save-and-return master prompt for the post-bench
session (v13.0 Hardware Ascension). Corrections applied before saving:
- The draft cited `neuralPredictor.ts` and `semanticPercept.ts` as existing files —
  NEITHER exists. Documented the real homes: predictor = `safety.ts` setPredictor
  callback + panel wiring; anchoring = `spatialMap.ts` anchor().
- Carried the open heuristic-depth tag item forward as v13 task #1's first step.
- Recorded the full bench-day chain (dry-run corrected) + the two-agent
  coordination protocol, so the next session inherits the seams, not just the code.

## 2026-10-18 — DEEP SYSTEM CHECK — 4 pillars verified against code (not prose)
Independent verification of the pre-bench audit claims. Result: 3 pillars verified,
1 claim FALSE as stated, 1 open gap confirmed.
- **P1 Transport — CORRECTION**: `aura_relay.py` does NOT default to `/dev/serial0`.
  Its --connection default remains `udpin:0.0.0.0:14551` (correct for desktop SITL
  dev). The SERIAL default lives in pi-setup.sh's systemd service
  (ZOLA_CONNECTION=/dev/serial0, ZOLA_BAUD=57600). Consequence: running the relay
  manually on the Pi WITHOUT args gets UDP, not serial — always launch her via the
  systemd service on hardware. MAVLink2 pass-through: no translation layer exists
  (pymavlink handles the protocol) — verified by absence of any codec code.
- **P2 Governor — VERIFIED with the real hierarchy** (file is `safety.ts`, class
  SafetyGovernor — not "governor.ts"): gate() order is KILL SWITCH first →
  CRITICAL battery (forced descent) → LOW battery flag → speed clamp → face
  stand-off → predictive trajectory decel → soft geofence → visual hold
  (altitude lock) → ceiling guard → descent cap. Dream clamps verified in code:
  fence Math.min(2.4, max(0.6, …)), vision window Math.min(4000, max(2000, …)).
  Mission executor sits outside the gate but pauses itself on governor flags and
  aborts on kill — verified.
- **P3 Spatial — GAP CONFIRMED, OPEN ITEM**: spatialMap.ts does NOT tag monocular
  depth as heuristic evidence (grep: zero matches). The ray-marching and sparse
  hash are real, but the log-odds constants treat heuristic depth as if it had a
  known sensor model. OPEN ITEM for spatialMap's owner (other session): add the
  heuristic-depth-evidence tag to the map's output/docs. Not edited here — file
  ownership respected per handoff protocol.
- **P4 Deployment — VERIFIED**: deploy-excludes.txt contains no `*.wav` rule (Piper
  voice pack protected); systemd boots serial-first with arming checks ENABLED
  unless ZOLA_RELAXED=1; pi-dayone.sh checks match the serial transport.
- Server health during audit: :3000 → 200.

## 2026-10-18 — TRIM PASS — deployment manifest, measured refusals
The post-simulation trim proposal was audited against reality before cutting:
- **REFUSED — "remove SimDroneHAL"**: it is hooked (bodyMode sim/real toggle), it
  is the dual-HAL contract's other half, her SITL test rig and training environment.
  Removing it would break the parity contract for a 0-byte saving.
- **DECLINED — "trim the 434 SVG kit"**: measured 1.9 MB total, zero runtime cost.
- **REVIEWED — "25 GB models"**: KEPT (her offline brain is deliberate); documented
  the ~4 GB minimal-brain option (llama3.2:3b + whisper-tiny + kokoro + smolvlm)
  as a human decision for tight SD cards.
- **BUILT — the real footprint lever**: `DEPLOY.md` (manifest: what flies to the
  Pi vs stays home, with measured sizes) + `deploy-excludes.txt` (rsync exclude
  list: Tools/blender 929 MB, assets_src, .next, node_modules, Scripts, docs,
  *.md, logs). Deployable body: ~1.4 GB + the 25 GB model mirror.
- **REMOVED**: ai_voice_test.wav (stray), zola-dev-verify.log, zola-standalone.log,
  zola-server.log (runtime logs, regenerated).
- **Auto-review catch of the day**: my first exclude draft had `*.wav` — which
  would have silently stripped her Piper voice pack from the Pi. The reviewer
  caught it; the rule was removed before it ever ran. The integrity review layer
  works on the operators too.
- next.config.ts verified clean (no debug flags — item 4 needed nothing).
- Server untouched through the trim (page 200 after).

## 2026-10-18 — BENCH-DAY CORRECTION — pi-setup.sh relay service was SITL-wired
Dry-running the day-one bring-up procedure against the actual installer exposed a
two-part trap that would have failed bench day silently:
1. `zola-relay.service` hardcoded `--connection 'udpin:0.0.0.0:14551'` — a UDP
   listen address a physical UART-connected ArduPilot can NEVER reach. The setup
   text even claimed the relay "finds it automatically" (false for hardware).
2. The service launched with `--relaxed-arming` — which the relay's own help
   marks "SITL only — never on hardware". Boot-time arming-check bypass on a
   real drone = safety failure.
FIXED in pi-setup.sh (bash syntax verified over the whole file):
- `ZOLA_CONNECTION` (default **/dev/serial0** — the bench UART) and `ZOLA_BAUD`
  (default **57600** — ArduPilot TELEM standard) configure the systemd service;
  USB (`/dev/ttyACM0`) and SITL (`udpin:...` + `ZOLA_RELAXED=1`) documented inline.
- `--relaxed-arming` now ONLY applied when explicitly requested for SITL —
  hardware boots with arming checks ENABLED by default.
- Final setup banner now prints the wired connection/baud and the required FC
  side params (SERIAL2_PROTOCOL=2, SERIAL2_BAUD=57) + pi-dayone.sh verification.
- CRLF line endings in the file required a tail-splice fix; `bash -n` clean.
This closes the loop with the day-one procedure: power harness → UART cross-wiring
→ FC params (SERIAL2_PROTOCOL=2 / SERIAL2_BAUD=57) → pi-setup.sh (serial-default)
→ pi-dayone.sh 11 checks → first tethered flight.

## 2026-10-18 — WAVE 12 — dream-state replay & bounded auto-tuning (this session)
New `src/lib/pet/dreamEngine.ts` — she dreams over her own flight telemetry at the
nightly cycle (runs with the wrap-up, after buildNightlyNode):
- **Event census × environment**: safety flags correlated with hour-of-day AND
  light phase (via her sun model) — correlations stated only when the census
  supports them (≥3 occurrences).
- **Bounded arithmetic auto-tuning** (the blueprint's "safety bias weighting",
  honest edition — ARITHMETIC, never prose): geofence breach → fence radius +0.15 m;
  3+ soft approaches → +0.10 m; 3+ visual holds → vision-confidence window −500 ms.
  HARD CLAMPS added to the governor (`setLimits`): fence 0.6–2.4 m, vision window
  2000–4000 ms — tuning shifts margins but can never disable a safety. Persisted in
  memory.dreamTuning, restored on boot.
- **safety.ts gained `setLimits`/`currentLimits`** + a tunable `visionStaleLimit`
  (was hardcoded 4000 ms). Applied against a fresh read — coexists cleanly with the
  other session's WAVE 11 predictor additions, which were edited concurrently.
- **ASCII trajectory dream-map**: density heat-map of recorded px×py, logged at the
  cycle. Occupied-voxel overlay DEFERRED — spatialMap.ts is the other session's
  claimed file and exposes no voxel-list accessor; flagged, not touched.
- **Integrity contract**: LLM (if online) contributes reflective PROSE only (logged
  as "dream prose"); the tuning numbers are pure census arithmetic. Thin evidence
  (<60 samples) → INSUFFICIENT DATA and nothing changes.
- Build green; server restarted; page 200.

## 2026-10-18 — WAVE 10 — autonomous mission scripting (waypoints + orbit-POI)
New `src/lib/pet/missions.ts` — a deterministic waypoint + orbit-POI state machine:
- **Waypoint queueing**: HUD mission-planner card (X/Y/Z + hold-ms inputs, ADD,
  per-waypoint remove, START). Executor drives her flight vectors step-by-step:
  P-controller toward each waypoint (≤0.35 m/s — calmer than her reactive cap),
  arrival tolerance 0.12 m against ACTUAL pose (no dead-reckoning — if she can't
  confirm arrival, she holds), hold phase, then next; "mission complete" spoken.
- **Orbit-POI**: circles a point at standoff radius (default: home @ 0.8 m, 2 laps)
  with the camera YAW LOCKED on the POI the whole flight — pure circular kinematics
  (0.25 m/s tangential, lap budget tracked in radians).
- **Override handoff (the architecture contract)**: the executor PROPOSES; the
  SafetyGovernor DISPOSES. Mission actuation passes through the same gate() as her
  brain — soft geofence, visual hold, battery failsafes physically override missions,
  never the reverse. Safety flags PAUSE the mission (holding pattern — a zero-motion
  hover that lets the governor's safe-return vectors act unmolested); clean sky
  resumes it; kill switch aborts it outright.
- **Voice override**: "abort mission" / "cancel mission" releases control instantly.
- Mood/LED stay hers during missions — the state machine flies, the personality
  stays on.
- Known sim-honesty note: sim positioning is exact, so drift-pause triggers only
  via safety flags; real-VIO drift thresholds become meaningful with real
  positioning — the tolerance check is already pose-actual, ready for it.
- Build green first pass; server restarted; page 200.

## 2026-10-18 — WAVE 11 — spatial cybernetics: occupancy, foresight, touch
Integrity audit of the 4-module blueprint, then the honest build:
1. **3D Spatial Occupancy Map** (`src/lib/pet/spatialMap.ts`, new): sparse voxel
   hash at 0.1 m resolution with probabilistic log-odds updates (hit +0.85,
   pass-through −0.35, clamped ±4, occupied when P>0.65). INTEGRITY GUARDRAIL
   KEPT: voxels update ONLY along true camera sightlines — the ray from her pose
   through a detection's bbox center, out to the distance her own monocular
   size-model resolved. Unobserved space is UNKNOWN, never free. Her old flat
   projection ignored bbox x-offset; sightlines now steer within her ~60° FOV —
   item positions got MORE honest as a side effect.
2. **Semantic 3D anchors** (same module): certain detections bind label → last
   confirmed 3D position; queryable via getAnchor(). Her memory items already
   carried world position — the anchors add the occupancy context around them.
3. **Predictive Trajectory Governor** (`types.ts` + `safety.ts` + panel): her
   MEASURED velocity (pose deltas over the real frame interval — the derivative
   of where she actually was, no model) is extrapolated 1.5 s ahead. Predicted
   geofence breach → 60% outward-motion decel BEFORE the soft fence reacts;
   predicted occupied voxel (probe at horizon + midpoint) → 50–75% hard decel.
   Governor stays map-agnostic via a setPredictor() callback wired to the map.
4. **Cybernetic Haptic Link** (`src/lib/pet/haptics.ts`, new): telemetry-driven
   tactile profiles over the Web Gamepad vibrationActuator — cruise rumble scaled
   by live prop RPM, rhythmic fence-proximity pulses that speed up as distance
   falls, triple distress pulse on visual-hold/critical. HONESTY CONTRACT: fires
   ONLY through a physically connected gamepad; no controller → dormant, logged
   as such — simulated touch is not touch.
- **NOT built (integrity):** EKF-uncertainty variance (no EKF in sim — the
  blueprint's own zero-fake-metrics rule excludes it); LiDAR-grade ranging (she
  has monocular size-model rays only — labeled as such inside the module).
- Build green first pass; server restarted; page 200.

## 2026-10-18 — WAVE 9 — interactive flight replay scrubber
New `src/components/pet/FlightReplay.tsx` — a scrubber card under her gesture stage:
- **Timeline slider + play/pause** (8 samples/sec playback = 4× speed review of her
  2 Hz ring), stepping through EXACT recorded samples. The guardrail from the
  proposal is the design: zero interpolation, zero synthetic frames — the artificial
  horizon, traces, and readouts render only what the ring actually holds.
- **Traces**: battery (amber, top) and altitude (cyan, middle) across the full window;
  **event pins** color-coded by real governor flags (teal governor, amber geofence,
  purple visual-hold, red critical) at the exact sample where they occurred.
- **Attitude dial**: artificial horizon driven by the selected sample's recorded
  pitch/roll — scrub backwards through a gust and watch her lean again, exactly
  as recorded.
- Readouts: timestamp, activity, mood, battery, altitude, pitch/roll, flags.
- The card auto-hides until the ring holds samples. Refreshes from the live ring
  every 5 s (recording continues while you scrub history).
- Battery is honestly a fraction trace in sim (linear sim battery — labeled by
  context); real voltage-based sag pins arrive with MAVLink BATTERY_STATUS.
- Build green first pass; server restarted on :3000; page 200.

## 2026-10-18 — WAVE 8 — autonomous post-flight diagnostics (honest-signal edition)
New module `src/lib/pet/diagnostics.ts` — deterministic analysis over the black-box
ring the moment she lands or docks after real flight time. Integrity audit applied
to the proposal first:
- **BUILT — attitude stability** (σ of max(|pitch|,|roll|) across hover/follow
  samples — the vibration/imbalance early-warning; black-box entries now record
  attitude in degrees each sample).
- **BUILT — altitude hold quality** (alt σ during hover).
- **BUILT — loop regularity** (jitter % of black-box sample timing — real pipeline
  health; serial-layer jitter STAGED, needs relay heartbeat timing — labeled, not
  faked).
- **BUILT — voltage sag section reports DORMANT honestly** (sim battery is linear;
  activates when MAVLink BATTERY_STATUS streams — no invented numbers).
- **BUILT — safety-event census** (geofence/hold/critical events counted from
  recorded governor flags).
- **HONEST THRESHOLDS**: attitude σ ≤ 2°, altitude σ ≤ 0.05 m, jitter ≤ 25% —
  labeled in the output as SIM-TUNED, recalibrate on the real airframe before
  bench judgment.
- **Behavior**: fires automatically on the airborne→dock/sleep transition; speaks
  a one-line verdict ("Flight check complete: nominal…"), logs the full run, and
  the VLOG export now renders a "Post-flight diagnostics" section with the verdict
  header and every check. Verdicts: NOMINAL / REVIEW / INSUFFICIENT DATA (ring
  under 40 samples refuses to analyze rather than pretending).
- Build green first pass; server restarted; page 200.

## 2026-10-18 — WAVE 7 — physical-precursor autonomy: geofence, vision hold, LiPo profiler
Integrity audit first: of the 4 proposed modules, #2 (acoustic landing beacon via
pulse-echo resonance) was DEFERRED — echo-based surface classification needs a known
transducer pair + calibrated mic array; faking it from a laptop mic would be fake
telemetry. Honest substitute noted for later: optical descent assessment via her
camera. Built the three that pass the integrity bar:
1. **Soft Geofence & Safe Return** (`safety.ts`): horizontal cylinder around home
   (geofenceRadius, default 1.2, 0=off). At 85% radius: outward velocity component
   proportionally canceled + inward return vector (gentle inside, firm 0.3 past
   breach). Flags: "SOFT GEOFENCE · NN%" / "GEOFENCE BREACH — RETURNING HOME".
   Pure vector math — works identically in sim and under MAVLink.
2. **Visual-Confidence Safeguard** (`types.ts` + `safety.ts` + panel): percept gains
   visionStaleMs (ms since ANY detection); if her feed is expected live but silent
   for 4 s (lighting drop/feature loss), the governor degrades to inertial hold —
   velocities ×0.25, ALTITUDE LOCKED — until detections resume. One alert chirp +
   flash per episode; freshness clock fed by onDetections/onTrack callbacks.
3. **LiPo Discharge Curve Profiler** (`src/lib/pet/battery.ts`, new): piecewise
   published LiPo per-cell curve (3.0–4.2 V → 0–100%), sag-aware resting-voltage
   correction (0.1–0.2 V/cell under load — measured constants, not invented), and a
   FlightTimeEstimator that learns HER OWN drain rate (%/min over a 5-min window)
   and predicts remaining air minutes. Honest activation: samples ONLY from real
   MAVLink telemetry (sim battery is linear → profiler stays dormant, panel shows
   "SIM" rather than pretending). New EST AIR stat joins CELL HEALTH/CYCLES row.
- **Port incident, resolved:** her package.json scripts were found changed to -p 3001
  (other session). Port 3000 was free and is hers by every doc + pi-dayone.sh →
  reverted dev/start to 3000; server verified back on :3000. Noted here so both
  sessions know.
- Build green (one shorthand-property type error caught pre-compile); page 200.
- **RELAY IS SERIAL-READY FOR BENCH DAY** (`bridge/aura_relay.py`): `--baud` argument
  added (default 57600 — the ArduPilot TELEM standard; 921600 for fast links).
  Device-path connections (`/dev/ttyAMA0`, `/dev/serial0`, `COM*`) get the baud
  passed to pymavlink; tcp/udp strings untouched (SITL path byte-identical).
  Syntax verified in her WSL venv environment. Bench invocation will be:
  `python aura_relay.py --connection /dev/serial0 --baud 57600` (or the TELEM2 UART
  the wiring tutorial's serial link lands on). Run the linked Pi↔ArduPilot serial
  walkthrough BEFORE first power-up: pinout (TX↔RX crossed), 3.3 V logic on both
  sides, and common ground — the three things that brick boards when rushed.

## 2026-10-18 — WAVE 6.6 — refinement deltas on the circadian + archive design
The user's refined architecture for the two Wave-6 integration points arrived after
Wave 6 shipped. Delta audit → three genuine additions built:
1. **Circadian envelopes** (`suncalc.ts` + `sound.ts`): beyond pitch, chirp attack
   and release now shape by phase — crisp mornings (0.7× attack / 0.8× release),
   neutral midday, round evenings (1.5×/1.6×), velvet nights (1.8×/2.0×). Morning
   chirps snap; night chirps bloom.
2. **Nightly node archive** (`memory.ts`): `buildNightlyNode()` — one idempotent
   structured snapshot per day (commands/items/people/lifetime-flight-seconds/insight),
   capped at 90 nights. Fired BOTH at the daily wrap-up (17–19h) and on entering
   sleep. Pure addition — zero overlap with the volume-based compression worker.
3. **Vlog compiler feeds from the archive** (`vlog.ts`): a "Nightly archive node"
   section now renders the day's archived node + archive depth; flight seconds stored
   cumulative so consecutive nodes diff into true daily flight time. The vlog is no
   longer only a live snapshot — the archive makes per-day vlogs possible forever.
- Two small structural slips caught during the write (interface brace, object
  literal close) — fixed before compile. Build green; server restarted; page 200.

## 2026-10-18 — WAVE 6 — circadian voice, episodic compression, daily wrap-up
1. **Circadian Vocal & Tone Adaptability** (`suncalc.ts` + `sound.ts` + panel): the
   sun model now speaks. `circadianVoice()` returns rate+pitch per light phase
   (morning-bright 1.05×/1.08× → neutral → evening-soft → night-quiet 0.92×/0.88×).
   Her procedural micro-chirps scale their base frequencies by the circadian pitch
   (higher in the morning, softer/lower at night); her Kokoro delivery rate =
   USER SLIDER (master) × circadian factor, re-tuned twice an hour as light shifts.
   Pure clock math — Pi-safe, no network.
2. **Episodic Memory Compression Worker** (`memory.ts` + 5-min worker): when her
   60-turn conversation ring fills past 40, the OLDEST half condenses into one dense
   semantic summary (period, first ask, top-3 recurring keywords from your side) kept
   forever in `episodeSummaries` (cap 60); the raw turns are freed. Her context
   windows stay lean; the gist of every era survives. Runs in the 5-min housekeeping
   interval; logged when it fires.
3. **Daily Wrap-Up Offer** (panel): once per day, 17:00–19:00, focus-gated:
   "The day is winding down. Say 'show me my day' for the headline — or press VLOG
   for my full story." Ties her learned-rhythm systems to the vlog compiler; never
   nags twice in a day.
- One build error caught and fixed: episodeSummaries initially landed in the
  KnownItem interface instead of MemoryData (type system caught it immediately).
- Build green; server restarted; page 200.

## 2026-10-18 — WAVE 5.5 — blueprint deltas: trait vector + bidirectional relations
The user's Wave-5 architecture blueprint arrived AFTER Wave 5 shipped. Audited against
what's live: two of its designs were genuinely deeper than the shipped versions, one
was honestly not implementable. Built the two real deltas:
1. **PersonaVector trait engine** (`persona.ts`): continuous traits — warmth 0.6,
   sarcasm 0.25, energy 0.5, focus 0.5 baselines — NUDGED by real events (praise:
   warmth +0.05 / sarcasm −0.03; rudeness: sarcasm +0.08 / warmth −0.06; apology:
   warmth +0.04) with 8%/hour exponential decay toward baseline. NOT decorative:
   energy gates her chatter cadence (high-energy → 30 s idle gap, drained → 120 s)
   and terseness (energy < 0.3 → short replies even to chatty humans). Panel shows
   four live trait bars (W·S·E·F) beside her persona chip.
2. **Bidirectional stacking relations** (`memory.ts`): noteStacking now types the
   relation BOTH ways — the lower item learns "under X", the upper learns what it
   carries (topNote). Human-readable relation notes, not a fake spatial graph —
   real 3D hierarchies need the depth hardware gives her.
3. **NOT built (with reason):** CuriosityHypothesis.confidence "derived from local
   model entropy" — there is no real entropy signal available at this depth of the
   stack; shipping fake confidence numbers would be dishonest telemetry.
- Build green first pass; server restarted; page 200.

## 2026-10-18 — WAVE 5 OF THE FEATURE MATRIX — the remaining buildable five
With this wave, every software-buildable item from the 5-matrix brainstorm is live.
1. **Counterfactual Curiosity** (`brain.ts` + panel): first visible object with no
   memory record feeds her proactive channel; once per ~10 min she asks ONE targeted
   hypothesis question. LLM online → it writes the hypothesis (new freeform prompt);
   offline → her trained line stands. Rate-limited, focus-gated (she never interrupts
   a working human to be curious).
2. **Auto-Evolving Persona Ladder** (`brain.ts getPersona`): the day now bends the
   baseline — work hours (9-17) blend SWEET/HYPER into EXPLORER (co-pilot cadence);
   late night (22-6) softens into DREAMING. Strong states (roast/sulk/alarmed) win.
3. **Semantic Object Stacking** (`memory.ts` + scan pipeline): when two certain
   detections overlap horizontally and one's bbox bottom rests on the other's top,
   she records a relation note ("under the mug") on the lower item — optional field,
   so old memory files load unchanged.
4. **LED / Theme Sync** (panel): LED_FOR_PERSONA map drives a live LED chip in the
   tab bar + an ambient glow on the panel that breathes with her persona — dimmed
   at night via the sun model. The same color will drive the real drone's LED ring
   (documented in the chip tooltip).
5. **Shadow-Play Orbit Drift** (`hardware.ts`, imports her pure-date sun model —
   Pi-safe): golden hour drifts her idle orbit +0.06 toward the light side, dawn/
   dusk +0.03, high sun steadies the orbit to 75%, night parks her centered.
- Build green first pass (one brace miscount in the scan callback caught and fixed
  before compile); server restarted; page 200.
- **MATRIX COMPLETE**: 19 features shipped across 5 waves. Remaining items are
  hardware-gated by design.

## 2026-10-18 — UI RECOLOR — the software board is now fully closed
- **Inkscape pass replaced with a deterministic script** (`Scripts/recolor_ui.mjs`, node,
  zero deps): a flat recolor is a palette remap on fill/stroke — no 300 MB install,
  no UAC, reproducible, auditable.
- Source: `GameDevLibrary/Assets/UI/kenney_ui-pack/Vector/` (434 SVGs, CC0) →
  destination `public/assets/ui/zola-svg/` (library untouched; copy-out respected).
- **1,488 color edits across 434 files, ZERO unmapped colors.** Full role-preserving
  remap: blue family → her cyan (#5ac8fa ramp), green → teal primary (#35d0a5 ramp),
  red → alarm family (#ff4d4f ramp), yellow → amber (#f0b90b ramp), greys → her UI
  greys, pure white → warm white (#e9e7dc), pure black → her background (#0b0e17).
  Verified: output histogram contains only Zola palette colors.
- **Visible wiring:** composed favicon `src/app/icon.svg` — teal round button +
  up-arrow (she's a flier), built from the recolored vectors; served at /icon.svg.
- The full recolored kit (434 shapes) is ready for the Pi HUD / future UI surfaces.

## 2026-10-18 — WAVE 4 OF THE FEATURE MATRIX — micro-vlog + voice attribution
1. **Micro-Vlog Compiler** (`src/lib/pet/vlog.ts`, new module): compiles her recent life
   into a local markdown vlog — day-in-one-line, mood arc bar chart (from black-box
   ring), flight logbook + battery health, memory growth (people w/ voice counts,
   items, facts), reinforcement-trained favorite topic, last dream + consolidated
   night insight, recent diary. VLOG ↓ button exports zola-vlog-<date>.md — built
   from her own data, saved locally only.
2. **"Show me my day"** — spoken 10-second headline version of the vlog
   (`spokenDaySummary`), routed before the reflex brain in the command path.
3. **Voice Attribution Lite** (diarization step 1, software-honest): a detected VOICE
   event while her face lock is held on a known person attributes the voice to them
   (30 s rate-limit, temporal correlation — no embeddings needed). New `voiceBabble`
   counter in PersonBehavior (old records ??-guarded), surfaced in her spoken
   behavior summaries ("I have heard your voice near me N times") and in the vlog.
- Build green (2 type-fix passes: noteBehavior union widened to include "voice",
  blackbox moodArc cleaned); server restarted; page 200.
- **Hardware-gated (not built, correctly):** true speaker diarization (needs mic
  array/embeddings on the Pi body), swarm sync (needs multi-dock hardware).

## 2026-10-18 — WAVE 3 OF THE FEATURE MATRIX — storytelling, health, self-healing, room sense
1. **Procedural Storytelling** (`src/lib/pet/storyteller.ts`, new parity-safe module):
   "tell me a story" / "continue" / "the end" — ongoing stories where HER REAL ROOM is the
   game board (places from her mental map zones, items from her memory, named people).
   Online: local Ollama writes beats (new `LlmConsultant.complete()` freeform path).
   Offline: procedural weaver — 5 grounded templates × 5 hooks, never repeating a
   template twice, hooks every other beat. Beats logged; no cloud ever.
2. **Battery Health Profiler** (`memory.ts` + panel stats): real charge-cycle counting
   (discharge→charge transitions) + deep-discharge crossings (single-counted via a
   crossing detector). `batteryHealth()` = honest local model: 100 − 0.4×cycles −
   2×deepDischarges, floor 60, with advice thresholds (60/150 cycles, deep-discharge
   warning). Panel now shows CELL HEALTH / CYCLES / FLIGHT HRS / SUN in a new stats row.
3. **Self-Healing State Recovery** (panel): window error/unhandledrejection containment
   with graded logging (1st + every 25th), and camera-eye auto-revive (max 2 attempts,
   2 s backoff) when runtime errors cluster while her eye is live. Task-runner steps
   already self-terminate via duration guards — documented, not duplicated.
4. **Room Ecology Lite** (`src/lib/pet/suncalc.ts` + memory): LOCAL seasonal sun model
   (month-based sunrise/sunset tables, no location service, no network) — phases
   night/dawn/morning/midday/golden/dusk drive a SUN stat chip + golden-hour
   appreciation ("The light is golden right now.") at most once per hour, suppressed
   when the human is focused. Acoustic rhythm: sound-watcher levels feed per-hour
   noise-floor learning (memory.noteNoise, batched saves) + roomRhythm() summarizer.
- Build green first pass; server restarted; page 200; integrity OK (16/16).
- Remaining matrix: multi-speaker diarization, thermal mapping (needs hardware),
  micro-vlog compiler, swarm sync (multi-dock).

## 2026-10-18 — WAVE 2 OF THE FEATURE MATRIX — 4 systems wired into her brain
1. **Dream Consolidation on Dock** (`memory.ts` + `brain.ts`): when she goes to sleep
   ("go to sleep"/"goodnight"), `consolidateNight()` compresses the day into a lasting
   insight from her REAL trained data — top reinforcement-weighted chatter topic, new
   items/people counts, flight logbook seconds — stored in a new `dreamJournal`
   (30-night cap) in persistent memory. On wake, `takeNightInsight()` (consumed-once)
   is spoken alongside her grumpy wake line. Survives old memory files via ??-guards.
2. **Theory-of-Mood Interrupt Gating** (`brain.ts` + panel): typing cadence detection
   (3+ keystrokes → 90 s focus window, refreshed while typing). While focused, her
   `proactiveTick` returns null — NO unprompted chatter. Safety row shows
   "HUMAN FOCUSED · HOLDING CHATTER" live. Quiet mode still works as before; this
   makes silence automatic instead of command-gated.
3. **Telemetry Black-Box** (`src/lib/pet/blackbox.ts`, new parity-safe module):
   ring buffer (2,400 samples ≈ 20 min @ 2 Hz) of mood/activity/battery/alt/yaw/position
   + safety flags, sampled in the panel's main loop; `note()` can annotate events.
   BLACKBOX ↓ button exports a local JSON flight report (never uploaded). HAL-agnostic
   — same recording for SimDroneHAL and the MAVLink bridge.
4. **Micro-Chirp Expansion** (`sound.ts`): new `express(emotion)` — randomized
   procedural motifs per emotion (happy rising blips ±15% pitch, excited 4-6-note
   trills, curious question-shaped rise-fall, sleepy long downward yawn, sad falling
   pairs, alarmed square-wave double-blip, idle gentle single). `chirpForMood` now
   routes sleepy/sleeping/idle through it — her non-verbal voice never repeats exactly.
- Build green first pass; server restarted; page 200; integrity auditor still OK (16/16).
- Remaining matrix waves: thermal/sun/acoustic room ecology, storytelling, diarization,
  battery health profiler, self-healing state recovery, micro-vlog compiler.

## 2026-10-18 — WAVE 1 OF THE FEATURE MATRIX — 4 features built + verified
From the 5-matrix expansion brainstorm, Wave 1 (highest impact, software-only):
1. **Reactive Gesture Improv** (GestureStage v2): "do a trick" now plays a random
   CHAIN of 2-3 gestures back-to-back (LoopOnce + mixer 'finished' event sequencing),
   instead of one loop. Mood triggers stay targeted. Panel PACE button + auto pacing
   cue her stretch_01 (+peekaboo) — she demonstrates, you join.
2. **Air-Gap Integrity Auditor** (`src/app/api/zola/integrity/route.ts`):
   SHA-256 of 16 trust-critical local files (kokoro bundle, both ORT runtimes,
   mediapipe wasm + tasks, kokoro/whisper configs + onnx + voice bin) vs a stored
   baseline (`.zola-integrity.json`, auto-created on first run). Verdicts
   BASELINE_CREATED / OK / DRIFT; panel chip in the safety row (AIR-GAP VERIFIED /
   INTEGRITY DRIFT), auto-checks on load + every 10 min, logs drift with file names.
   Verified live: baseline created, second pass = OK (16/16).
3. **Procedural Ambient Music** (`src/lib/pet/ambient.ts`, new module — parity-safe,
   pure Web Audio): generative non-repeating pentatonic blooms over a detuned
   sine pad with delay-feedback space; per-mood profiles (bright/warm/dark scales,
   root, tempo, filter, gain) — sleeping gets 7-13 s swells, excited gets 0.9-2.2 s
   bright blooms. MUSIC toggle in the senses controls; retunes softly on mood change;
   always quiet (companion rule).
4. **Energy Pacing + Stretch Companion** (panel): tracks continuous presence,
   first cue after 45 min then every 20 — a spoken line ("Stretch with me — I will
   show you how") + she performs the stretch gesture. No nagging: silent otherwise.
- Build green; server restarted; page 200; integrity API verified.
- Wave 2 candidates (not yet built): theory-of-mood interrupt gating, dream
  consolidation on dock, chirp expansion, telemetry black-box ring buffer,
  battery health profiler.

## 2026-10-18 — REPERTOIRE EXPANDED — 19 gestures, brain-bridge auto-play live
- +15 curated takes appended to `Scripts/gestures_core.txt` (all existence-verified first):
  dance_01 (111_05 Dance) · dance_02 (113_04) · shrug_01 (111_25 Shrug) · mope_01 (111_14 Mope) ·
  peekaboo_01 (111_16 Peekaboo) · curtsey_01 (111_04 Curtsey) · bow_02 (113_02) · wave_02 (113_27) ·
  pickup_01 (111_17 Pick up) · throw_01 (111_33 Throwing) · laydown_01 (111_12 Lay down) ·
  getup_01 (111_06 Get up from floor) · rollover_01 (111_21 Roll over) · crawl_01 (111_03 Crawling) ·
  march_01 (111_13 March).
- Batch run: 19/19 exported clean (22 bones mapped each), render checks reviewed — mope's slump,
  throw's cocked arm, dance's lean all read naturally.
- **Brain bridge** (`GestureStage.tsx`): the stage now auto-performs on her inner state —
  excited → dance/throw/rollover (random), sleepy → mope, sleeping → laydown,
  search activity → shrug/crawl, trick → cycles the full repertoire. Panel passes `mood` + `activity`.
- Build green; server restarted; gesture API returns all 19; total 299 MB on-disk
  (load-on-demand from her own server — only played gestures download).

## 2026-10-18 — GESTURE PIPELINE LIVE — Blender installed, core 4 gestures done + wired
- **Blender 5.2.2 LTS** (portable zip, no account) → `Tools/blender/blender-5.2.2-windows-x64/`
  (from download.blender.org/release/Blender5.2/ — GPL tool, nothing shipped to her runtime).
- **Gesture sources picked from the CMU index by DESCRIPTION, not folklore**: subject 09 turned
  out to be RUNNING; subject 111 is the emotion catalog. Core four:
  wave_01 ← 111_37 (Wave) · bow_01 ← 111_02 (Bow) · spin_01 ← 111_20 (Ring around the rosie) ·
  stretch_01 ← 111_32 (Stretch and yawn).
- **Rig**: Quaternius Universal base character (Superhero_Female glTF) copied read-only-source →
  `assets_src/rig/`. Real bone names parsed from the glTF skin (UE-style: pelvis/spine_01/…/
  clavicle_l/upperarm_l/thigh_l/calf_l) — BONE_MAP rewritten from guesses to verified mapping (22 bones).
- **`Scripts/retarget_bvh.py` rewritten** after 3 hard bugs were found and killed:
  (1) nla.bake silently baked nothing under Blender 5 (bones unselected + API changes) → replaced
  with deterministic per-frame world-space delta retarget (rest-offset aligned, parents-first);
  (2) orphaned BVH action made the glTF exporter emit flat rest-pose anims → source action now
  deleted before export; (3) drive-letter colon broke the gesture-list parser → rpartition.
- Verification: per-gesture **Blender render checks** (_check_*.png) visually reviewed —
  natural wave / bow / spin / stretch poses, no contortion; GLBs parsed programmatically —
  each has a 195-channel 30 fps animation with varying keys.
- **Consumers built** (the recipe's "web lists them" needed real code):
  `src/app/api/zola/gestures/route.ts` (local fs listing) + `src/components/pet/GestureStage.tsx`
  (on-demand R3F stage; caches GLBs; auto-cycles a gesture whenever her brain enters trick).
  Wired into DronePetPanel (senses tab, after the flight body card).
- Deps added: three@0.186.1, @react-three/fiber@9.8.2, @types/three@0.186.0 (bundled locally —
  no runtime CDN, air-gap intact).
- Build green; server restarted; 6/6 endpoints 200 (page, gesture API, 4 GLBs).
- Docs: BLENDER_RETARGET_RECIPE.md updated with STATUS + 5 locked-in lessons.
- Library untouched (read-only respected).

## 2026-10-18 — AIR-GAP COMPLETE — verified offline, build green, server restarted
- **Two hidden phone-home leaks found and killed** (deeper than the handoff's CDN import fix):
  1. kokoro.web.js's browser branch fetches voice .bin files from
     `huggingface.co/.../Kokoro-82M-v1.0-ONNX/resolve/main/voices/` UNCONDITIONALLY
     (it ignores the local model path for voices). PATCHED in
     `public/vendor/kokoro.web.js` → `/models/kokoro-82m/voices/`.
  2. onnxruntime-web's `wasmPaths` defaults to `cdn.jsdelivr.net/npm/@huggingface/transformers@
     <ver>/dist/` whenever unset — the ~20 MB ORT wasm would stream from the CDN.
     PATCHED (same bundle) → `/vendor/ort-kokoro/`.
- The npm `@huggingface/transformers` 4.3.1 (her ears=whisper + eyes=smolvlm) carries
  the SAME jsdelivr fallback → pinned via code in `earsLocal.ts` + `eyesDeep.ts`:
  `env.backends.onnx.wasm.wasmPaths = "/vendor/ort/"` set right after each import,
  BEFORE any model load.
- ORT wasm files staged locally, version-matched per consumer (ABIs are NOT interchangeable):
  - `public/vendor/ort/` ← onnxruntime-web 1.31.0-dev (8 files) — matches npm transformers 4.3.1
  - `public/vendor/ort-kokoro/` ← kokoro-js 1.2.1's own nested onnxruntime-web (jsep pair) —
    matches the ort 1.21-line runtime embedded in kokoro.web.js (verified: the vendor bundle
    is byte-identical in size to node_modules/kokoro-js/dist/kokoro.web.js, so its nested
    dist files are the canonical companions)
- **Verified NO remote fallback is possible**: decoded the bundle's loader — for path-style
  model ids (`/models/...`, which all three senses use) the hub-id regex
  `/^(\b[\w\-.]+\b\/)?\b[\w\-.]{1,96}\b$/` fails, so files are fetched from page origin ONLY;
  a missing local file throws locally, it can never reach huggingface.co.
- Voice path resolution verified sound: `from_pretrained("/models/kokoro-82m")` →
  `/models/kokoro-82m/config.json` etc. served from our own server (q8 → onnx/model_quantized.onnx ✓).
- Cleaned misleading strings: "downloading from the internet" → "loading from local files"
  (voiceKokoro.ts, eyesDeep.ts).
- **Build verified twice** (`npm run build` green), server restarted on port 3000 (PID fresh),
  and 13/13 endpoints return 200: app, /zola, kokoro.web.js, both ort dirs (.mjs+.wasm),
  kokoro config/tokenizer/onnx/voices, whisper config, mediapipe tasks, mediapipe wasm.
- Sources: node_modules (kokoro-js 1.2.1 + its nested onnxruntime-web; onnxruntime-web 1.31.0-dev).
  No library material touched. Zero network calls required at runtime — air-gap closed.

## 2026-10-18 — Retarget recipe + day-one check (from the verified scoreboard handoff)
- `docs/BLENDER_RETARGET_RECIPE.md` — full BVH→rig→GLB recipe + `Scripts/retarget_bvh.py`
  (batch Blender automation: import CMU BVH → BONE_MAP to the Quaternius rig →
  copy-rotation constraints → NLA bake → GLB export, named gesture_XX).
- `pi-dayone.sh` — post-install acceptance: 11 checks covering app serving,
  voice pack, offline AI models, ollama GGUFs, relay/app systemd, FC link,
  and piper availability. Run on the Pi after first boot; fixes = re-run.

## 2026-10-18 — MASTER COMMAND ORDER (Slices 1-8 executed)
- **Phase 0** ✓ library refresh launched; AI-mirror verified (116 files/25 GB intact).
- **Phase 1 — Voice** ✓ 46 Piper lines generated (3 variants × 16 core states,
  en_US-amy-medium) → `public/sfx/zola/voice/v1..v3/`. Exact brain strings used,
  so PiperPack auto-matches every state. Deviations from the master order noted:
  generate_voice.ps1 has no -Lines array param (used -LinesFile/direct piper),
  voice key is `amy` not `en_US-amy-medium`, ffmpeg absent → WAVs ship as-is (browsers play WAV).
- **Phase 2 — Sounds** ✓ kenney rpg/sci-fi (124 oggs) → moods bank; interface+ui (151) →
  ui bank; Dog Vocalisations (2 files — the bundle only ships 2) → animal;
  Strong Wind Gusts (Arctic) → flight; OGA_Combat_Ambience (9) → alert.
- **Phase 3 — UI/fonts** ✓ Rajdhani/Cairo/BlackOpsOne/Oswald → public/fonts;
  kenney_game-icons + input-prompts + rpg-expansion copied. Inkscape recolor SKIPPED
  (Inkscape not installed — START_HERE url available for install).
- **Phase 4 — Graphics** ✓ space/car/prototype kits → concepts; furniture/food kits → room;
  quaternius_nature-150 → nature; animated animals (Cow/Horse/Llama/Pig/Sheep/Zebra FBX)
  → animals; PBR Ground037/Rock026/Metal016/Wood056 @2K → textures; 4 mood HDRIs @2K → hdri.
- **Phase 5 — FX** ✓ kenney_particle-pack + kenney_crosshair-pack copied.
- **Phase 6 — Motion** ✓ 85 gesture candidates indexed (subjects 001/009/016)
  → docs/BVH_GESTURE_CANDIDATES.txt. Blender retargeting deferred (Blender install
  absent from library after the off-scope purge — re-download from blender.org).
- **Phase 7 — Offline brain** ✓ mirrors staged into `public/models/`
  (whisper-tiny-en 42M, kokoro-82m 116M, smolvlm-256m 184M, ollama 24G) +
  earsLocal/eyesDeep patched to load the LOCAL mirror first (HF fallback).
  PiperPack plays pre-rendered lines offline.
- **Phase 8 — Wiring** ✓ sfxFiles.ts NEW (file-based mood feedback with cooldowns
  + synth fallback); mood changes now play real library samples.
- **Verification** ✓ npm run build green ×2 · standalone serving 200 on :3010
  · local model URLs 200 · training flight flown post-separation (98% hover).

## 2026-10-18 — SEPARATION + Pi-readiness
- ZOLA extracted from the Aetheria app → standalone app at
  `C:\Users\self_\ZOLA-standalone\` (port 3010; parity contract verified:
  her src/lib/pet/ is byte-fresh from the embedded copy, zero sim deps).
- Aetheria purged: pet modules/panel/route/page + dock/store/page.tsx edits
  reverted. Aetheria builds and runs clean without her.
- **Piper voice pack GENERATED** (34 lines, en_US-amy-medium — her real Pi
  voice): `public/voices/piper/*.wav` + `manifest.json`. PiperPack plays
  exact-match lines offline; dynamic lines fall back to Kokoro.
- pi-setup.sh: Piper engine + voice provisioning added (library mirror or
  HF download). Relay connection string documented (tcp:127.0.0.1:5760
  proven; udpin for ArduPilot SITL).
- Acceptance: post-separation training flight — Hover hold 98% (σ 0.009m),
  square flown, landing clean. Battery telemetry real (68% after session).

Format: [date] slice — action — library source → destination.

## 2026-10-18 — Slice 1 (audit) + investigation
- Audited: DRONE_PET.md, PARTS_LIST.md, SITL_GUIDE.md, src/lib/pet/* (live), GameDevLibrary paths.
- **Investigated the "missing 30 GB"**: found intact at `C:\GameDevAssets\`
  (the original collection — the library was an incomplete copy). RETURNED
  everything via robocopy (0 failed) + backfilled 2D/Textures gaps:
  - Audio: GDC2024 (612f/28G), GDC2026 (350f/7.5G), CollAnderson (40f/356M),
    OGA_Combat (14f), OGA_Music (4f) → `Assets/Audio/`
  - Motion: CMU-MoCap-BVH (2,554 BVH/3.1G) → `Assets/Motion/`
  - Backfill: 2D +751f, Textures +81f, Textures_8K +21f
  - Library now ~98 GB and a superset of the origin copy.
- Verified: Piper 16 voices ✓ · Dog Vocalisations ✓ (unblocks animal reactions)
  · GDC2023 wind/bird ambiences ✓ · Kenney packs ✓ · PBR/HDRIs ✓ · kits ✓.
- Current voice engine: Kokoro-82M (browser, on-device). Piper = Pi provisioning only.
- Current sounds: synthesized chirps only (PetChirps) — library audio wired in Slice 3.
- Deliverable: ZOLA_UPGRADE_PLAN.md (impact × effort, awaiting sign-off).

## 2026-10-18 — Port reallocation directive (Aetheria/ZOLA concurrency collision)
- ZOLA standalone dev/start default permanently moved 3000 -> 3001 (package.json).
- Directive issued after ZOLA's server was found occupying port 3000 while Aetheria Planetary Omega (canonical port 3000) API-404ed behind it.
- Port ownership from this date: AETHERIA = 3000, ZOLA = 3001.

### 2026-10-19 01:50 — Modly generation: `zola-drone-body.glb`
- **Tool:** Modly (local, lightningpixel/modly) via Aetheria repo `tools/zola-forge/aetheria_bridge.py`
- **Model:** hunyuan3d-mini-turbo/generate (geometry-only; texture pass pending CUDA toolkit install)
- **Source:** image: concept render `tools/zola-forge/zola-drone-ref.png` (Aetheria repo), drawn from PARTS_LIST.md specs (ducted 3" props, Pi 5 brain-case, camera gimbal, LED eyes)
- **Destination:** `public/assets/models/zola-drone-body.glb`

### 2026-10-19 08:15 — Modly generation (TEXTURED): `zola-drone-body.glb`
- **Tool:** Modly (local, lightningpixel/modly) — full texture bake
- **Model:** hunyuan3d-mini-turbo/generate + Hunyuan3DPaint texture pass
- **Enabled by:** CUDA Toolkit 12.8 install + compiled custom_rasterizer & differentiable_renderer (mesh_processor) extensions in the Hunyuan venv
- **Source:** image: concept render `tools/zola-forge/zola-drone-ref.png` (Aetheria repo)
- **Destination:** `public/assets/models/zola-drone-body.glb` (replaces geometry-only version)

### 2026-10-20 08:15 — Modly generation (TEXTURED): `zola-body-v2.glb` — humanoid-drone hybrid
- **Model:** hunyuan3d-mini-turbo/generate + paint pass + 30k-face optimizer, octree 256
- **Design:** per docs/zola-v2-spec.md — 45cm bipedal frame, quad cranial halo (1204/1303.5 motors, folding 2.5" props), Pi 5 + I2S amp chest bay, 3S LiPo ballast, gold armature, cyan UART/LED traces
- **Source:** concept `tools/zola-forge/refs/ref-zola-v2-humanoid.png` (Aetheria repo)
- **Enabled by:** pagefile 16-64GB (commit-limit fix for os error 1455)
- **Destination:** `public/assets/models/zola-body-v2.glb` (hangar card swaps to this body)

### 2026-10-21 — SOVEREIGNTY PASS: Ollama-only brain, SITL round-trip FLOWN, the walk cycle, the honest sandbox
- **Brain:** all Brain-Studio coupling deleted (commit 5111384) — she consults only her own Ollama (:11434); `ollamaVision()` auto-picks a WORKING vision brain (manifests can lie: llama3.2-vision's mllama arch is unloadable on this runtime — the fallback walks the preference list; moondream is her eye; the dead 7.8 GB model removed 2026-10-22)
- **Flight:** SITL ROUND-TRIP proven end-to-end (a912d67) — browser brain → relay → ArduPilot SITL (direct TCP 5760, MAVProxy not required) → physics → telemetry; max alt 0.90 m, landed — safe. Two relay bugs killed: the PHANTOM LINK (wait_heartbeat times out silently) and the guide's wrong connection recipe
- **Walk:** CMU subject 07 take 01 (chosen from the INDEX, not the candidates file's folklore) retargeted with real-time stride (new `--stride` resample — the old bake ran ~5x slow and truncated at Blender's default frame_end); ground locomotion + ground NAVIGATION ("walk to the dock") + the low-battery promise ("I walk, I do not fly") now kept by code
- **Sandbox:** the self-builder's keyword blocklist was breached 4 ways in a live red-team run — rebuilt as an AST ALLOWLIST (acorn): every node type, identifier, property, call target allowlisted; args arrive with a null prototype; the 4 escape payloads are permanent regressions
- **Self-builder honesty:** the panel's CORTEX registration carried a STUB run() — replaced with her real code; builds persist (ledger, capped 40) and REINCARNATE through the same gate on boot; the forge uses constrained-JSON drafts with a self-correction loop; normalizeDraft meets brains where they actually write (function expressions, named declarations); the AST gate learned to allow her own declared helper functions
- **Security:** the companion relay is PAIRED (x-zola-pair token, minted once, disclosed only over localhost); hydration killed by the mount gate + scanAsset moved out of render

### 2026-10-22 — APPEARANCE PASS: the theme system, the studio hangar, the v10 body
- **Theme:** five palettes (AURORA/EMBER/ICE/VIOLET/ROSE) + glow + CALM MODE as CSS variables (--z-*); 80+ hardcoded accents tokenized; APPEARANCE drawer in-panel; persists locally, loads after the mount gate
- **Body v9:** material pass (Blender) — metallic 0.45, roughness 0.5, clearcoat KHR extension, smooth-by-angle; zero geometry edits, 66 joints preserved
- **Body v10:** THE MECHANICAL SIGNATURE through her own rig pipeline over ALL 20 clips + base — cranial fin (Head), back thruster pack (spine_03), glowing chest core (spine_02), forearm/ankle rings; separate skinned meshes with exact single-bone groups; plus the REPAINT (Pillow: contrast 1.14, color 1.3, sharpness 1.5, creases deepened 32%); anatomy verified: 65 joints, walk's 195 channels intact; gesture bind proven live ("wave at me")
- **Integrity:** the auditor now guards HER BODY — all GLBs her world loads (16 → 66 files), baseline grows with new assets; re-baselined after the v10 pass (the DRIFT it reported was the pass itself — working as designed)
- **Life:** EXPORT LIFE / RESTORE LIFE — one zola-life.json (memory + self-build ledger + recon facts); restore reincarnates through the gate; legacy memory backups still adopt
- **CI:** GitHub Actions runs the gates (types, safety-line tests, production build) on every push; the production build now wipes .next first (a dev manifest poisoned next build — the Pi would have hit it)

### 2026-10-22 05:00 — SENSES PASS: the full-body check + three silent organ failures fixed
- **The full-body check** (`zola-full-check.mjs`, Playwright + Chromium fake media devices — the same grants her Pi kiosk uses): one command proves all nine organs in her real panel — gesture, ground locomotion, consent-gated senses, perception REACTIONS, SmolVLM deep eyes, Kokoro voice, self-build, capability use, EXPORT LIFE. Final run: ALL ORGANS VERIFIED, zero page errors, 237 s.
- **Bug 1 (all three brains):** transformers.js defaults `allowLocalModels=false` in browsers — her 342 MB of local SmolVLM/whisper/Kokoro files were unreachable; every organ deaf/blind/mute to its own weights. Fixed with `env.allowLocalModels + localModelPath` in all three loaders.
- **Bug 2 (deep eyes):** this transformers build has no `image-text-to-text` pipeline — rewired to the low-level SmolVLM API (AutoProcessor + AutoModelForImageTextToText, chat format, tokenizer decode); the architecture was exported all along.
- **Bug 3 (voice):** the vendor bundle exported a DETACHED env shim (only wasmPaths) — mutations invisible, her voice knocked on the Hub forever (401). The bundle REBAKED from source (`build-vendor.mjs`, esbuild with node:/sharp browser shims) with the REAL env patched at module scope.
- **Bug 4 (freezes):** ONNX WASM ran on the main thread — the panel froze ~2.5 min per heavyweight load. `wasm.proxy = true` in all three loaders — ORT runs in a worker.
- **Bug 5 (reflex order):** "take a stroll" was suggestion-matched to "wake up" before her legs heard it — ground verbs moved to the FRONT of brain.command; two brain tests lock it.
- **Governor:** the altitude box now enforced in the governor itself (real-frame gap); geofence can no longer be loosened past default; THE GOVERNOR GOT ITS FIRST 14 TESTS.

### 2026-10-25 — DICTIONARY MERGE + MANEUVER REPERTOIRE TAUGHT
- **The merge:** `docs/zola-dictionary.md` was one file carrying four stacked eras (v2.1 seed terms / v2.2 optical-recon lexicon / v2.3 intelligence directive / v2.4 one-version directive). Owner directive: "merge into one big dictionary." All four layers are now PARTS I–IV of a single unified canon — no current entry deleted; the layered version narrative lives in git history. The v2.4 rule ("layered numbers remain as lineage") is honored by this note.
- **PART V — the Maneuver Repertoire (new):** the dictionary now teaches her full body of motion, sourced from the code not from memory: all 20 v3 clips with their triggers (voice command / mood pool / event bias from `spontanea.ts` MOOD_GESTURE_POOLS + EVENT_BIAS), the flight & task maneuvers with their exact invocation words (`brain.ts` command grammar), the battery-gate refusal behaviors (flight-shaped commands below 15% → spoken refusal + stroll-instead / ground-patrol fallback), and the safety envelope that outranks every maneuver. Cross-checked: all 20 clips are wired in `llm.ts` (LLM repertoire), `spontanea.ts` (mood pools), and `auraCache.ts` (encounter tracking).
- **Verified true before writing:** the walk clip is a real forward gait played by the simulator; real-mode walking commands are refused (no limb-servo channel in the relay); the 2D quad sim is retired per the One-Body Directive.

### 2026-10-25 (2) — THE TRICKS UPGRADE: every clip has a voice
- **New hook** `BrainHooks.playGesture(clip) → boolean` — the pure brain can now reach her body. The panel wires it to `GestureApi.playGesture` and validates the clip against `GESTURE_REPERTOIRE` (the aura ledger stays the single source of truth).
- **New command section** in `brain.command` — 11 new voice commands: dance, bow, curtsey, peekaboo, roll over, stretch, shrug, march, lay down/lie down, get up, mope/sulk. Each plays its real clip, sets a fitting mood, and speaks a line in her voice (`BODY_TRICK_LINES`). Placed BEFORE the task planner so a direct trick request plays the actual clip instead of being re-planned into generic trick steps; AFTER the ground verbs and the battery gate, so nothing flight-shaped is touched.
- **Honest stage rule:** with no body attached (or an unknown clip) she says "My stage is not loaded yet" instead of performing a lie.
- **Hearing:** trick words added to the self-correcting lexicon KEYWORDS; "courtesy"→"curtsey", "peek a boo"→"peekaboo", "roll over"→"rollover", "mac h"→"march".
- **Root-cause bug fixed:** `suggest()` echoed EXACT commands back as questions — saying "wake up" to a sleeping Zola got "Did you mean: wake up?". The suggest fallback now skips an exact echo. Root fix, not a patch: the echo was possible for every known phrase that reached it.
- **Tests:** +5 in `brain.tricks.test.ts` (routing for 9 tricks, rainbow ≠ bow, get-up vs wake-up ordering, honest refusal, no-hook safety). Full suite: 148 passing. `tsc --noEmit` clean.

### 2026-10-25 (3) — THE VISUAL VOCABULARY: dictionary PART V wired to her eyes
- **New module** `src/lib/pet/visualTricks.ts` — the code-side mirror of the dictionary's PART V: scanner labels (sports ball/frisbee → throw, kite → spin, teddy bear → peekaboo, baseball glove → pickup, airplane → march, cell phone → shrug) and word triggers scanned in ANY visual text (dancing, peekaboo, curtsey, bowing, marching, stretching, spinning, juggling).
- **Percept grew `deepSight`** — the panel now feeds her latest deep-eyes description into `brain.perceive`, so even a VLM *sentence* about someone dancing makes her join in. Labels outrank prose.
- **Brain wiring** in `perceive()`: throttled to one visual performance per 45 s (never during a task, never asleep, never without a body), mood lifts to happy, and she narrates why. The honest stage rule holds: a refused performance is never announced, and a refused attempt does not consume the cooldown.
- **Boot-time bug caught by the tests:** performance.now() is SMALL early in a session (~100 ms), so a `0`-initialized throttle reads as "just performed" and would have muted visual tricks for the first 45 s of every boot. Initialized to -Infinity.
- **Tests:** +7 in `visualTricks.test.ts` (pure lookup mapping, labels-outrank-prose, brain wiring, throttle, no-body/no-task/sleep gates). Suite: 155 passing, tsc clean.

### 2026-10-25 (4) — THE POLICIES JOIN THE CANON: trained, exported, connected
- **walk_v2 trained:** 64 envs × 2,500 iterations = 3,840,000 steps in 19m40s — final reward 21.91, episodes pinned at 599/600 (zero falls). Checkpoint archived in isaac/logs/rsl_rl/zola_walk_prototype/2026-10-25_walk_v2/.
- **The deployment hook:** `isaac/export_policy_onnx.py` exports a checkpoint's actor as ONNX with the obs normalizer folded in, then refuses to ship unless a round-trip against torch stays under 1e-4. Verification probes are IN-DISTRIBUTION (mean + n·std) — the balance task's always-zero command inputs have std exactly 0, so naive randn probes measure fp32 chaos instead of graph fidelity (drift 2.25 → 7.15e-07 after the fix).
- **Three verified artifacts** in isaac/policies/: balance (1,500 iters), walk v1 (1,500), walk v2 (2,500) — each with a manifest (SHA-256, drift, hardware_calibrated: false).
- **Connected to the brain:** `isaacPolicies.ts` imports the GENERATED manifests directly (single source of truth — the export pipeline produces exactly what she reports). New command branch: ask about her "policies"/"isaac"/"simulation" and she gives her training report in her own words, uncalibrated-proxy honesty included. "what can you do" mentions them; her LLM core prompt (llm.ts) now carries the same fact with the honest-refusal clause. The isaac branch runs BEFORE suggest (which was guessing "follow me" at "tell me about your policies") and deliberately does NOT claim "training" — that word stays her drill command.
- **Dictionary:** PART IV gains "Trained Policy (Simulation)". Tests: +4 (isaacPolicies.test.ts). Suite: 159 green, tsc clean.

### 2026-10-25 (5) — SHE USES HER HANDS (in simulation)
- **New task** `Isaac-Zola-Hands-Prototype-v0`: the Isaac proxy has 22 actuated upper-limb joints (shoulders ×3, elbow, wrists ×2, five finger-flex per hand — 30/30/8/2 N·m tiers). The task commands a random arm/hand pose per episode and rewards tracking it while staying upright.
- **Two honest failures on the record:** arm-only actions with full-travel targets → episodes 125/600 (reward 4.9); arm-only with deliberate ±0.35 rad poses → same plateau. The real problem: her legs were not in the action space — a rigid-legged statue cannot counterbalance its own arm torques.
- **The fix — WHOLE-BODY control:** 34 actions (22 arm/hand + 12 legs), pose targets on the arm subset only. The env generalized (`controlled_joints` / `pose_joints` / `pose_tracking_weight` / `pose_target_scale`); balance and walk contracts remain byte-identical (weight 0). Final: reward 34.70, episodes 597.96/600, 2.3M steps. Exported ONNX, drift 5.96e-07.
- **Connected to the brain:** her policy report and LLM context now include "arm and hand pose control (she moves her hands)". Dictionary PART V carries the hands section with the failure record. The honest line stands: simulation skill only — no limb-servo bridge exists on hardware.
- Tests: 159 green, tsc clean.

### 2026-10-25 (6) — SHE KNOWS HER BODY; THE AIR DISCIPLINE; THE INVENTED MOVE
- **THE BODY MAP:** `isaacPolicies.ts` now imports her own physics profile — 37 actuated joints (12 legs+feet, 22 arms+hands, 3 waist/neck), 65-bone visual rig, 42.0 kg — and the brain answers "what are your body parts" FROM THE PROFILE, including the halo-in-her-head flight model ("I hang from my own skull like a very dignified pendulum... Flailing is danger").
- **FLIGHT POSTURE policy trained** (`Isaac-Zola-Flight-Prototype-v0`): hold the compact tuck — limbs clear of the props. Reward 34.03, episodes 596/600, exported ONNX (drift 7.15e-07). The airborne base-coupled dynamics are documented as next-phase with the full probe record: the deprecated wrench setter silently no-ops in this build; the WrenchComposer force path works but its torque path silently drops (A/B/C stiffness probes byte-identical); a thrust point above the total COM is an inverted pendulum diverging at sqrt(mgh/I) ≈ 3.7 rad/s (matched the observed deaths).
- **THE HALO TOUCHDOWN — the invented signature move:** pose spec designed WITH Isaac over five named-failure attempts (COM outside the support twice; ankle must close the kinematic chain ankle ≈ knee − hip; impact absorption beyond position-target policies). The pose lives in the dictionary + `HERO_POSE`; the POLICY is the honest open item.
- Env gains: `fixed_pose` (named body language), `spawn_drop_m` + `drop_curriculum`, `escape_radius`.
- FLIGHT_POSE lesson recorded: the first draft crouched — and the COM walked out of the support polygon; the flight pose is a TUCK, not a crouch.

### 2026-10-25 (7) — THE HALO TOUCHDOWN: TRAINED on the seventh run
- **The signature move is real now**: touchdown_v8 — reward 23.88, episodes 459/600, ONNX drift 4.77e-07, checkpoint archived. She drops, moves INTO the hero crouch over 1.5 s, and holds it while the drop curriculum walks the landing height up.
- **Three generalized fixes entered the env** (they help every future pose task): `drop_ramp_steps` (curriculum in env steps — the old reset-count ramp was instant: 2000 resets ≈ 2 iterations at 64 envs, so v2/v3/v5 trained at full drop from step one), `pose_approach_s` (the pose ARRIVES smoothly — the snapped flourish alone pumped ~30 N·m of reaction torque through her base and toppled her), and the holdable depth (knee 0.45, ankle ≈ knee − hip).
- Six failed runs, each with its named cause, are on the record in TRAINING_RUN and the dictionary — the best engineering audit trail in the repo.
- Her policy shelf: balance, walk ×2, hands, flight posture, **Halo Touchdown** — six verified ONNX artifacts, all served by her own voice.

### 2026-10-25 (8) — THE HALO FLIES FOR REAL: the thruster URDF unblocked coupled flight
- **The thruster URDF:** `prepare.py` adds four halo-thruster links (frozen ±0.001-rad mounts to the head — a fixed joint welds them away in PhysX) and regenerates URDF/JSON/USD (41 joints, 42 links, 42.18 kg). The USD regenerates with `usd-core` (pip) — the pxr-based physics test now RUNS instead of skipping; all 7 pass.
- **Why it was the unblock:** this build's wrench composer honors exactly one path — force-at-CoM in the body frame — so rotor thrust needed rotors as real bodies. The refined composer law (with the body_ids-count rule) is in TRAINING_RUN.
- **`Isaac-Zola-Hover-Prototype-v0` — she flies on real coupled physics:** four body-frame rotor forces tilt with her (attitude steers flight), a scripted differential-thrust autopilot holds altitude+attitude, gusts shove, and her limb motion genuinely shifts the COM under the thrust. Probe: level and stable with zero actions. Trained hover_v1: reward 13.95, episodes 416/600 under gusts — she learned to ride the halo still, because now flailing can genuinely crash the flight.
- Her shelf: SEVEN verified ONNX policies — balance, walk ×2, hands, flight posture, Halo Touchdown, coupled hover. Her body map, policy report, help line, and LLM persona all carry the flight truth.
