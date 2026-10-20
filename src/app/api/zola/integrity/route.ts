import { createHash } from "crypto";
import { createReadStream, existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

// ============================================================================
// ZOLA AIR-GAP INTEGRITY AUDITOR — proves her offline assets are exactly what
// they should be. SHA-256 of every trust-critical local file (bundle, ORT
// runtimes, model configs + weights, voice bins, gesture GLBs' config files),
// compared against a stored baseline. First run establishes the baseline;
// later runs report OK / DRIFT (file changed — investigate) / MISSING.
// Purely local: reads her own disk, writes one JSON next to the app.
// ============================================================================

const BASELINE = path.join(process.cwd(), ".zola-integrity.json");

const CRITICAL: string[] = [
  "public/vendor/kokoro.web.js",
  "public/vendor/ort/ort-wasm-simd-threaded.jsep.mjs",
  "public/vendor/ort/ort-wasm-simd-threaded.jsep.wasm",
  "public/vendor/ort/ort-wasm-simd-threaded.mjs",
  "public/vendor/ort/ort-wasm-simd-threaded.wasm",
  "public/vendor/ort-kokoro/ort-wasm-simd-threaded.jsep.mjs",
  "public/vendor/ort-kokoro/ort-wasm-simd-threaded.jsep.wasm",
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
    const abs = path.join(root, rel);
    if (!existsSync(abs)) { missing.push(rel); continue; }
    results[rel] = await sha256(abs);
  }

  let verdict: "BASELINE_CREATED" | "OK" | "DRIFT" = "BASELINE_CREATED";
  const drifted: string[] = [];
  if (existsSync(BASELINE)) {
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, string>;
    verdict = "OK";
    for (const [rel, hash] of Object.entries(results)) {
      if (base[rel] && base[rel] !== hash) { verdict = "DRIFT"; drifted.push(rel); }
    }
    for (const rel of Object.keys(base)) {
      if (!(rel in results)) { verdict = "DRIFT"; drifted.push(rel + " (missing)"); }
    }
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
