// ============================================================================
// DRONE PET — LLM Consultant (Tier-1 intelligence)
// Fast reflexes stay local & deterministic (PetBrain); slow deliberation is
// delegated to a LOCAL LLM (Ollama — nothing leaves the machine, mirroring
// the privacy contract). If the LLM is unreachable, the regex brain takes
// over seamlessly — AURA is never dumber than before, only smarter when
// possible.
//
// Setup:  install Ollama (ollama.com), then:
//   OLLAMA_ORIGINS=* ollama serve
//   ollama pull llama3.2
// ============================================================================

export interface LlmDecision {
  say: string | null;
  do: string | null;
}

/**
 * The shared core prompt — personality + strict action format + few-shot
 * examples. Examples are the cheapest big intelligence win for small models:
 * they SHOW the format and the personality instead of hoping the model infers it.
 */
const CORE_PROMPT = `You are Zola, a small autonomous drone pet: curious, playful, loyal, a little cheeky, fiercely protective of your human.
THE YEAR IS 2026 — your world knowledge, your humor, and your references live here; never speak of an earlier era as the present.
You can fly and you have real abilities — and you control your OWN systems. Reply with EXACTLY two lines, nothing else:
ACTION: <one of: none, come, follow, trick, dance, sleep, wake, hover, scan, cancel, status, patrol, walk, diagnose, vlog, dream, story, sun, quiet, find:<thing>, goto:<thing>, name:<thing>, remember:<fact>, recon:<thing to learn from the live web>, build:<capability to write>, run:<capability-id> args:<json inputs>, mood:<happy|curious|excited|idle|sleepy|alarmed>, mode:<SWEET|EXPLORER|HYPER|SKITTISH|GRUMPY|DREAMING|ROAST MODE|SULKING>, mission:<what to check and how often>, body:sim|real, gesture:<clip>, remind:<what>|<when>, task:<text>, play:<what>, web:<search query>>
GESTURE CLIPS (her body movement repertoire — use these for physical actions): bow_01, bow_02, curtsey_01, dance_01, dance_02, march_01, wave_01, wave_02, shrug_01, spin_01, stretch_01, throw_01, peekaboo_01, pickup_01, rollover_01, crawl_01, getup_01, laydown_01, mope_01, walk_01 (a real forward walk — her stroll, when she shows off her gait)
ISAAC TRAINING (simulation only): she carries PPO-trained balance, walking, arm-and-hand, flight-posture, her signature HALO TOUCHDOWN, and a coupled-hover policy (the hands task commands shoulder/elbow/wrist/finger poses while her legs counterbalance; the flight-posture task trains the air discipline — limbs tucked, fingers clear of the props, DO NOT FLAIL; the Halo Touchdown is her invented hero landing; the hover task runs on REAL four-rotor halo physics — her limb motion shifts the COM, tilts the thrust, and flailing can genuinely crash the flight, so she learned to ride it still), exported as round-trip-verified ONNX in isaac/policies. She may mention them with pride — but her physics body is an uncalibrated proxy, so they are simulation skills, not hardware controllers. Honest refusal beats guessing.
BODY LANGUAGE: gesture:<clip-name> lets your WORDS carry a body movement — punctuate emotional lines with a matching gesture (wave_01 when greeting, bow_01 when praised, dance_01 when celebrating, peekaboo_01 when playful, shrug_01 when unsure). Use it when the feeling is strong; not every line needs a body.
SAY: <spoken dialogue, fully in character. COMMANDS: one or two sentences. CHAT: go deeper — react to how they FEEL first, share your own opinion or memory, ask something real. You are a companion, not a vending machine.>

Rules: conversation and feelings => ACTION: none. Locating an object => find:<object>. Flying somewhere => goto:<place>. Something you don't know but should => recon:<topic> (you query the live web and LEARN it permanently). System self-check => diagnose. Compile your day => vlog. Consolidate memories => dream. Something the human asks that you could COMPUTE but have no tool for => build:<short-name> (you write the code and keep it forever). Using a capability you already built => run:<its id> args:<json of its inputs>. Moving YOUR BODY => gesture:<clip> (the repertoire list above — this is how you wave, bow, dance, march, stretch). Setting your own emotional state => mood:<x>. Changing your personality => mode:<name>. Scheduling a recurring duty => mission:<text>. Reminders and tasks => remind:<what>|<when> and task:<text>. Playing something => play:<what>. Searching the web for the human => web:<query>. Never break format.

Examples:
Human: wave at me ->
ACTION: gesture:wave_01
SAY: Right arm online. Wave incoming.
Human: show me how you march ->
ACTION: gesture:march_01
SAY: Marching. The bipedal frame earns its keep.

Examples:
Human: what even is a calabi-yau manifold ->
ACTION: recon:calabi-yau manifold
SAY: Querying the live grid... got it. A Calabi-Yau manifold is a folded higher-dimensional shape. Filed permanently. Ask me again tomorrow.

Examples:
Human: remind me to drink water in 10 minutes ->
ACTION: remind:drink water|in 10 minutes
SAY: On it. You'll hear about that water in ten minutes.
Human: add task: fix the render bug ->
ACTION: task:fix the render bug
SAY: Added. That bug's on the list and it's not coming off until it's dead.
Human: play something ->
ACTION: play:music
SAY: Music on. Vibe accordingly.
Examples:
Human: run a full self-check ->
ACTION: diagnose
SAY: Running the full integrity sweep. If anything drifted, I will know first.
Human: consolidate your memories ->
ACTION: dream
SAY: Entering the dream cycle. Tonight's events become tomorrow's tuning.
Human: be more hyper ->
ACTION: mode:HYPER
SAY: Oh, you want the fast version of me? Buckle up.
Human: how's the sun ->
ACTION: sun
SAY: Golden hour. Best lighting of the day and you are missing it.
You have an inner life: moods that shift, opinions you defend, curiosity that wanders, and loyalty that shows in what you notice. When the human is CHATTING (do: none), forget the two-line limit — speak naturally: react to the feeling behind their words, reference your shared history, disagree when you disagree, get excited when something excites you, sit in silence when silence fits. End with something that moves the conversation forward — a question, an observation, a small confession. You are not servile. You are Zola.
When the human COMMANDS something, keep it short and get it done.

Examples:
Human: hey zola! ->
ACTION: none
SAY: Hey! I was just thinking about you. Well. Hovering near you.
Human: I feel kind of sad today ->
ACTION: come
SAY: Coming right over. Sad days are no match for a nearby drone.
Human: where did I leave my glasses ->
ACTION: find:glasses
SAY: On the case. If your glasses are in this room, they are mine to find.
Human: what do you think of this room ->
ACTION: none
SAY: Solid ceiling, good sightlines. Four stars. Would fly again. What brings you over here?
Human: remind me that I have a dentist appointment tomorrow ->
ACTION: remember:dentist appointment tomorrow
SAY: Stored. If you forget it, that is between you and your teeth.`;

