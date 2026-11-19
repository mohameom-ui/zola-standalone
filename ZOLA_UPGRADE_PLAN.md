# 📋 ZOLA UPGRADE PLAN — v2 (re-created after filename collision with the other session's plan)

**Date:** 2026-10-18
**Library:** C:\GameDevLibrary (~98 GB after full restoration — see AUDIT.md)
**Target:** ZOLA — Drone AI Pet (web brain `src/lib/pet/`, relay `bridge/aura_relay.py`)

## Material status — RESOLVED
The "missing" 30+ GB was never deleted: `C:\GameDevAssets\` is the original
complete collection; the library was an incomplete copy. Everything has been
returned (robocopy, 0 failures) — **dog vocalisations now exist on disk.**
Full story in `C:\GameDevLibrary\AUDIT.md` (✅ RESOLVED entry).

## Verified available material
- ✅ GDC2026 Dog Vocalisations Vol. 1 (her animal-side reactions)
- ✅ GDC2024 Sonniss 28 GB + GDC2023 19 GB (wind/bird/ambience — Sonniss
  license note: royalty-free-FOR-GAMES; kept out of her lines pending owner call)
- ✅ Kenney audio packs ×9 (CC0 — all feedback sounds)
- ✅ Kenney UI/2D/FX packs, furniture/food kits, PBR 2K+8K, HDRIs
- ✅ Piper 16 voices + generate_voice.ps1
- ✅ CMU MoCap 2,548 BVH restored

## Plan — impact × effort (proposed order)

| Slice | Upgrade | Impact | Effort | Material |
|---|---|---|---|---|
| **2. Voice** | Pick Piper voice (`en_US-amy-medium` recommended; test `en_GB-alba`, `en_US-hfc_female`), generate 3-variant personality line pack via generate_voice.ps1, provision `.onnx`+`.json` to Pi path, share line tables with `voice.ts` (browser keeps Kokoro) | ★★★ | MED | Piper ✓ |
| **3. Sound** | Mood/state feedback from Kenney CC0 packs + **GDC2026 Dog Vocalisations** (her animal reactions now unblocked!): happy→chirp, alert→two-tone, scared→low, takeoff/landing, low-battery, UI clicks — mixed quiet | ★★★ | LOW | ✓ |
| **4. UI & identity** | Kenney UI-pack panels/buttons, game-icons mood/status icons, identity font (Rajdhani HUD / Cairo), particle feedback in flight canvas | ★★ | MED | ✓ |
| **5. World view** | Mental map + room: PBR floor (Ground037), HDRI (spruit_sunrise), furniture/food-kit props as remembered objects, consistent map legend | ★★ | MED-HIGH | ✓ |
| **6. Flight polish** | SITL-integrated: takeoff/landing stingers, altitude wind layer (GDC2023), "returning home" line on the approach state machine. Acceptance = one full SITL flight | ★★ | MED | ✓ |

## Verification gates
- `npm run build` passes; `npx vitest run` passes (225 tests passing, 1 skipped, verified 2026-11-19)
- Behavior demonstrated live: browser (Slices 2-5), full SITL loop (Slice 6)
- `ZOLA_UPGRADE_NOTES.md` updated with library paths + Pi-destined files

## Escalations / notes
1. Filename collision: the other session overwrote `UPGRADE_PLAN.md` — this
   file (`ZOLA_UPGRADE_PLAN.md`) is the canonical Zola plan. UPGRADE_NOTES.md
   was also overwritten → canonical log is `ZOLA_UPGRADE_NOTES.md`.
2. Sonniss license firewall stands (see DRONE_PET.md) — GDC2023/2024/2026
   material stays out of her shipped voice lines until the owner rules on
   companionship use.
