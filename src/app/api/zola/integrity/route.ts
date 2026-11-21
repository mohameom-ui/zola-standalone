import { createHash } from "crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

// ============================================================================
// ZOLA LOCAL ASSET INTEGRITY CHECK — verifies local runtime assets against
// they should be. SHA-256 of every trust-critical local file (bundle, ORT
// runtimes, model configs + weights, voice bins, gesture GLBs' config files),
// compared against a stored baseline. First run establishes the baseline;
// later runs report OK / DRIFT (a present file changed — investigate) /
// INCOMPLETE (assets not provisioned yet; each one is listed in `missing`).
// Purely local: reads her own disk, writes one JSON next to the app.
// ============================================================================

const BASELINE = path.join(process.cwd(), ".zola-integrity.json");

const CRITICAL: string[] = [
  "public/vendor/kokoro.web.js",
  "public/vendor/ort/ort-wasm-simd-threaded.jsep.mjs",
  "public/vendor/ort/ort-wasm-simd-threaded.jsep.wasm",
  "public/vendor/ort/ort-wasm-simd-threaded.mjs",
  "public/vendor/ort/ort-wasm-simd-threaded.wasm",
  "public/mediapipe/wasm/vision_wasm_internal.wasm",
  "public/models/kokoro-82m/config.json",
  "public/models/kokoro-82m/onnx/model_quantized.onnx",
  "public/models/kokoro-82m/tokenizer.json",
  "public/models/kokoro-82m/voices/af_heart.bin",
  "public/models/whisper-tiny-en/config.json",
  "public/models/mediapipe/face_landmarker.task",
  "public/models/mediapipe/hand_landmarker.task",
  "public/models/mediapipe/efficientdet_lite0.float16.tflite",
];

// HER BODY — the movement library and every 3D model her world loads are
// trust-critical too: a swapped clip is a different pet. Discovered at audit
// time, so new clips (the walk cycle, the next twenty) are guarded the day
// they are added — no manifest edits to forget.
const MODEL_DIR = "public/assets/models";
const modelRoot = path.join(process.cwd(), MODEL_DIR);
if (existsSync(modelRoot)) {
  for (const rel of readdirSync(modelRoot, { recursive: true }) as string[]) {
    if (rel.endsWith(".glb")) {
      CRITICAL.push(`${MODEL_DIR}/${rel.split(path.sep).join("/")}`);
    }
  }
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(file);
    s.on("data", (d) => h.update(d));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}

export async function GET() {
  const root = process.cwd();
  const results: Record<string, string> = {};
  const missing: string[] = [];
  for (const rel of CRITICAL) {
    const abs = path.join(/*turbopackIgnore: true*/ root, rel);
    if (!existsSync(abs)) { missing.push(rel); continue; }
    results[rel] = await sha256(abs);
  }

  let verdict: "BASELINE_CREATED" | "OK" | "DRIFT" | "INCOMPLETE" = "BASELINE_CREATED";
  const drifted: string[] = [];
  if (existsSync(BASELINE)) {
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, string>;
    verdict = "OK";
    for (const [rel, hash] of Object.entries(results)) {
      if (base[rel] && base[rel] !== hash) { verdict = "DRIFT"; drifted.push(rel); }
    }
    // Absent files are reported in `missing`, not as tampering. A clean
    // checkout has no public/models/ (gitignored) — calling that "drift"
    // trains people to ignore the warning that matters.
    if (verdict === "OK" && missing.length > 0) verdict = "INCOMPLETE";
    // the baseline GROWS: newly added trust-critical files are baselined at
    // first sight (previously a static baseline meant new assets flew blind)
    const merged = { ...base };
    let grew = false;
    for (const [rel, hash] of Object.entries(results)) {
      if (!(rel in merged)) { merged[rel] = hash; grew = true; }
    }
    if (grew) writeFileSync(BASELINE, JSON.stringify(merged, null, 2));
  } else {
    writeFileSync(BASELINE, JSON.stringify(results, null, 2));
  }

  return Response.json({
    verdict,
    checked: Object.keys(results).length + missing.length,
    missing,
    drifted,
    checkedAt: new Date().toISOString(),
  });
}