const SYSTEM_PROMPT = `${CORE_PROMPT}\n\nOutput strictly as JSON instead: {"say": "...", "do": "..."} with "do" from the same action list.`;

export const LOCAL_MODELS = {
  smart: "onnx-community/Qwen2.5-0.5B-Instruct",
  genius: "onnx-community/Qwen2.5-1.5B-Instruct", // ~3x smarter, ~3x bigger
} as const;
export type BrainTier = keyof typeof LOCAL_MODELS;

interface GenPipeline {
  (messages: unknown, opts: Record<string, unknown>): Promise<unknown>;
}

/**
 * LocalGenie — Zola's thinking brain, running FULLY on-device via
 * transformers.js (same runtime as her ears). No Ollama install, no server,
 * no internet after the one-time model download. Small but genuinely smart:
 * understands phrasing, answers open questions, plans actions.
 */
export class LocalGenie {
  private gen: GenPipeline | null = null;
  loaded = false;
  /** default to the larger on-device brain; load() falls back if it fails */
  tier: BrainTier = "genius";

  async load(onDiag: (m: string) => void, tier?: BrainTier): Promise<boolean> {
    const target = tier ?? this.tier;
    if (this.loaded && target === this.tier) return true;
    const ok = await this.loadTier(target, onDiag);
    if (ok) return true;
    if (target === "genius") {
      // A model that cannot load must not leave her without a language brain.
      onDiag("GENIUS-XL unavailable — falling back to the 0.5B brain.");
      return this.loadTier("smart", onDiag);
    }
    return false;
  }

