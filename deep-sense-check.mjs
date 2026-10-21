// DEEP-SENSE CHECK — point her optic cortex at a real frame and hear what
// she sees. Mirrors ollamaVision()'s exact contract (model preference scan →
// /v1/chat/completions with a data-URL image) against her own Ollama.
//
// Run: node deep-sense-check.mjs [image.png]
const fs = await import("node:fs/promises");

const image = process.argv[2] ?? "Saved/hangar_pet.png";

// 1. the vision-brain candidate list — same order as src/lib/pet/llm.ts;
// a manifest can lie, so each candidate is tried until one ANSWERS
const tags = await (await fetch("http://localhost:11434/api/tags")).json();
const prefs = [/llama3\.2-vision/i, /llava/i, /moondream/i, /minicpm-v/i, /qwen.*vl/i];
const candidates = [];
for (const p of prefs) {
  const hit = (tags.models ?? []).find((m) => p.test(m.name));
  if (hit && !candidates.includes(hit.name)) candidates.push(hit.name);
}
if (!candidates.length) { console.log("no vision brain installed — honest refusal is the correct behavior"); process.exit(1); }

// 2. the frame → base64 data URL
const buf = await fs.readFile(image);
const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
console.log(`frame: ${image} (${(buf.length / 1024).toFixed(0)} KB)`);

// 3. the deep-sense call — her optical cortex, walking the candidate list
let answer = null;
for (const model of candidates) {
  console.log(`trying vision brain: ${model}`);
  const res = await fetch("http://localhost:11434/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: "30m",
      max_tokens: 80,
      messages: [
        { role: "system", content: "You are Zola's optical cortex. Answer in one short line, no preamble." },
        { role: "user", content: [
          { type: "text", text: "Identify the main object in this image in one short line. Be precise, include brand/type if visible." },
          { type: "image_url", image_url: { url: dataUrl } },
        ] },
      ],
    }),
  });
  if (!res.ok) { console.log(`  ${model} cannot load (HTTP ${res.status}) — next brain`); continue; }
  const d = await res.json();
  const line = (d.choices?.[0]?.message?.content ?? "").trim();
  if (line) { answer = line; break; }
}
console.log(answer ? `she sees: ${answer}` : "no working vision brain answered — the honest null");
