// Live brain benchmark against a real Ollama server. Skipped unless asked:
//
//   ZOLA_BENCH=1 npx vitest run src/lib/pet/brainBench.live.test.ts
//   ZOLA_BENCH=1 ZOLA_BENCH_MODEL=llama3.1:8b npx vitest run …
//
// CI has no model, so this is a bench tool wearing a test's clothes.

import { describe, expect, it } from "vitest";
import { BRAIN_CASES, runBrainBench } from "./brainBench";
import { parsePlan } from "./planning";
import { PLAN_PROMPT } from "./llm";

const ENABLED = process.env.ZOLA_BENCH === "1";
const suite = ENABLED ? describe : describe.skip;

const BASE = process.env.ZOLA_OLLAMA ?? "http://127.0.0.1:11434";

async function pickModel(): Promise<string | null> {
  if (process.env.ZOLA_BENCH_MODEL) return process.env.ZOLA_BENCH_MODEL;
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name: string }[] };
    const names = (data.models ?? []).map((m) => m.name);
    const prefs = [/llama3\.1:8b/i, /qwen2\.5.*7b/i, /llama3\.2:3b/i, /qwen2\.5/i];
    for (const p of prefs) {
      const hit = names.find((n) => p.test(n));
      if (hit) return hit;
    }
    return names[0] ?? null;
  } catch {
    return null;
  }
}

async function classify(model: string, text: string): Promise<string | null> {
  const prompt = `${PLAN_PROMPT}\n\nContext: bench run. No camera, no flight.\nUser: ${text}\nJSON:`;
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0, num_predict: 80 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { response?: string };
  return parsePlan(data.response ?? "")?.action ?? null;
}

suite("brain benchmark (live Ollama)", () => {
  it("scores the installed brain", async () => {
    const model = await pickModel();
    expect(model, "no Ollama model found — start Ollama and pull a model").not.toBeNull();
    if (!model) return;

    const report = await runBrainBench((text) => classify(model, text));

    console.log(`\nmodel: ${model}`);
    console.log(`accuracy: ${(report.accuracy * 100).toFixed(1)}% (${report.correct}/${report.total})`);
    console.log(
      `latency: p50 ${Math.round(report.latency.p50Ms)} ms · p95 ${Math.round(report.latency.p95Ms)} ms`,
    );
    for (const f of report.failures) console.log(`  miss: "${f.text}" expected ${f.expected}, got ${f.got}`);

    expect(report.total).toBe(BRAIN_CASES.length);
    // a competent brain should beat a coin flip on this fixed set
    expect(report.accuracy).toBeGreaterThan(0.5);
  }, 300_000);
});
