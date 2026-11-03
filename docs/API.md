# ZOLA — Complete API & Database Endpoint Map

The merged, live spec of every route she serves. Every route is
**pair-authenticated** (`isPaired`) unless noted — an unpaired caller gets
401. Everything returns what is REAL; a down service reads `down`, a stale
ledger reports its age, a missing manifest is a 404 with the repair command.

## The routes

| Route | Method | Purpose | Backed by |
|---|---|---|---|
| `/api/zola/status` | GET | System snapshot: version, cognitive tier (Ollama), the five live services, shelf count, pairing | live probes (:11434, :3001–3004, :6006) |
| `/api/zola/policies` | GET | Her training shelf, served LIVE from disk — one entry per skill, best run by smoothed peak; new training rounds appear without a rebuild | `isaac/policies/*.json` manifests |
| `/api/zola/policies/train` | POST | Trigger a training round. Body `{"task": "sit"}` (defaults to sit); proxies to the trainer console, which owns the Isaac process lifecycle | trainer-console :3002 `POST /start` |
| `/api/zola/physics/verify` | POST | The independent MuJoCo twin verdict: every canon pose, is it physically holdable or does she topple | `Scripts/pose_physics_check.py` (system python + mujoco) |
| `/api/zola/chassis/specs` | GET | The parametric 3D-print body: per-part millimeter dims, Ender 3 Max Neo (300×300×300) fit verdict computed per part | `Saved/print/zola-v12/dimensions.json` |
| `/api/zola/defense/audit` | GET | The defensive ledger: Defender, firewall, listening ports, new processes, disk — with the ledger's age reported honestly | `Saved/defense-watch-state.json` |
| `/api/zola/pair` | GET | Pair-token disclosure — **desktop operator only** (a LAN device's Host header is an IP and gets 404) | `lib/pet/pairing` |
| `/api/zola/integrity` | GET | SHA-256 integrity of every trust-critical local asset (bundle, ORT runtimes, model configs + weights, voice bins, gesture configs) | local runtime assets |
| `/api/zola/pack` | GET | The forge's capability pack (requires `ZOLA_FORGE_HOME`; 500 without it, never a hardcoded fallback) | the forge home |

## The database layer

Zola has no traditional database — her persistence is **files as the source
of truth**, each written by the engine that owns it:

| Store | Owner | Consumers |
|---|---|---|
| `isaac/policies/*.json` + `.onnx` | `export_policy_onnx.py` (drift-gated) | policies route, the brain's shelf (`isaacPolicies.ts`) |
| `isaac/logs/rsl_rl/**/run.json` + frozen `params/` | Isaac Lab training runs | the shelf's provenance, the training record |
| `isaac/zola_isaac/assets/zola_prototype.json` | the canon physics profile (SHA-pinned) | Isaac, MuJoCo twin, the body map, the print exporter |
| `Saved/print/zola-v12/dimensions.json` | `Scripts/print_export_v12.py` | chassis route, the Ender 3 print package |
| `Saved/defense-watch-state.json` | `Scripts/defense-watch.mjs` | defense route, the defense watch UI (:3004) |
| `Saved/debug/*.json` | `Scripts/debug-engine.mjs` | the debug report (:3003) |

## The canon pose sync rule

`Scripts/pose_physics_check.py` mirrors `env_cfg.py`'s expression library
(SIT, HERO, FLIGHT, THUMBS, PICTURE). The mirrors are the same offsets by
contract — synced 2026-11-03 to the sit_v10 canon (knee 0.55) and the
touchdown_v9 frozen params (knee 0.45). When a pose changes in training,
the mirror changes in the same commit.
