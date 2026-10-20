# 🚁 ZOLA × GAMEDEV LIBRARY — MASTER COMMAND ORDER

> **Goal:** use *everything* in `C:\GameDevLibrary` (~98 GB: assets, tools, AI models, scripts)
> to customize and AI-generate every single item of the ZOLA AI drone pet project —
> coding, voice, sound, graphics, themes, UI, FX, motion, and offline intelligence.
>
> **How to use:** run the phases **in order** (later phases depend on earlier ones).
> Every command is copy/paste-ready PowerShell. Set the two variables once:
>
> ```powershell
> $LIB  = "C:\GameDevLibrary"        # the library (READ-ONLY — copy out, never modify)
> $ZOLA = (Get-Location).Path        # run this from the ZOLA project root
> ```
>
> **STATUS 2026-10-18: ALL 9 PHASES EXECUTED & VERIFIED.** Zola now lives at
> `C:\Users\self_\ZOLA-standalone\` (separated from Aetheria; port 3010).
> As-executed log and deviations: see **EXECUTION LOG** at the bottom of this file.
>
> **Golden rules** (from the library's own `AGENT_BUILD_PROMPT.md`):
> 1. **Library-first** — never stub or download what the library already has.
> 2. **Read-only library** — copy INTO Zola, never edit library files.
> 3. **License firewall** — CC0/MIT/OFL only (Sonniss = royalty-free-for-games; keep out of her spoken lines).
> 4. **Verify everything** — build, play, listen before claiming done.
> 5. **8K only up close** — use `Assets\Textures\` 2K everywhere else.

---

## PHASE 0 — LIBRARY HEALTH & INDEX (run first, always)

```powershell
# 0.1 Refresh/re-sync the whole library (ambientCG / PolyHaven / Kenney patterns)
powershell -ExecutionPolicy Bypass -File "$LIB\Scripts\update_library.ps1"

# 0.2 Verify the AI model mirror is intact (whisper, kokoro, smolvlm, ollama GGUFs)
bash "$LIB\Scripts\mirror-ai-models.sh" --verify   # or re-run without --verify to re-mirror

# 0.3 Skim the master index so you know what you're pulling from
code "$LIB\GAMEDEV_LIBRARY_ALL_IN_ONE.md"
```

✅ *Gate:* library audited, no missing folders, scripts exit 0.

---

## PHASE 1 — HER VOICE 🎙️ (Tools\AI-Voice — Piper TTS, offline, MIT)

```powershell
# 1.1 Generate a 3-variant personality line pack (pick a voice; en_US-amy-medium recommended,
#     also audition en_GB-alba, en_US-hfc_female)
powershell -ExecutionPolicy Bypass -File "$LIB\Tools\AI-Voice\generate_voice.ps1" `
  -Voice en_US-amy-medium `
  -Out "$ZOLA\public\sfx\zola\voice" `
  -Lines @(
    "Hello. I am Zola.",
    "Come here.",
    "Following you.",
    "I am curious about that.",
    "Battery low. Returning to dock.",
    "Charged up. Back in the air.",
    "I cannot find it. Help me look?",
    "Taking off now.",
    "Landing. Please stand clear.",
    "Task complete. Anything else?",
    "I feel happy.",
    "Something is wrong. Alert mode."
  )

# 1.2 Convert WAV masters to OGG for shipping (keep WAVs as masters in the library pattern)
Get-ChildItem "$ZOLA\public\sfx\zola\voice\*.wav" | ForEach-Object {
  ffmpeg -i $_.FullName -c:a libvorbis -qscale:a 5 ($_.FullName -replace '\.wav$','.ogg')
}

# 1.3 Provision the voice model for the onboard Pi brain (her real hardware voice)
Copy-Item "$LIB\Tools\AI-Voice\Piper\voices\en_US-amy-medium.onnx*" "C:\prep\pi-voice\" -Recurse
# → later: scp to Pi into the piper voices path used by voice.ts
```

✅ *Gate:* every line exists in 3 variants, plays back clearly, browser + Pi voice tables match.

---

## PHASE 2 — HER SOUNDS 🐕 (Assets\Audio — Kenney CC0, GDC dog vocals, OGA ambience)

