#!/usr/bin/env node
// ============================================================================
// ZOLA — semantic recall bench (real model, real files, no mocks)
//
//   node Scripts/fetch-embedder.mjs     # once
//   node Scripts/semantic-bench.mjs
//
// Proves that paraphrases reach the right memory: "spectacles" must find the
// glasses, "what do I drink" must find the coffee, and unrelated queries must
// stay below the relevance floor.
// ============================================================================

import { pipeline, env } from "@huggingface/transformers";
import { join } from "node:path";

env.allowRemoteModels = false; // local weights only — same rule as the app
env.allowLocalModels = true;
env.localModelPath = join(process.cwd(), "public", "models") + "/";

const embed = await pipeline("feature-extraction", "all-MiniLM-L6-v2", { dtype: "q8" });

const MEMORIES = [
  "my glasses are usually on the desk next to the lamp",
  "dentist appointment tomorrow at nine",
  "you like your coffee black with no sugar",
  "the mug lives in the kitchen cupboard",
  "task find my cup ended failed: I could not find the cup",
];

const QUERIES = [
  { q: "where are my spectacles", expect: "glasses" },
  { q: "what do I drink in the morning", expect: "coffee" },
  { q: "when is my dental appointment", expect: "dentist" },
  { q: "why did you fail to find the cup", expect: "cup" },
  { q: "quantum chromodynamics lecture", expect: null },
];

async function vec(text) {
  const out = await embed(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

const memVecs = await Promise.all(MEMORIES.map(vec));
const cos = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

let pass = 0;
for (const { q, expect } of QUERIES) {
  const qv = await vec(q);
  const ranked = MEMORIES.map((text, i) => ({ text, score: cos(qv, memVecs[i]) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const ok = expect === null ? top.score < 0.3 : top.text.includes(expect);
  pass += ok ? 1 : 0;
  console.log(`${ok ? "PASS" : "FAIL"}  "${q}"  ->  ${top.score.toFixed(3)}  ${top.text.slice(0, 48)}`);
}

console.log(`\n${pass}/${QUERIES.length} semantic expectations met`);
process.exit(pass === QUERIES.length ? 0 : 1);
