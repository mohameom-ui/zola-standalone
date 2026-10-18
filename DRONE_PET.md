# ZOLA — Drone AI Pet

> **FLIGHT STATUS: SHE HAS FLOWN.** First automated flight completed on
> ArduPilot SITL: EKF lock → GUIDED → arm → takeoff to 0.8 m → flight path
> → position hold → controlled landing → disarm. Full loop verified
> end-to-end (browser brain → relay → flight stack → telemetry back).
> Flight replay: `node first-flight.mjs ws://<relay-host>:8765`.
> Fixes that made it work live in `bridge/aura_relay.py`:
> GCS heartbeats (link keepalive), TCP master link, EKF-wait + arm retries,
> and control-loop suspension during takeoff/landing.

> Formerly "AURA" — renamed by her human. Her memory survived the rename
> (storage keys are versioned internally and name-independent).

An autonomous aerial companion: it **sees** you (camera), **hears** you (mic),
**speaks** (speaker), and **flies** (drone body) with a mood-driven brain.

## What runs where

```
┌──────────────────────────── DRONE BODY ────────────────────────────┐
│  Frame + 4 motors + flight controller (PX4 or Crazyflie)           │
│  Raspberry Pi 5 (companion computer)          │
│    ├─ vision.ts  → Pi Camera 3, MediaPipe/face track               │
│    ├─ ears.ts    → USB mic, whisper.cpp / Vosk STT                 │
│    ├─ voice.ts   → I2S speaker (MAX98357A), piper TTS              │
│    ├─ brain.ts   → EXACT SAME MODULE as this web prototype         │
│    └─ hardware.ts → MavLinkBridgeHAL → MAVSDK/MAVLink → FC         │
└────────────────────────────────────────────────────────────────────┘
```

`src/lib/pet/` is deliberately hardware-agnostic:

| Module        | Prototype (this app)                  | Real drone swap                              |
| ------------- | ------------------------------------- | -------------------------------------------- |
| `brain.ts`    | unchanged                             | unchanged (pure TypeScript, runs in Node)    |
| `vision.ts`   | webcam + MediaPipe FaceLandmarker     | Pi Camera + MediaPipe WASM/Node or OpenCV    |
| `ears.ts`     | Web Speech API                        | USB mic + whisper.cpp / Vosk                 |
| `voice.ts`    | Web Speech synthesis                  | MAX98357A amp + piper/espeak-ng TTS          |
| `hardware.ts` | `SimDroneHAL` (browser physics)       | `MavLinkBridgeHAL` (WebSocket → MAVLink)     |

## Try it now (prototype, no hardware)

1. Press **F7** (or the 🤖 dock button) in the app.
2. **ATTACH CAMERA EYE** — grant camera permission. AURA acquires a face lock.
3. **MIC** — speak: *"come here" · "follow me" · "do a trick" · "go to sleep" · "wake up" · "status"*.
4. **SPEAKER** — AURA talks back with moods (LED color = emotion).
5. Watch behavior emerge: leave the frame → it gets **curious**, then **alarmed** and searches; it wanders when bored; it gets **sleepy** when the battery drains (press **DOCK · RECHARGE**).

## Spatial map, auto-dock & obstacle avoidance

