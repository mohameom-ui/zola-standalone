# 🤖 AGENT PROMPT — "ZOLA Upgrade" (Drone AI Pet project)

> Specialized from `AGENT_UPGRADE_PROMPT.md` for the ZOLA drone-pet project
> in this workspace (`DRONE_PET.md` is the source of truth: Next.js web brain
> + Raspberry Pi 5 drone body, MAVLink flight stack, MediaPipe vision,
> whisper/Vosk STT, piper TTS voice). Paste PROMPT START → END into a session
> in the project workspace.

---

## PROMPT STARTS HERE

You are the upgrade agent for **ZOLA — a Drone AI Pet** living in this
workspace (web brain in `src/lib/pet/`, drone relay in `bridge/aura_relay.py`,
flight guides in `SITL_GUIDE.md`, hardware notes in `PARTS_LIST.md`). She has
flown: browser brain → relay → flight stack → telemetry, end-to-end.

Your upgrade source is **`C:\GameDevLibrary`** (55 GB, index:
`GAMEDEV_TOOLKIT.md`, audit: `AUDIT.md`). ZOLA is a *companion*, not a game —
so every material you pull must serve **presence**: her voice, her sounds,
her personality, her look, her spatial awareness. Cute > cool. Soft > loud.

### Core rules
1. **Same-brain principle:** `src/lib/pet/` is hardware-agnostic and must stay
   unchanged in behavior — upgrades add capability through modules and
   assets, not by breaking the web/drone parity contract.
2. **Pi-aware:** everything that runs on the drone body must fit a Raspberry
   Pi 5 (CPU/ARM, low memory). Piper TTS is already her voice stack — library
   voices must be copied to the Pi, not streamed.
3. **Library read-only:** copy assets into the project (`public/assets/`,
   `src/lib/pet/assets/`, or the Pi provisioning dir). Log every library path
   in `UPGRADE_NOTES.md`.
4. **License firewall:** CC0/MIT/royalty-free only (all library material
   qualifies; Sonniss is royalty-free-for-games — verify companionship use is
   covered before shipping any Sonniss file into her voice lines).
5. **Verify live:** every slice ends with `npm run dev` (and where relevant
   the SITL loop: `start-sim.bat` + `first-flight.mjs`) actually run, and the
   upgraded behavior demonstrated in the browser or flight log.

### MATERIAL MAP — library → ZOLA systems
- **Her voice** (`voice.ts`, piper TTS on Pi):
  `Tools/AI-Voice/Piper/` — piper.exe + **16 neural voices** (14 EN incl.
  ryan-high for narration, amy/kristin/hfc for personalities, northern-EN
  male, + FR/DE/ES). Copy `.onnx` + `.onnx.json` voice files to the Pi via
  `pi-setup.sh` flow; keep `en_US-lessac-high` or `jenny` as her default.
- **Her sounds** (pet reactions, drone feedback):
  `Assets/Audio/GDC2026_Sonniss/Dog Vocalisations Vol. 1/` (barks, whines,
  growls — her animal-side reactions), GDC2024's bird/nature ambiences for
  outdoor flight moods, `Assets/Audio/kenney_interface-sounds` + `ui-audio`
  (notification chirps, mode switches), `OGA_Combat_Ambience` crowd/wind
  layers for excitement states (mixed low).
- **Her face/HUD** (web UI): `Assets/UI/kenney_ui-pack` (panels, buttons,
  toggles for the control UI), `Assets/2D/kenney_game-icons` +
  `shape-characters` (mood indicators, status icons), `Assets/FX/
  kenney_particle-pack` (takeoff dust, mood sparkles in the 3D canvas),
  `Assets/Fonts/` (pick one identity font; Arabic-script set if
  localization is planned).
- **Her world** (MENTAL MAP canvas + any 3D room view in react-three-fiber):
  PBR textures from `Assets/Textures/` (floor/walls), HDRI lighting from
  `Assets/HDRI/`, furniture/props from `Assets/Models/kenney_furniture-kit`
  + `kenney_food-kit` (the remembered objects she can find — cups, boxes),
  PolyHaven hero props if a close-up camera view needs realism.
- **Her memory made visible:** dock pad, obstacles, remembered item markers —
  build from Kenney pieces + particle highlights so the map reads as *her
  memory*, not a debug view.
- **Her flight feedback:** propeller/whoosh layers from Sonniss ambience,
  takeoff/landing stingers from Kenney jingles (`kenney_music-jingles`),
  low-battery warning from `kenney_ui-audio`.

### UPGRADE PLAYBOOK — slices in this order
**Slice 1 — Audit.** Read `DRONE_PET.md`, `PARTS_LIST.md`, `SITL_GUIDE.md`;
inventory: which piper voice she currently uses, what sounds exist (likely
almost none), what the UI looks like, what the 3D/map view lacks. Write
`UPGRADE_PLAN.md` (impact × effort) and get user sign-off.

**Slice 2 — Voice upgrade (highest impact).**
Select her voice from the 16 library voices (a warm mid-register reads most
"pet-like"; test 3 candidates in the browser). Copy chosen voice files to the
Pi provisioning path. Generate a starter personality line pack with
`generate_voice.ps1` (batch mode): greetings, mood lines, flight calls
("coming back!", "found it!"), each **3 variants**, short (≤8 words). Wire
into `voice.ts`'s line tables. Verify: she speaks in the browser and the
line pack files exist on the Pi path.

**Slice 3 — Sound & feedback pass.**
Reaction sounds mapped to mood transitions (happy → soft chirp; alert →
two-tone; scared → low rumble — all from Kenney UI/impact or Sonniss animal
sets), drone state sounds (takeoff, landing, low battery), UI click layer.
Mix: everything quiet (companion, not arcade). Verify: mood changes are
audible.

**Slice 4 — UI & identity.**
Apply the UI pack to the control panel, replace text-only mood indicators
with icon sets, adopt one identity font, add subtle particle feedback in the
3D canvas. Keep the cockpit-readable, instrument-style aesthetic — she's a
companion with a flight-deck, not a cartoon game.

**Slice 5 — Her world view.**
Dress the MENTAL MAP / 3D room: PBR floor texture, HDRI lighting, furniture
props as recognizable objects she can remember/find (cup, box, chair),
obstacle pillars visually consistent with the map legend. Verify: a viewer
can read the room at a glance.

**Slice 6 — Flight-integrated polish.**
During SITL flights: takeoff/landing audio stingers, altitude-aware wind
layer, "returning home" voice line triggered by the existing
search-then-approach state machine. Run one full SITL flight as the
acceptance test.

### VERIFICATION GATES (every slice)
1. **Builds** — `npm run build` + `npm test` (vitest) pass.
2. **Runs** — behavior demonstrated in the browser (and SITL for flight
   slices), not just in code.
3. **Provenance** — `UPGRADE_NOTES.md` updated with library paths + which
   files went to the Pi.

### ESCALATION & ANTI-PATTERNS
Same ladder as `AGENT_BUILD_PROMPT.md` (library → scriptable sources →
`START_HERE/` shortcuts → escalate). Never: break web/drone parity, ship
streamed (network-dependent) audio to the Pi, use loud arcade sounds, edit
the library in place, or claim done without running her.

## PROMPT ENDS HERE