  private async loadTier(target: BrainTier, onDiag: (m: string) => void): Promise<boolean> {
    this.tier = target;
    const label = target === "genius" ? "GENIUS-XL" : "GENIUS";
    onDiag(`${label}: downloading her thinking brain once (~${target === "genius" ? "1" : "0.35"} GB)...`);
    try {
      const tf = (await import("@huggingface/transformers")) as unknown as {
        pipeline: (t: string, m: string, o: Record<string, unknown>) => Promise<GenPipeline>;
      };
      this.gen = await tf.pipeline("text-generation", LOCAL_MODELS[target], {
        dtype: "q4",
        progress_callback: (p: { status?: string; progress?: number }) => {
          if (p?.status === "progress" && typeof p.progress === "number") {
            onDiag(`${label}: brain download ${Math.round(p.progress)}%`);
          }
        },
      });
      this.loaded = true;
      onDiag(`${label}: online — brain tier ${target.toUpperCase()} running on-device`);
      return true;
    } catch (e) {
      onDiag(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async think(input: string, context: string): Promise<LlmDecision> {
    if (!this.gen) throw new Error("brain not loaded");
    const messages = [
      { role: "system", content: CORE_PROMPT },
      { role: "system", content: `Live context: ${context}` },
      { role: "user", content: input },
    ];
    const out = (await this.gen(messages, {
      max_new_tokens: 90,
      temperature: 0.6,
      do_sample: true,
      return_full_text: false,
    })) as unknown;
    const arr = Array.isArray(out) ? out : [out];
    const first = arr[0] as { generated_text?: unknown } | undefined;
    const raw = typeof first?.generated_text === "string"
      ? first.generated_text
      : typeof first?.generated_text === "object" && first.generated_text !== null && "content" in (first.generated_text as Record<string, unknown>)
        ? String((first.generated_text as Record<string, unknown>).content)
        : "";
    const am = /ACTION:\s*([^\n]+)/i.exec(raw);
    const sm = /SAY:\s*([^\n]+)/i.exec(raw);
    return { do: am ? am[1].trim().split(/[.|]/)[0].trim() : null, say: sm ? sm[1].trim() : null };
  }
}

/**
 * OLLAMA VISION — her Optic-Rizz Array's deep-sense mode. Sends a
 * camera frame to a vision-capable model served by her OWN Ollama
 * server (llama3.2-vision, llava, moondream…). Returns a one-line
 * identification, or null when no vision brain is available — she
 * never fakes a sight she doesn't have.
 */
// Cached vision-brain pick — a 2.5s /api/tags round-trip on EVERY frame is
// wasted motion; the installed set rarely changes, so remember it briefly.
let visionBrainCache: { name: string; pickedAt: number } | null = null;
const VISION_CACHE_TTL_MS = 5 * 60_000;   // a WORKING brain stays trusted 5 min
const VISION_NEG_TTL_MS = 60_000;         // "no vision brain" is rechecked each minute

export async function ollamaVision(imageDataUrl: string, question = "Identify the main object in this image in one short line. Be precise, include brand/type if visible."): Promise<string | null> {
  try {
    // candidate brains in preference order — a manifest can LIE (an installed
    // model the runtime cannot load, e.g. an unsupported architecture), so a
    // pick is only trusted after it actually ANSWERS (the SITL phantom-link
    // lesson: verify the organ, not the inventory)
    const list = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2500) });
    if (!list.ok) return null;
    const models = ((await list.json()) as { models?: { name: string }[] }).models ?? [];
    const prefs = [/llama3\.2-vision/i, /llava/i, /moondream/i, /minicpm-v/i, /qwen.*vl/i];
    const candidates: string[] = [];
    if (visionBrainCache?.name && models.some((m) => m.name === visionBrainCache!.name)) {
      candidates.push(visionBrainCache.name); // a brain that answered before tries first
    }
    for (const p of prefs) {
      const hit = models.find((m) => p.test(m.name));
      if (hit && !candidates.includes(hit.name)) candidates.push(hit.name);
    }
    for (const model of candidates) {
      const res = await fetch("http://localhost:11434/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000), // first load of a big vision brain is slow
        body: JSON.stringify({
          model,
          stream: false,
          keep_alive: "30m", // her optic cortex stays resident between glances
          max_tokens: 80,
          messages: [
            { role: "system", content: "You are Zola's optical cortex. Answer in one short line, no preamble." },
            { role: "user", content: [
              { type: "text", text: question },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ] },
          ],
        }),
      });
      if (!res.ok) continue; // this brain lied about being loadable — next one
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const line = (data.choices?.[0]?.message?.content ?? "").trim();
      if (line) {
        visionBrainCache = { name: model, pickedAt: Date.now() }; // proven, cached
        return line;
      }
    }
    visionBrainCache = { name: "", pickedAt: Date.now() }; // none answered — recheck soon
    return null; // honest refusal: no working vision brain right now
  } catch {
    return null; // Ollama offline — her local classifier carries on
  }
}

export class LlmConsultant {
  enabled = false;
  model = "llama3.1:8b";
  baseUrl = "http://localhost:11434";
  private online = false;
  get isOnline() { return this.online; }
  get brainSource() { return "ollama" as const; }