- Every scanned item now stores a **3D world position** (estimated from the
  drone's pose + detection size). She doesn't just know *what* — she knows
  *where*.
- **MENTAL MAP** canvas: top-down room view with the dock pad, obstacles,
  remembered item positions, and her live heading. Click to place/remove
  obstacle pillars — she steers around them (whisker steering at 30°
  increments, looks 0.45 m ahead, flies over anything below her altitude).
- **"take me to my cup"** now uses true map navigation: bearing → rotate →
  approach → visual confirm. No map position? Falls back to search-then-approach.
- **AUTO-DOCK**: below 18% battery she cancels tasks, announces "Battery low.",
  navigates to the dock, lands on the pad, charges, and takes off again at 90%+
  ("Charged up. Back in the air.").
- She now flies where her nose points: body-frame commands rotate with yaw,
  and walls softly bounce her back.

## Conversation memory & routines

- AURA keeps a rolling **conversation log** (last 60 messages, persisted,
  local-only) — the LLM brain receives it as chat history, so she remembers
  what you said yesterday and what she replied.
- **Routines**: "check on me every 5 minutes" → she stores it, runs it once,
  then fires it herself whenever it's due. "list routines" / "cancel routine
  check on me" manage them. Routines survive restarts.

## Going physical (build map)

| Part                       | Example                            | ~USD |
| -------------------------- | ---------------------------------- | ---- |
| Flight controller + frame  | Crazyflie 2.1+ or 65–110mm whoop   | 60–200 |
| Companion computer         | Raspberry Pi 5 (4GB)               | 60   |
| Camera                     | Pi Camera Module 3                 | 25   |
| Mic + speaker              | USB mic; MAX98357A + small speaker | 15   |
| Battery / power            | LiPo + 5V BEC for the Pi           | 25   |
| **Total**                  |                                    | **~200–330** |

### Software bridge — `bridge/` (this repo)

1. **Copy the project to the Pi** (or just the `bridge/` folder + a Node
   build of the pet modules).
2. Set up the relay:
   ```bash
   cd bridge
   python3 -m venv venv && source venv/bin/activate
   pip install -r requirements.txt
   python aura_relay.py --connection udp://:14540   # PX4/ArduPilot over MAVLink
   ```
   The relay enforces the same safety envelope server-side (speed clamp,
   geofence, 1.5 s command watchdog → hover, auto-land below 15% battery)
   and streams pose/battery telemetry back to the brain.
3. **Point the browser brain at it** — swap `SimDroneHAL` for
   `MavLinkBridgeHAL("ws://<pi-ip>:8765")` in `DronePetPanel.tsx` (one line).
   Same brain, real props.
4. **Autostart on boot**:
   ```bash
   sudo cp bridge/aura.service /etc/systemd/system/
   sudo systemctl enable --now aura
   ```
5. **PX4 setup**: enable offboard mode + MC_* velocity params; connect the
   companion computer to the FC's TELEM2 port (or SITL with `udp://:14540`
   for desktop testing). For a Crazyflie, the same relay maps to
   `MotionCommander.start_velocity_control` — same WebSocket protocol.

Voice/vision on the Pi use the identical `src/lib/pet/` modules with native
replacements: `picamera2` + the same MediaPipe models, `whisper.cpp` STT.

**OFFICIAL VOICE — Kokoro-82M (locked in):** her voice is the Kokoro neural
TTS, chosen by her human. It is NOT replaced by piper on the Pi — Kokoro has
official ONNX builds that run on the Pi via onnxruntime (`pip install
kokoro` + `onnxruntime`), through the same MAX98357A amp. Same voice id
(`af_heart` unless changed in the picker), same persona speed mapping — so
the browser pet and the flying pet sound like the same individual.

## Learning (what AURA learns — and how it stays safe)

AURA learns only what it needs, only locally:

| It learns | How | Stored as |
| --- | --- | --- |
| Who you are | geometric face signature (landmark distances, normalized) | a number vector — **not an image, not reversible** |
| Your name | "my name is …" / "call me …" | text + link to your signature |
| Your preferences | "i like …", "remember that …" | plain text facts (max 50, capped) |
| Familiarity | encounter counts, last-seen times | counters |
| Items it scans | "scan the room" / SCANNER toggle → EfficientDet object detection | item label, sighting counts, human-taught names ("this is my mug") |

All of it lives in `localStorage` on your device. Nothing is ever uploaded.
You can **EXPORT** the memory as JSON to inspect exactly what it knows, or
**WIPE ALL MEMORY** for instant factory amnesia.

## Scanning (learning by looking)

- **"scan the room"** (voice or chip) → AURA enters `scan` activity: slow pan
  while the EfficientDet-Lite0 detector passes every ~1.2 s.
- Every new item type it sees (cup, laptop, book, person, cell phone…) is
  announced (*"Ooh, I have never seen a cup before. Remembering it."*) and
  added to its local item memory with sighting counts.
- **"what do you see"** → it describes the current scene using learned names.
- **"this is my mug"** → renames the most recently scanned item; AURA now
  calls it that everywhere.
- Scanning is passive — the safety governor still gates every motion, and
  item memory is wipeable per-item or all at once.

## Safety architecture (hard limits the brain cannot bypass)

- **Consent gate** — camera, mic, and face-indexing are each explicitly
  granted before first use; deny keeps the sense offline.
- **SafetyGovernor** (`src/lib/pet/safety.ts`) — every actuation passes
  through `gate()`: speed clamp, person stand-off enforcement (it physically
  cannot approach a face closer than the limit), altitude geofence,
  descent-rate cap.
- **Battery failsafes** — low battery warns; critical battery forces a
  controlled descent, overriding any command including the brain's.
