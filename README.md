# ZOLA — humanoid companion and flight-control console

Zola is a local-first companion with a humanoid 3D body, 65-bone animation
rig, and 20 movement clips. The browser app handles her interactions and
memory; optional local Ollama and on-device models provide language and
perception. Flight is a separate ArduPilot relay.

```
browser brain (Next.js :3001)                her body
┌──────────────────────────────┐   WebSocket  ┌──────────────────────┐
│ reflex brain + Ollama brain  │ ───────────> │ ground relay          │
│ moods · tasks · memory       │              │ (pymavlink)           │
│ vision · hearing · speech    │ <─────────── │ MAVLink               │
│ self-builder (AST sandbox)   │   telemetry  │ ↓                   │
└──────────────────────────────┘              │ ArduPilot SITL /      │
                                              │ real FC (Pi 5 + UART) │
                                              └──────────────────────┘
```

## Run her

```bash
npm ci
npm run dev            # http://localhost:3001
npm test                    # full suite — the safety lines are all in here
node zola-live-loop.mjs     # build → ledger → reincarnation → use, in the real panel
node zola-full-check.mjs    # ALL ORGANS: eyes, ears, voice, body, mind, life export
npx tsc --noEmit       # types
```

Node 22 or newer is required (declared in `engines`); `npm ci` installs exactly what the lockfile pins. Optional local brains and senses: [Ollama](https://ollama.com) on `:11434`,
a camera, and a microphone. **Network behavior:** on startup the app checks
the same-origin capability-pack route and may fall back to the public Zola
pipeline GitHub file; the health monitor polls public GitHub commit metadata
every 30 seconds; `recon:` queries Wikipedia and `search:` opens Google.
Camera frames are processed in the browser and are not sent by the companion
view. `start-zola.bat` is the daily launch.

## What she can do

- **Fly** — simulated flight or an ArduPilot flight-controller link. The
  [SITL guide](SITL_GUIDE.md) documents setup and a guarded first-flight
  sequence. `BODY · REAL` connects to the authenticated relay; a separate
  confirmed **ARM & TAKE OFF** control starts flight, and **LAND & DISARM**
  ends it.
- **Move her full body** — the 65-bone rig and 20 clips animate her hands,
  fingers, arms, torso, and legs. The simulator moves her across the ground
  while the walk cycle plays. The real flight relay has no limb-servo channel
  yet, so real-mode walking commands are refused instead of sent to props.
- **See** — MediaPipe object detection + a deep-sense VLM (auto-picks a
  WORKING vision brain from her Ollama; refuses honestly if none answer).
- **Hear & speak** — wake word, teaching corrections, on-device STT,
  piper/Kokoro voice.
- **Grow** — the self-builder: she writes new capabilities, her AST
  allowlist sandbox judges them, she fixes her drafts from the gate's own
  error report, installs the survivors, and *keeps* them (they reincarnate
  through the same gate on every boot).
- **Remember** — spatial map, item memory with color/shape signatures,
  bond & trust, dream consolidation, vlogs. **EXPORT LIFE / RESTORE LIFE**
  carries all of it — plus her self-built capabilities — in one file; restore
  reincarnates her through the same gate.
- **Dress** — the APPEARANCE settings: five accent palettes, glow strength,
  calm mode — CSS-variable themed across the panel *and* her 3D rim light.

## Operating notes

- **Local-first, not air-gapped** — inference and memory are local when the
  selected model supports it. The network checks and explicit lookups above
  are separate behaviors.
- **Camera privacy** — camera frames are processed live in the browser; the
  paired companion view exposes text status only.
- **Real flight stays explicit** — the real flight relay requires pairing,
  an authenticated link, and a separate takeoff action. The relay controls
  the flight controller; humanoid limb motions remain visual animations.
- **Self-builder limits** — generated capability code is parsed and
  allowlisted at the AST level; red-team regressions live in
  `src/lib/pet/selfBuilder.test.ts`.

## Isaac Sim readiness

The web GLB is a visual animation rig, not a physics-ready robot articulation.
First prototype policies (balance, walk) were trained in Isaac Lab 3.0 on
2026-10-24 — see [`isaac/TRAINING_RUN_2026-10-24.md`](isaac/TRAINING_RUN_2026-10-24.md).
They are uncalibrated-proxy results, not hardware-ready controllers. The
required physical model and the Isaac Sim → Isaac Lab workflow are documented
in [`isaac/README.md`](isaac/README.md) and
[`isaac/zola_robot_contract.json`](isaac/zola_robot_contract.json).

## Deploy her body (Raspberry Pi 5)

```bash
bash deploy-to-pi.sh          # sync (measured manifest) → build → setup
```
See [DEPLOY.md](DEPLOY.md) for what flies and what stays home.

## Layout

| Path | What |
|---|---|
| `src/lib/pet/` | her mind — brain, tasks, memory, vision, self-builder, HALs (hardware-agnostic by contract) |
| `src/components/pet/` | her body & panel — 3D rig, HUD, command loop |
| `bridge/` | the authenticated ground relay (JSON WebSocket ⇄ pymavlink) + SITL session script |
| `public/assets/models/zola-anims/` | her movement library (20 clips) |
| `Scripts/` | the gesture pipeline (Blender retarget: BVH → her rig → GLB) |
| `isaac/` | physics-model contract and Isaac Sim / Isaac Lab training path |
| `docs/` | specs & recipes ([zola-v2-spec.md](docs/zola-v2-spec.md) is the living spec) |

## License

MIT, see [LICENSE](LICENSE).