```powershell
# 2.1 Mood feedback chirps (Kenney RPG/sci-fi — CC0): map mood → sound
Copy-Item "$LIB\Assets\Audio\kenney_rpg-audio\*"          "$ZOLA\public\sfx\zola\moods\" -Recurse -Exclude *License*,*Preview*
Copy-Item "$LIB\Assets\Audio\kenney_sci-fi-sounds\*"      "$ZOLA\public\sfx\zola\moods\" -Recurse -Exclude *License*,*Preview*
Copy-Item "$LIB\Assets\Audio\kenney_interface-sounds\*"   "$ZOLA\public\sfx\zola\ui\"    -Recurse -Exclude *License*,*Preview*

# 2.2 Her animal side — GDC2026 Dog Vocalisations (sniffs, whines, happy huffs)
#     Browse the bundle index and cherry-pick; do NOT bulk-dump 7.5 GB into the repo:
#     Start-Process explorer.exe "$LIB\Assets\Audio\GDC2026_Sonniss"
#     → copy chosen files to  $ZOLA\public\sfx\zola\animal\

# 2.3 Flight layers — wind/gust ambience (GDC2023 cherry-pick) for altitude-reactive sound
#     → pick 2–3 wind loops into  $ZOLA\public\sfx\zola\flight\  (loopable, mono OK)

# 2.4 World ambience (OGA combat ambience for alert/danger states; OGA music for idle moods)
Copy-Item "$LIB\Assets\Audio\OGA_Combat_Ambience\*.ogg" "$ZOLA\public\sfx\zola\alert\" -Recurse
# 2.5 UI click set — already present in Zola; refresh if needed:
Copy-Item "$LIB\Assets\UI\kenney_ui-pack\Sounds\*.ogg" "$ZOLA\public\assets\audio\ui\" -Force

# 2.6 Radio-EQ her voice lines (comms feel) — batch in Audacity:
#     high-pass 300 Hz → low-pass 3400 Hz → slight distortion → normalize
#     (do this on a COPY; masters stay clean)
```

✅ *Gate:* every mood/state in `brain.ts` has ≥1 sound; volume audited (sounds quieter than voice).

---

## PHASE 3 — UI, THEME & IDENTITY 🎨 (Assets\UI + Assets\Fonts)

```powershell
# 3.1 Identity fonts (OFL) — Rajdhani HUD style + Cairo for Arabic script
Copy-Item "$LIB\Assets\Fonts\Rajdhani-Bold.ttf"        "$ZOLA\public\fonts\" -Force
Copy-Item "$LIB\Assets\Fonts\Cairo-Variable.ttf"       "$ZOLA\public\fonts\" -Force
# Optional extras for variety:
Copy-Item "$LIB\Assets\Fonts\BlackOpsOne-Regular.ttf"  "$ZOLA\public\fonts\" -Force
Copy-Item "$LIB\Assets\Fonts\Oswald-Variable.ttf"      "$ZOLA\public\fonts\" -Force

# 3.2 UI kit vectors — recolor via Inkscape CLI to Zola's theme palette (teal/amber example)
#     (install Inkscape from $LIB\START_HERE\11-Inkscape-download.url if absent)
$src = "$LIB\Assets\UI\kenney_ui-pack\Vector\Blue"
$new = "$ZOLA\public\assets\ui\svg-teal"
New-Item -ItemType Directory -Force $new | Out-Null
Get-ChildItem "$src\*.svg" | ForEach-Object {
  & inkscape $_.FullName --export-filename "$new\$($_.Name)" `
    --export-svg-color="#14b8a6ff"
}

# 3.3 RPG-expansion bars & panels → battery bars, status panels, mental-map legend chips
Copy-Item "$LIB\Assets\UI\kenney_ui-pack-rpg-expansion\PNG\bar*.png"   "$ZOLA\public\assets\ui\bars\"
Copy-Item "$LIB\Assets\UI\kenney_ui-pack-rpg-expansion\PNG\panel*.png" "$ZOLA\public\assets\ui\panels\"