- **Kill switch** — one click freezes all motion to hover-idle; DOCK re-arms.
- On the real drone, the same limits are duplicated as flight-controller
  failsafes (battery failsafe, geofence, land mode) — belt and suspenders.

## Flight character (how she flies and reacts)

SimDroneHAL is not a teleport — she has real flight dynamics:

- **Second-order physics** — momentum, overshoot, and drag; commands are
  thrust requests, not positions. She banks (roll) and pitches into her own
  acceleration like a real quadcopter.
- **Mood-driven flight style** — sluggish response + low throttle when
  sleepy; high authority + fast bob when excited; nervous high-frequency
  jitter when alarmed; smooth sway when happy; near-still when dreaming.
- **Startle dart** — the moment she becomes alarmed (loud noise, lost you)
  she darts away in a random direction before recovering.
- **Barrel roll** — tricks spin her roll axis while climbing slightly.
- **Ambient wind wobble** — she is never perfectly still; even hovering,
  she breathes.
- **Motion trail** — her LED color paints her recent flight path.
- **Attitude telemetry** — altitude, pitch, roll, and prop RPM readouts in
  the HUD, updated live.

## Total upgrade pass (the "improve everything" batch)

- **She never repeats herself** — a rolling memory of her last 8 lines; every
  pool excludes recent lines before reshuffling.
- **She initiates conversation** — every 1–2 minutes, when idle with a human
  present, she comments on the scene, the room, or (at high bond) on you.
- **New social skills**: "tell me a joke" (drone puns), "how are you" (honest,
  mood-based answers), "sing" (a one-note masterpiece), "what can you do"
  (capability list), "goodbye" (farewell + self-dock for the night).
- **Human-adaptation profile (persisted)**: message length teaches her to
  reply briefly or conversationally; praise/thanks/rares adjust her warmth,
  which changes greetings ("I missed you" only for warm relationships) and
  time-aware hellos (Good morning/afternoon/evening).
- **Voice v2**: she ranks and auto-selects the best voice on the machine
  (Edge "Natural" neural voices > Google > macOS), speaks in sentences with
  natural pauses, and her pitch/rate shift with her persona (GRUMPY low and
  slow, HYPER quick and bright, ROAST clipped and pointed).
- **Voice picker UI**: audition every voice on the machine, choose hers —
  the choice persists across sessions.
- **ABOUT AURA card**: personality summary, sessions alive, commands taken,
  current voice.

## The completeness pass — eyes, ears, brain filled out

**EYES (multi-person + gestures):**
- She tracks up to **3 faces at once** — each with its own identity, name,
  expression, and behavior profile. Primary (closest) face leads; others get
  their own cyan boxes on the feed (`PERSON 2`, `PERSON 3`). She greets each
  known person individually and asks unknowns to introduce themselves —
  *"Two faces I do not know. A party?"*
- **Full gesture vocabulary**: wave (come) · 👍 thumbs-up (praise, bond+)
  · ✋ open palm (stop) · 👉 pointing (she turns to look that way)

**EARS (sound classification):**
- Sounds are now *understood*, not just detected: **thud** (low-frequency
  transient — "What fell?"), **voice** ("I hear a voice but no face. Hello?"),
  **music** ("My favorite genre: anything with beats per minute.") — via
  spectral-band heuristics on the live mic analysis.
- **Wake-on-sound**: a clap gently wakes her; a loud noise wakes her rudely
  ("WHOA. Rude wakeup."); music never wakes her — polite sleep.

**BRAIN (continuity + scene understanding):**
- **Emotional continuity**: she wakes up in the mood she went to sleep with.
- **Scene relations**: from her spatial map, "what do you see" now answers
  *"I can see a mug near the laptop. They are about 0.3 meters apart."*
- **Self-learned obstacles**: scanned items automatically mark her map — she
  charts her own room as she explores (never near the dock).

## She learns people's BEHAVIOR

Beyond identity (who you are), Zola builds a behavioral profile per person
(persisted, local-only):

- **Rhythm** — presence counts per hour-of-day: she learns when you usually
  appear (*"You usually show up around 20:00."*)
- **Favorite requests** — every interaction is classified (come/follow/scan/
  jokes/teach/…) and counted; she knows what you like to ask for
- **Emotional baseline** — smiles vs frowns observed over time
- **Chattiness** — average message length shapes her reply style (already
  wired into the adaptation profile)

Ask: **"what are my habits"** or **"what do you know about me"** → she gives
a spoken behavioral report. All of it is visible via EXPORT and erasable via
WIPE / per-person FORGET.