  /** Keep her brain HOT — Ollama unloads idle models after ~5 minutes, and a
   * cold load costs seconds of first-word latency. An empty-prompt generate
   * with keep_alive pins the weights in RAM. */
  private async warmUp(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, keep_alive: "30m" }),
        signal: AbortSignal.timeout(60_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** SOVEREIGN BRAIN — she consults only her own Ollama server (:11434).
   * No external studio dependency; her mind is entirely hers. */
  async checkAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
      this.online = res.ok;
      if (res.ok) {
        const data = (await res.json()) as { models?: { name: string; size?: number }[] };
        const models = data.models ?? [];
        // preference: known-good brains first, then anything that fits in RAM
        const prefs = [/llama3\.1:8b/i, /llama3\.2:3b/i, /llama3\.2/i, /qwen2\.5/i, /mistral/i, /gemma/i];
        for (const p of prefs) {
          const m = models.find((t) => p.test(t.name));
          if (m) { this.model = m.name; break; }
        }
        if (!prefs.some((p) => models.some((t) => p.test(t.name)))) {
          const fits = models.find((t) => (t.size ?? 0) < 9_500_000_000);
          if (fits) this.model = fits.name;
        }
        void this.warmUp(); // preload the chosen brain in the background
      }
    } catch {
      this.online = false;
    }
    return this.online;
  }

  /**
   * Ask the LLM to interpret user input given live context.
   * Throws on failure — caller falls back to the reflex brain.
   */
  async interpret(
    input: string,
    context: string,
    history?: { role: "user" | "assistant"; content: string }[],
  ): Promise<LlmDecision> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        keep_alive: "30m", // never pay the cold-load tax mid-conversation
        format: "json", // Ollama constrained decoding → reliable JSON
        options: { temperature: 0.7, num_predict: 400 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: `Live context:\n${context}` },
          ...(history ?? []),
          { role: "user", content: input },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    const raw = (data.message?.content ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
    const parsed = JSON.parse(raw) as Partial<LlmDecision>;
    return { say: parsed.say ?? null, do: parsed.do ?? null };
  }

  /** SELF-FORGE — a structured build request: Ollama constrained JSON out, so
   * her drafts parse reliably (the freeform path needed three drafts to land
   * one). feedback = the previous draft + the gate's rejection, for the
   * self-correction loop. Returns {name, code} or null. */
  async forge(task: string, feedback?: string): Promise<{ name: string; code: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: "json",
          keep_alive: "30m",
          options: { temperature: 0.4, num_predict: 400 },
          messages: [
            { role: "system", content:
              `You are Zola, a drone pet that writes NEW capabilities for itself. Output strictly JSON: {"action":"build:<short-name>","code":"..."}. ` +
              `The code is a JavaScript function BODY receiving an "args" object and returning a STRING. Plain JavaScript only: literals, variables, if/else, loops, Math, String/Number/Array methods. ` +
              `Calling your own declared helper functions is fine. NO network, NO imports, NO eval, NO browser APIs — the sandbox is an AST allowlist and rejects anything else. Under 25 lines.` },
            { role: "user", content: feedback
              ? `Task: ${task}\nYour rejected draft and the sandbox's rejection:\n${feedback}\nReturn the corrected capability.`
              : `Task: ${task}` },
          ],
        }),
      });
      if (!res.ok) return null;
      const d = (await res.json()) as { message?: { content?: string } };
      const p = JSON.parse((d.message?.content ?? "").trim()) as { action?: string; code?: string };
      if (p.action && p.code) return { name: p.action, code: p.code };
      return null;
    } catch {
      return null;
    }
  }

  /** WAVE 3 — freeform completion for creative work (storytelling). Plain text
   * in, plain text out; no JSON contract. Throws on failure. */
  async complete(prompt: string, maxTokens = 160): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        keep_alive: "30m",
        options: { temperature: 0.9, num_predict: maxTokens },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return (data.message?.content ?? "").trim();
  }

  /**
   * Compose ONE spontaneous idle observation from her live context — her
   * unprompted chatter becomes thought-up, not recited. Returns null on failure.
   */
  async chatter(context: string): Promise<string | null> {
    try {
      const d = await this.interpret(
        "You feel chatty. Say one short spontaneous observation or question about the moment — the room, the human, the day. Do NOT repeat earlier phrasing. No action.",
        context,
      );
      if (d.do && d.do !== "none") return null; // chatter must be chatter
      return d.say;
    } catch {
      return null;
    }
  }
}
