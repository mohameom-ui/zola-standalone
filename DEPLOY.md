# 🚀 ZOLA — Pi Deployment Manifest (the razor-sharp footprint)

Her Pi deployment is `scp`/`git clone` of a folder — so **what sits in that folder
IS her footprint**. This manifest defines what belongs, what stays home, and why.

Measured 2026-10-18 after the trim pass. Everything not listed as "STAYS HOME"
is part of her runtime body.

## ✈️ FLIES TO THE PI (~1.4 GB + models)

| Path | Size | Why she needs it |
|---|---|---|
| `src/` `bridge/` `public/` (minus noted) `package.json` `next.config.ts` `postcss.config.mjs` `tsconfig.json` | code | the app + MAVLink relay |
| `pi-setup.sh` `pi-dayone.sh` `deploy-to-pi.sh` | scripts | one-command deploy + the 11-check acceptance |
| `public/models/` | **25 GB*** | her offline brain: whisper (ears), kokoro (voice), smolvlm (eyes), ollama GGUFs (mind). *Size is deliberate — she is 100% offline |
| `public/sfx/` | 127 MB | her sound bank (moods/UI/animal/flight/alert) |
| `public/assets/models/zola-anims/` | ~331 MB | her 20 gestures incl. the walk cycle (kiosk plays them) |
| `public/voices/` | 12 MB | Piper line pack + manifest |
| `public/assets/ui/zola-svg/` | 1.9 MB | her HUD vector kit (kept: trivial disk, real future use) |
| `public/fonts/` `public/mediapipe/` | small | identity fonts + face/hand/object models |

Deploy command (from the desktop, replacing the naive full-folder copy):

```bash
bash deploy-to-pi.sh                 # sync + build + instructions, one command
# or the long form:
rsync -av --exclude-from deploy-excludes.txt ./ pi@zola.local:~/zola/
ssh pi@zola.local "cd ~/zola && npm install && npm run build"
ssh pi@zola.local "bash pi-setup.sh"
```

## 🏠 STAYS HOME (build-time only — never copied)

| Path | Size | Why |
|---|---|---|
| `Tools/blender/` | **929 MB** | gesture-pipeline build tool. The GLBs are built; Blender isn't needed on her body |
| `assets_src/rig/` | 33 MB | retargeting source material |
| `.next/` `node_modules/` | 552 MB + ~1 GB | rebuilt on the Pi by `pi-setup.sh` (`npm install && npm run build`) |
| `Scripts/retarget_bvh.py` `Scripts/recolor_ui.mjs` `docs/` `*.md` `Saved/` `.zola-pair` | small | provenance, build recipes, scratch captures, the desktop relay's pair token — nothing her body needs (keep in git, not on her body) |

## ✂️ TRIMMED IN THIS PASS

- `ai_voice_test.wav` — stray voice-test artifact (removed)
- `zola-dev-verify.log`, `zola-standalone.log`, `zola-server.log` — runtime logs (removed; regenerated)

## 🚫 REFUSED — with reasons (integrity audit of the trim proposal)

1. **"Remove SimDroneHAL mock fallbacks" — REFUSED.** SimDroneHAL is not a mock
   generator: it is the other half of the dual-HAL contract, hooked into the live
   `bodyMode` sim/real toggle (DronePetPanel line ~83). It is her SITL test rig,
   her training environment, and the reason the MAVLink swap is a single
   abstraction change. Removing it would break the parity contract.
2. **"Trim the 434 SVG kit" — DECLINED (measured: 1.9 MB total).** Zero runtime
   cost — static files served on demand cost disk only, and the kit is her HUD
   identity for the Pi kiosk. Trimming it would save 0.14% of one gesture GLB.
3. **"25 GB models" — REVIEWED, KEPT.** The mirror includes multiple Ollama brains
   (llama3.2:3b, llama3.1:8b, gemma). If SD-card space is tight, keep
   `llama3.2:3b` + `whisper-tiny-en` + `kokoro-82m` + `smolvlm-256m` (~4 GB total)
   and drop the 8B — she auto-picks the biggest installed brain either way.
   NOT trimmed automatically: her brain size is a human decision.
