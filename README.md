# ZOLA — a drone AI pet with a browser brain

Zola is an autonomous companion: a humanoid-drone hybrid (3D body, 65-bone
rig, 20 movement clips) driven by a purely local mind — Ollama for
deliberation, on-device transformers for ears/eyes, piper for her voice.
Nothing leaves the machine.

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
npm install
npm run dev            # http://localhost:3001
npm test               # vitest — the safety lines are all in here
npx tsc --noEmit       # types
```

Optional brains & senses (all local): [Ollama](https://ollama.com) on
`:11434` (she self-engages when she finds it), a camera for her eye,
a mic for her ears.

## What she can do

- **Fly** — sim physics, or a REAL flight stack: SITL round-trip proven
  end-to-end ([SITL_GUIDE.md](SITL_GUIDE.md)); body `BODY · REAL` →
  `ws://localhost:8765`.
- **Walk** — a real gait (`walk_01`, retargeted from CMU mocap at true
  speed), ground locomotion, and ground *navigation*: "walk to the dock".
  When her battery refuses flight, she keeps the promise — she walks there.
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

## The laws (as the code enforces them)

1. **Sovereign** — her brain is local and self-owned; no external studio,
   no cloud dependency (verified by grep, guarded by tests).
2. **No stubs, no inflation** — every registered capability actually
   executes; a capability that claims to run must run.
3. **Zero fake metrics** — offline is reported offline; a missing model is
   reported missing; telemetry comes from the real stack or is not shown.
4. **Privacy** — her camera never streams; the companion view is text-only
   and paired (a LAN device gets nothing without the token).
5. **The sandbox is not a joke** — generated capability code is parsed and
   allowlisted at the AST level; the red-team regressions live in
   `src/lib/pet/selfBuilder.test.ts`.

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
| `bridge/` | the ground relay (pymavlink ⇄ WebSocket) + SITL session script |
| `public/assets/models/zola-anims/` | her movement library (20 clips) |
| `Scripts/` | the gesture pipeline (Blender retarget: BVH → her rig → GLB) |
| `docs/` | specs & recipes ([zola-v2-spec.md](docs/zola-v2-spec.md) is the living spec) |