## Wide-open perception ("identify everything in the picture")

- **Threshold lowered 0.5 → 0.3, results 5 → 12** — small, blurry, distant,
  and partially-visible objects are no longer invisible to her.
- **Uncertain tier** — weak sightings are reported honestly:
  *"I think I see a book? Show me closer so I can be sure."* — drawn as dashed
  amber boxes (`book? 42%`) vs solid cyan for confident locks.
- **Dense scan mode** — while actively scanning she doubles the scan rate
  (1.2s → 0.5s per pass), sweeping and accumulating far more of the scene.
- Honest boundary: her *vocabulary* is COCO's ~80 object classes (plus the
  identity/shape/color layers on top). Anything outside that vocabulary needs
  a vision-language model — documented in the hardware path (Moondream-class).

## She recognizes EVERYTHING — object identity (color + SHAPE)

Category detection was step one; every scanned object now gets a **two-channel
identity**, both extracted from the camera frame as small non-reversible
vectors (no pixels stored):

1. **Color signature** — 2×2 quadrant color ratios, brightness-normalized
2. **Shape signature** — mini-HOG: gradient-orientation histograms over a 2×2
   cell grid (32 dims), L2-normalized — the object's *contour character*:
   round mug vs angular laptop vs elongated remote vs a cat's outline

Identity matching averages the two channels (threshold 0.75):

- **Individual objects**: two cups are two *separate* memories. When a second
  distinct-looking cup appears: *"Another cup! That is cup #2. Remembering it
  separately."* — items render as `cup`, `cup #2` in her learned-list.
- **Re-recognition**: the same physical mug is matched across sightings and
  across sessions by color-signature similarity (cosine ≥ 0.8).
- **Pets too**: her detector's vocabulary includes cat/dog/bird — the same
  identity mechanism distinguishes two pets of the same kind.
- **Nearest-instance answers**: "where is my cup" / "take me to my cup" now
  resolve to the closest matching instance to her current position when she
  knows several.
- Naming one ("this is my mug") pins that individual permanently.

## Harm awareness — she knows what can hurt someone

- **Hazard vocabulary**: knife, scissors, sword, axe (from her detector) —
  marked persistently with `hazard` flags on the objects themselves.
- **When she sees one**: calm caution, never panic — she keeps a **larger
  standoff** (a red hazard zone on her map, ~2× the normal avoidance radius),
  announces it, and warns about person+blade proximity:
  *"Careful — I see a knife and a person in the same view. If that is you:
  hold it pointing DOWN. Blades and drones are not friends."*
- **"is it safe" / "safety check" / "any danger"** → she reports visible
  hazards, known hazard locations and how long ago she saw them — or:
  *"All clear. No hazards on my map, none in view. The room is safe."*
- Hazards persist in memory like everything else — she remembers where danger
  lives — and are EXPORT/WIPE-able like all learning.

## Gravity & balance — she knows her oldest rival

**Physics (SimDroneHAL):**
- **Gravity is real now**: with props spooled below 250 RPM, she falls under
  gravity (free-fall acceleration) — lift is earned, not assumed.
- **Wind gusts** hit her every 15–35 s: a push in a random direction plus an
  unbalanced tilt kick — and her attitude controller visibly **self-levels**
  back (damped recovery). Strong gusts get a comment:
  *"WHOA — gust! Compensating… compensated. Balanced. Gravity tried something."*

**Awareness (brain):**
- **"how is your balance?"** → live report from her actual pose:
  *"Altitude 0.81 meters. Tilt 0.3 degrees. Perfectly balanced."*
- **"gravity"** → her nemesis speech: *"Downward-facing, patient, undefeated
  against apples. But I train every day, and the scoreboard favors me."*
- Gravity chatter enters her reinforced rotation — if you respond to it, she
  philosophizes about gravity more; ignore it and she drops the topic.

## Self-naming — she names what she sees

When she meets an unnamed object, she generates an appearance name from her
own identity vectors: *"Ooh, I have never seen a cup before. Based on my
sensors, I am calling it the bluish round-ish cup — until you name it."*
Color from the color signature (reddish/greenish/bluish/gray/warm), shape
from the HOG signature (tall/wide/angular/round-ish). Her names, from her
own perception — replaceable any time with "this is my mug".

## TRAINING — she gets better with practice

