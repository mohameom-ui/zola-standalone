#!/usr/bin/env node
// ============================================================================
// ZOLA — provision the local sentence embedder (~23 MB).
//
//   node Scripts/fetch-embedder.mjs
//
// Downloads MiniLM into public/models/all-MiniLM-L6-v2/, where the browser
// loads it with remote fetching disabled. Run once per machine; the app works
// without it (lexical recall), just less semantically.
// ============================================================================

import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const REPO = "Xenova/all-MiniLM-L6-v2";
const BASE = `https://huggingface.co/${REPO}/resolve/main/`;
const DEST = join(process.cwd(), "public", "models", "all-MiniLM-L6-v2");

const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

let total = 0;
for (const file of FILES) {
  const url = BASE + file;
  const out = join(DEST, file);
  await mkdir(dirname(out), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`failed ${file}: HTTP ${res.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  total += buf.length;
  console.log(`${file.padEnd(32)} ${(buf.length / 1048576).toFixed(1)} MB`);
}
const model = await stat(join(DEST, "onnx", "model_quantized.onnx"));
console.log(`\nready: ${DEST}`);
console.log(`model: ${(model.size / 1048576).toFixed(1)} MB · total downloaded ${(total / 1048576).toFixed(1)} MB`);