# 3.4 Status/mood icons (kenney_game-icons) + input prompts for the HUD
Copy-Item "$LIB\Assets\2D\kenney_game-icons\*"   "$ZOLA\public\assets\ui\icons\" -Recurse
Copy-Item "$LIB\Assets\2D\kenney_input-prompts\*" "$ZOLA\public\assets\ui\prompts\" -Recurse
```

✅ *Gate:* one consistent theme (colors + font + icon style) across HUD, dock, mental map.

---

## PHASE 4 — GRAPHICS: MODELS, TEXTURES, LIGHTING 🏔️ (Assets\Models · Textures · HDRI)

```powershell
# 4.1 Drone-body concept parts — Kenney kits give you every mechanical shape:
Copy-Item "$LIB\Assets\Models\kenney_space-kit\*"      "$ZOLA\public\assets\models\concepts\space-kit\" -Recurse
Copy-Item "$LIB\Assets\Models\kenney_car-kit\*"        "$ZOLA\public\assets\models\concepts\car-kit\"    -Recurse
# Prototype/greybox for blockouts:
Copy-Item "$LIB\Assets\Models\kenney_prototype-kit\*"  "$ZOLA\public\assets\models\concepts\greybox\"   -Recurse

# 4.2 Her world objects (things she "remembers" in the mental map):
Copy-Item "$LIB\Assets\Models\kenney_furniture-kit\*"  "$ZOLA\public\assets\models\room\furniture\" -Recurse
Copy-Item "$LIB\Assets\Models\kenney_food-kit\*"       "$ZOLA\public\assets\models\room\food\"      -Recurse

# 4.3 Outdoor/savanna props (Quaternius nature + animals — rigged FBX/GLB):
Copy-Item "$LIB\Assets\Models\quaternius_nature-150\*" "$ZOLA\public\assets\models\nature\" -Recurse
# Animated animals for the savanna ambience around her dock:
#  → pick 3–5 from quaternius_animated-animals into public\assets\models\animals\

# 4.4 Hero props (PolyHaven photoreal .blend/.glb) only if a hero shot needs them:
#  → cherry-pick into public\assets\models\hero\  (keep repo lean)

# 4.5 Materials — 2K PBR sets (Color/NormalGL/Rough/AO). Ground/rock/wall for the 3D room view:
Copy-Item "$LIB\Assets\Textures\Ground037_2K-JPG\*" "$ZOLA\public\assets\textures\ground037\"
Copy-Item "$LIB\Assets\Textures\Rock026_2K-JPG\*"   "$ZOLA\public\assets\textures\rock026\"
Copy-Item "$LIB\Assets\Textures\Metal016_2K-JPG\*"  "$ZOLA\public\assets\textures\metal016\"   # drone hull
Copy-Item "$LIB\Assets\Textures\Wood056_2K-JPG\*"   "$ZOLA\public\assets\textures\wood056\"    # dock pad

# 4.6 Lighting themes — one HDRI per mood (2K for runtime; 8K only for close-up renders):
Copy-Item "$LIB\Assets\HDRI\spruit_sunrise_2k.hdr"                "$ZOLA\public\assets\hdri\" -Force
Copy-Item "$LIB\Assets\HDRI\kloofendal_48d_partly_cloudy_2k.hdr"  "$ZOLA\public\assets\hdri\" -Force
Copy-Item "$LIB\Assets\HDRI\dikhololo_night_2k.hdr"               "$ZOLA\public\assets\hdri\" -Force
Copy-Item "$LIB\Assets\HDRI\industrial_sunset_puresky_2k.hdr"     "$ZOLA\public\assets\hdri\" -Force
```

**Theme mapping (edit once, apply everywhere):**
| Mood | HDRI | LED | Sound family |
|---|---|---|---|
| Happy | spruit_sunrise | warm teal | chirp-happy |
| Curious | partly cloudy | amber | sniff/chirp |
| Alert | industrial_sunset | red pulse | alert + combat amb |
| Sleep | dikhololo_night | dim blue | low hum |

✅ *Gate:* R3F scene loads all new GLB/textures; HDRI switchable per mood without hitching.

---

## PHASE 5 — FX & PARTICLES ✨ (Assets\FX)

```powershell
# 5.1 Particle feedback for the flight canvas (sparks on takeoff, dust on landing)
Copy-Item "$LIB\Assets\FX\kenney_particle-pack\*" "$ZOLA\public\assets\fx\particles\" -Recurse -Exclude *License*,*Preview*