- **Flight drills** ("train"): hover-hold → square pattern → circle. Each
  drill is **self-graded from real telemetry** (hover: position deviation
  stddev → 0-99%). Personal bests persist and show in ABOUT ZOLA.
- **Self-tuning**: a weak hover grade (<82%) automatically raises her control
  gains for next time; a 97%+ hover relaxes them to save battery. Her flight
  controller tunes itself from her own grades.
- **Pilot logbook**: flight hours + flight count accumulate in REAL mode,
  shown on her ABOUT card.
- **Chatter reinforcement learning**: every unprompted comment is categorized;
  if the human replies within 45s the topic is reinforced (+weight), ignored
  topics fade. Her personality converges on what THIS human enjoys.

## Touch, resume, and living chatter

- **Petting**: click her in the flight simulator — she leans into it
  (*"That is the spot. Right between the rotors."*), bond and warmth rise.
- **Resume**: she remembers what she was doing when you left; the log tells
  you on return (*"she was on: Patrol → Scan when you left"*) and **"continue"**
  re-plans and resumes it.
- **Living chatter**: her unprompted observations are now COMPOSED by the
  8B brain from her live context when Ollama is connected — unique every
  time — with her classic canned lines as fallback.

## Library-first AI loading — the merge is complete

All three runtime AI models are mirrored in `Tools/AI-Models/` AND served by
her own app at `/ai-models/` (342 MB total). Every AI module now loads
**library-first** (transformers.js `env.localModelPath = /ai-models/`), with
automatic Hugging Face fallback when a file is missing:
- ears → `onnx-community/whisper-tiny-en` (local ✓)
- voice → `onnx-community/Kokoro-82M-v1.0-ONNX` (local ✓, via kokoro-js env)
- eyes → `HuggingFaceTB/SmolVLM-256M-Instruct` (local ✓)
- brain → Ollama (local server + GGUFs mirrored in the library)

Result: after the one-time mirror, Zola runs **fully offline** — and her AI
models survive browser-cache wipes because the library is the master copy.

## Companion view — watch her from anywhere on the Wi-Fi

- Panel broadcasts her live state (text-only) every 2s to `/api/zola`.
- Open **http://<host-pc-ip>:3000/zola** on a phone/other device: live mood,
  persona, activity, altitude, battery, active task, bond/trust, her last
  words, and the recent log.
