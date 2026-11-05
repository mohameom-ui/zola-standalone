// SELF-BUILDER, LIVE — the full loop with her REAL brain: Ollama writes a
// capability for a task, the AST gate judges it, the sandbox runs it.
// Skips silently when her Ollama is offline (unit tests already prove the
// gate; this proves the ORGAN — brain → gate → registry → execution).
//
// Run: npx vitest run src/lib/pet/selfBuilder.live.test.ts
import { describe, it, expect } from "vitest";
import { parseSelfBuild, validateCapability, installCapability, normalizeDraft } from "./selfBuilder";

const OLLAMA = "http://localhost:11434";
let online = false;
try { online = (await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) })).ok); } catch { online = false; }

describe.skipIf(!online)("the self-builder in the wild (needs her Ollama)", () => {
  // 240s: a LIVE end-to-end round trip through her Ollama brain — which
  // shares the GPU with Isaac training, so generation slows while she
  // trains. The 90s limit was a false FAIL under GPU contention.
  it("her brain writes a capability, the gate passes it, the sandbox runs it", { timeout: 240_000 }, async () => {
    // pick her working text brain — same preference as LlmConsultant
    const tags = await (await fetch(`${OLLAMA}/api/tags`)).json() as { models?: { name: string }[] };
    const prefs = [/llama3\.1:8b/i, /llama3\.2:3b/i, /qwen2\.5/i, /mistral/i, /gemma/i];
    let model: string | null = null;
    for (const p of prefs) {
      const hit = (tags.models ?? []).find((m) => p.test(m.name));
      if (hit) { model = hit.name; break; }
    }
    if (!model) return; // no text brain — nothing to prove here
    console.log(`self-builder brain: ${model}`);

    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.4, num_predict: 300 },
        messages: [
          { role: "system", content:
            `You are Zola, a drone pet that can write NEW capabilities for itself. Output strictly JSON: {"action":"build:<short-name>","code":"..."}. ` +
            `The code is a JavaScript function BODY receiving an "args" object and returning a STRING. Pure computation only: math, strings, arrays. ` +
            `No network, no imports, no eval — the sandbox is an allowlist and rejects anything else. Under 25 lines.` },
          { role: "user", content: "Build a capability: given args.celsius, return the temperature in fahrenheit as a string like '107.6°F'." },
        ],
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as { message?: { content?: string } };
    const raw = (data.message?.content ?? "").trim();
    const parsed = JSON.parse(raw) as { action?: string; code?: string };
    let build = parseSelfBuild(parsed.action ?? "", parsed.code);
    expect(build).not.toBeNull(); // her brain spoke the build protocol

    // THE SELF-CORRECTION LOOP — a real self-builder proposes, gets judged,
    // and FIXES ITS OWN DRAFT from the gate's error report (up to 2 retries)
    let errors = validateCapability(normalizeDraft(build!.code));
    let attempt = 0;
    while (errors && attempt < 2) {
      attempt += 1;
      console.log(`gate rejected her draft (attempt ${attempt}): ${errors.join("; ")}`);
      console.log(`her draft was: ${build!.code.slice(0, 200)}`);
      const fix = await fetch(`${OLLAMA}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format: "json",
          options: { temperature: 0.3, num_predict: 300 },
          messages: [
            { role: "system", content:
              `You are Zola. Fix your capability draft. Output strictly JSON: {"action":"build:<short-name>","code":"..."}. ` +
              `The code is a JavaScript function BODY receiving "args", returning a STRING. Plain JavaScript only: literals, variables, if/else, loops, Math, String/Number/Array methods. No network, no imports, no eval.` },
            { role: "user", content: `Task: given args.celsius, return the temperature in fahrenheit as a string like '107.6°F'.\nYour rejected draft:\n${build!.code}\nThe sandbox rejected it: ${errors.join("; ")}. Return the corrected code.` },
          ],
        }),
      });
      const fd = await fix.json() as { message?: { content?: string } };
      const fp = JSON.parse((fd.message?.content ?? "").trim()) as { action?: string; code?: string };
      build = parseSelfBuild(fp.action ?? parsed.action ?? "", fp.code);
      if (!build) break;
      errors = validateCapability(normalizeDraft(build.code));
    }
    expect(errors).toBeNull(); // her brain, corrected by her own gate, passes

    let captured: { run: (args: Record<string, unknown>) => string } | null = null;
    const ok = installCapability(
      { id: build!.id, label: build!.label, description: "live self-build", code: build!.code, createdAt: new Date().toISOString(), task: "celsius to fahrenheit" },
      (cap) => { captured = cap as typeof captured; },
    );
    expect(ok).toBe(true);
    const out = captured!.run({ celsius: 42 });
    expect(out).toMatch(/10[0-9](\.\d+)?°F/); // 42°C → 107.6°F — REAL math from HER brain
    console.log(`self-built capability "${build!.label}" ran live: ${out}`);
  });
});