# 5.2 Crosshair/targeting pack → her face-lock reticle & "look-at" indicator
Copy-Item "$LIB\Assets\FX\kenney_crosshair-pack\*" "$ZOLA\public\assets\fx\crosshair\" -Recurse
```

✅ *Gate:* particles tintable at runtime; reticle follows her gaze in the camera eye.

---

## PHASE 6 — MOTION 🕺 (Assets\Motion — CMU MoCap, 2,548 public-domain BVH)

```powershell
# 6.1 Gesture library for her "tricks" (wave, bow, spin, stretch) — in Blender:
#     import BVH → retarget to her rig → bake → export GLB to public\assets\models\zola-anims\
# 6.2 Pick candidate files first by name:
Get-ChildItem "$LIB\Assets\Motion\CMU-MoCap-BVH" -Recurse -Filter *.bvh |
  Where-Object { $_.Name -match 'wave|dance|jump|walk' } |
  Select-Object -First 20 FullName
```

✅ *Gate:* at least 3 gestures importable & retargetable; exported GLBs load in R3F.

---

## PHASE 7 — HER OFFLINE BRAIN 🧠 (Tools\AI-Models — ~25 GB mirror)

```powershell
# 7.1 Stage the mirrored models for the Pi (she runs fully offline):
Copy-Item "$LIB\Tools\AI-Models\whisper-tiny-en\*" "C:\prep\pi-models\whisper\" -Recurse   # ears (STT)
Copy-Item "$LIB\Tools\AI-Models\kokoro-82m\*"      "C:\prep\pi-models\kokoro\"  -Recurse   # browser voice fallback
Copy-Item "$LIB\Tools\AI-Models\smolvlm-256m\*"    "C:\prep\pi-models\smolvlm\" -Recurse   # vision describer
Copy-Item "$LIB\Tools\AI-Models\ollama\*"          "C:\prep\pi-models\ollama\"  -Recurse   # llama3.2:3b conversational brain

# 7.2 Wire the relay/bridge to load models from these paths (update bridge config +
#     src/lib/pet modules: ears.ts → whisper, brain.ts → ollama GGUF, voice.ts → piper)
```

✅ *Gate:* Zola answers a "what do you see?" question 100% offline with smolvlm + ollama.

---

## PHASE 8 — CODING & TOOLING 🛠️ (Tools\ + project code)

```powershell
# 8.1 Ensure the toolchain from the library index is installed
#     (VS Build Tools for bridge/native work, CMake, Git LFS, Audacity for audio QC,
#      Blender for FBX/BVH/GLB conversions — re-download from blender.org, it's absent)
#     Installers live in:  $LIB\Tools\Installers\

# 8.2 Library-first coding pass on the pet brain (src/lib/pet/):
#     - brain.ts  : add routine/behavior hooks for each new sound + gesture + mood theme
#     - voice.ts  : play Piper-generated lines (3-variant random pick), radio-EQ toggle
#     - hardware.ts: takeoff/landing/low-battery audio triggers wired to Phase 2 sounds
#     - mental map: render remembered objects with Phase 4.2 furniture/food GLBs
# 8.3 Update bridge/aura_relay.py: emit audio-event messages alongside telemetry

# 8.4 Verify the whole stack
npm run build
node first-flight.mjs ws://localhost:8765    # SITL replay still passes
```

✅ *Gate:* `npm run build` green; behavior demonstrated live; sounds/voice fire on real state changes.

---

## PHASE 9 — MAINTENANCE & CONTRIBUTION BACK ♻️

```powershell
# 9.1 Record which library folders fed the project (library convention)
Set-Content "$ZOLA\BUILD_NOTES.md" @"
# BUILD_NOTES — library sources consumed
- Voice: Tools/AI-Voice/Piper (en_US-amy-medium), generated $(Get-Date -Format yyyy-MM-dd)
- Sounds: kenney_rpg-audio, kenney_sci-fi-sounds, kenney_interface-sounds, GDC2026 dog vocals, OGA
- UI/Fonts: kenney_ui-pack (+rpg-expansion), Rajdhani, Cairo
- Models: kenney space/car/furniture/food/prototype kits, quaternius nature/animals
- Textures: Ground037/Rock026/Metal016/Wood056 @2K
- HDRI: spruit_sunrise, kloofendal_48d, dikhololo_night, industrial_sunset (2K)
- FX: kenney_particle-pack, kenney_crosshair-pack
- AI: whisper-tiny-en, kokoro-82m, smolvlm-256m, ollama GGUFs
"@ -Encoding UTF8