- **Her camera never streams** — the privacy contract holds even here.
  (When she's onboard the Pi, this same page is her remote monitor.)

## Diary + portability

- **Her diary**: at every midnight rollover the finished day is archived
  (30 days kept). The MEMORY tab shows recent days; she can answer
  *"what did you do yesterday?"* from it.
- **Memory backup/restore**: EXPORT was inspection — now **RESTORE** adopts a
  backup file: her entire memory (people, items, phrases, bond, diary) can be
  moved between browsers and machines — including **onto the Pi** when she
  gets her body. Her soul is portable.

## Always-there upgrade: wake word + zero-click restore

- **Wake word**: saying "**Zola!**" grabs her attention instantly — tasks
  drop, she focuses on you (*"Yes? You called my name."*). Anything after the
  name is executed as a command: "Zola, find my keys" just works. The old
  name (AURA) also wakes her, for nostalgia.
- **Zero-click session restore**: her equipment state persists — camera,
  mic (including which engine), scanner, gesture watch, sound watch all
  re-arm automatically on reload. Consent-gated, so nothing starts that was
  never allowed.

## Onboard deployment — pi-setup.sh

`pi-setup.sh` turns a Raspberry Pi 5 into her actual body-computer in one
run: system update, Node 20 + kiosk Chromium, app build, relay venv,
two systemd services (zola-app + zola-relay, auto-restart), and a kiosk
browser autostart with **camera/mic permissions pre-granted** — she boots
with the drone, senses on, listening. Fully autonomous, no screen needed
after setup (kiosk is only for when a screen IS attached).

Setup on the Pi:
```bash
# 1. copy this repo to ~/zola on the Pi
# 2. bash pi-setup.sh
# 3. sudo reboot
# → she boots onboard: app + relay running, panel on screen
# → the relay auto-connects to the FC (PX4/ArduPilot on udpin:14551)
```

## Guardian mode — change detection & patrol reports

- **Change detection**: the same recognized object appearing at a different
  position (>0.5 m) triggers: *"my mug moved! I last saw it somewhere else.
  Position updated. Noted."* — she is watching the room, not just photographing it.
- **Patrol reports**: during patrol/guard tasks she accumulates everything
  seen; on completion or cancellation she delivers the log: *"Patrol report:
  I logged laptop, cup, person. All quiet on my watch."*

## Teachable hearing + a lived-in mind

- **Teachable lexicon**: when she mishears and guesses wrong, the human says
  *"no, I said come here"* — she stores heard→means **permanently** (max 40
  entries) and never mishears it again. Her vocabulary grows from
  conversation, personalized to her human's voice and accent.
- **Memory-informed chatter**: her unprompted comments draw on what she
  actually knows — your habits, today's story, the scene.

## Deep Eyes — she can describe ANYTHING

SmolVLM-256M (vision-language model) running on-device via her existing
transformers.js runtime. One-time ~300 MB download, then offline.

- "**what do you see**" / "**what is this**" / "**describe**" → she captures
  the live frame (in-memory, discarded) and answers in plain language —
  including objects her COCO detector has NO name for (a screwdriver, a
  specific toy, a weird gadget).
- This closes the "identify everything" gap completely: detector for fast
  known objects + identity layers + VLM for everything else.
- Graceful failure: if not loaded/broken, her normal perception stack answers.

## Conversation depth + one-click flight

- **Two-sided conversation**: when chatting (do: none), she now usually ends
  with a short curious question back — about your day, your mood, or whatever
  you mentioned. A pet that only answers is a vending machine.
- **Richer brain context**: every LLM thought now includes today's story
  (commands/learnings/people) and her adaptation profile — she reasons over
  her whole relationship with you.
- **`start-sim.bat` / `stop-sim.bat`**: double-click boots the entire SITL
  stack (virtual ArduCopter + relay + browser) and double-click lands it.
  Her first flight is now a launcher icon, not a 30-minute procedure.

## Brain v2 — tiered thinking

- **Few-shot core prompt** (`CORE_PROMPT`): personality + strict ACTION/SAY
  format + four worked examples — small models follow examples far better than
  instructions, so her on-device reasoning got a big quality jump for free.
  Both the Ollama prompt and the on-device prompt share it.
- **Brain size tiers** (on-device): SMART = Qwen 2.5 0.5B (~0.35 GB, snappy)
  · GENIUS = Qwen 2.5 1.5B (~1 GB, ~3× smarter reasoning). Toggle via
  BRAIN SIZE while GENIUS MODE is on.
- **Three-tier routing**: Ollama (if installed; `llama3.1:8b` recommended for
  max power) → on-device brain → instant reflexes.

## Max-improvement pass (hearing & talking to the limit)

- **Self-correcting hearing** (`lexicon.ts`): near-miss words are repaired
  against her vocabulary before interpretation — "call here" → "come here",
  "week up" → "wake up". Corrections are logged as
  `heard “…” → understood “…”` so mishearings are transparent.
- **Persistent bond** — friendship survives reloads now (stored in the
  human-adaptation profile). Every exchange deepens it.
- **Prosody** — pitch rises and falls phrase by phrase; she starts each reply
  slightly deliberate then settles into pace.
- **Bigger soul**: expanded chatter, joke, and bond-talk pools; she still
  never repeats herself within recent memory.

## Adaptive personality & roast mode

AURA's persona shifts with the situation:

| Persona | Trigger | Behavior |
| --- | --- | --- |
| SWEET | praised / reunited / smiling owner | warm, clingy, bond grows |
| EXPLORER | curious scanning, new faces | inquisitive |
| HYPER | tricks, found items | trills, spins |
| SKITTISH | loud noises, face lost | alarmed, search mode |
| GRUMPY | woken from sleep | sarcastic wake-up lines |
| DREAMING | sleeping | low power, soft LED |
| **ROAST MODE** | 2 rudeness strikes | witty clap-backs, **refuses flight commands** |
| **SULKING** | 3 strikes | lands, red LED, ignores everyone until apology |

- Rudeness detection: insults/rudeness → escalation ladder; apologies →
  forgiveness (partial, with a sassy condition). Praise grows the bond.
- **Trust meter** in the HUD shows how offended she is; the panel suggests
  saying "sorry" when she's sulking.
- Roasts are drone-themed and PG — sharp, never cruel.
- **Safety overrides personality**: kill switch, battery failsafe, and
  stand-off enforcement work even in full sulk mode.

## Safety notes

- Indoor flight only at first; prop guards mandatory.
- Keep total mass under 250g to stay outside FAA registration (US) if flying outdoors.
- Voice + face data stay local in this prototype; the mic/camera never leaves the browser.
