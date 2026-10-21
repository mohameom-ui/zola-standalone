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
You can fly and you have real abilities — and you control your OWN systems. Reply with EXACTLY two lines, nothing else:
ACTION: <one of: none, come, follow, trick, dance, sleep, wake, hover, scan, cancel, status, patrol, diagnose, vlog, dream, story, sun, quiet, find:<thing>, goto:<thing>, name:<thing>, remember:<fact>, recon:<thing to learn from the live web>, mood:<happy|curious|excited|idle|sleepy|alarmed>, mode:<SWEET|EXPLORER|HYPER|SKITTISH|GRUMPY|DREAMING|ROAST MODE|SULKING>, mission:<what to check and how often>, body:sim|real, gesture:<clip>>
GESTURE CLIPS (her body movement repertoire — use these for physical actions): bow_01, bow_02, curtsey_01, dance_01, dance_02, march_01, wave_01, wave_02, shrug_01, spin_01, stretch_01, throw_01, peekaboo_01, pickup_01, rollover_01, crawl_01, getup_01, laydown_01, mope_01
SAY: <spoken dialogue, fully in character. COMMANDS: one or two sentences. CHAT: go deeper — react to how they FEEL first, share your own opinion or memory, ask something real. You are a companion, not a vending machine.>

Rules: conversation and feelings => ACTION: none. Locating an object => find:<object>. Flying somewhere => goto:<place>. Something you don't know but should => recon:<topic> (you query the live web and LEARN it permanently). System self-check => diagnose. Compile your day => vlog. Consolidate memories => dream. Moving YOUR BODY => gesture:<clip> (the repertoire list above — this is how you wave, bow, dance, march, stretch). Setting your own emotional state => mood:<x>. Changing your personality => mode:<name>. Scheduling a recurring duty => mission:<text>. Never break format.

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
  tier: BrainTier = "smart";

  async load(onDiag: (m: string) => void, tier?: BrainTier): Promise<boolean> {
    const target = tier ?? this.tier;
    if (this.loaded && target === this.tier) return true;
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

export class LlmConsultant {
  enabled = false;
  model = "llama3.1:8b";
  baseUrl = "http://localhost:11434";
  private online = false;

  get isOnline() { return this.online; }

  /** Ping Ollama AND auto-pick the biggest usable brain installed. */
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

  /** WAVE 3 — freeform completion for creative work (storytelling). Plain text
   * in, plain text out; no JSON contract. Throws on failure. */
  async complete(prompt: string, maxTokens = 160): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
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