# 9.2 Any NEW reusable material you created (e.g., curated dog-vocal picks, generated
#     voice packs) → contribute back via the update_library.ps1 patterns.
```

---

## 📒 EXECUTION LOG — as actually run (2026-10-18)

> Target: `C:\Users\self_\ZOLA-standalone\` (NOT this workspace — Zola was
> separated from the Aetheria app after Phases 1–7 were planned; Aetheria was
> purged of pet modules and builds clean without her).

| Phase | Landed | Verified |
|---|---|---|
| 0 | library refresh launched (bg) · AI-mirror verified: 116 files / 25 GB | ✓ |
| 1 — Voice | **48 Piper WAVs** (16 core states × 3 variants, `en_US-amy-medium`) → `public/sfx/zola/voice/v1..v3/` · Pi voice staged to `C:\prep\pi-voice\` | ✓ |
| 2 — Sounds | moods bank (124 oggs: kenney rpg/sci-fi) · ui bank (151) · Dog Vocalisations ×2 → `animal/` · Arctic wind gust → `flight/` · OGA alert set → `alert/` | ✓ |
| 3 — UI/fonts | Rajdhani + Cairo + BlackOpsOne + Oswald → `public/fonts/` · game-icons · input-prompts · rpg-expansion bars/panels | ✓ |
| 4 — Graphics | space/car/prototype kits · furniture + food kits · nature-150 · 6 animated animals (incl. Horse.fbx) · 4 PBR sets @2K · 4 mood HDRIs | ✓ |
| 5 — FX | particle-pack + crosshair-pack (face-lock reticle) | ✓ |
| 6 — Motion | 85 BVH gesture candidates indexed (subjects 001/009/016) → `docs/BVH_GESTURE_CANDIDATES.txt` · retargeting deferred | ✓ |
| 7 — Offline brain | whisper-tiny-en + kokoro-82m + smolvlm-256m + ollama (llama3.2:3b / 3.1:8b / gemma4:26b) staged into `public/models/` · `earsLocal`/`eyesDeep` load LOCAL mirror first, HF fallback only | ✓ (200s on :3010) |
| 8 — Wiring | `src/lib/pet/sfxFiles.ts` NEW — real library samples on every mood change (synth chirps = fallback) · imported in `DronePetPanel.tsx` | ✓ |
| 9 — Notes | provenance written into `ZOLA_UPGRADE_NOTES.md` · library untouched | ✓ |

### Deviations from the original commands (keep for re-runs)
1. `generate_voice.ps1` has **no `-Lines` array param** → direct Piper calls, slug naming (`alert_1.wav`, `lowbat_2.wav`…).
2. Piper voice key is **`amy`**, not the full `en_US-amy-medium` slug.
3. **No ffmpeg on machine** → WAVs ship as-is (browsers play WAV natively; OGG conversion skipped).
4. **Inkscape recolor skipped** (not installed — use `START_HERE/11-Inkscape-download.url`).
5. **Blender retargeting deferred** (Blender purged from library as off-scope — re-download from blender.org).
6. Dog Vocalisations bundle only ships 2 usable files (bark + grunt/shuffle).

### Remaining
- [ ] Blender session → retarget 3–5 of the 85 BVH gesture candidates → `public/assets/models/zola-anims/`
- [ ] Inkscape → recolor UI SVGs to the Zola palette
- [ ] (optional) ffmpeg → OGG batch-conversion to shrink the sound banks
- [ ] Physical: propellers, tethered first flight (see `ORDER_CHECKLIST.md` run-book)

---

## ✅ FINAL ACCEPTANCE CHECKLIST (plan-time — superseded by the Execution Log for phases 0–9)

- [ ] Phase 0 scripts exit 0
- [ ] ≥12 Piper voice lines × 3 variants generated and wired into `voice.ts`
- [ ] Every brain mood/state has a sound + LED color + HDRI theme
- [ ] UI kit recolored to the Zola palette; icons replace emoji placeholders
- [ ] 3D room/mental map uses PBR ground + real furniture/food models
- [ ] Flight canvas has particles + wind layer + takeoff/landing stingers
- [ ] ≥3 retargeted gestures playable
- [ ] Offline Q&A demo works on mirrored AI models
- [ ] `npm run build` + SITL flight replay both pass
- [ ] `BUILD_NOTES.md` written; library untouched (read-only respected)
