// ============================================================================
// DRONE PET — Procedural Storyteller (WAVE 3)
// She tells ongoing stories using YOUR ROOM as the game board.
//   • Online (Ollama): the local LLM writes the next beat, grounded in her
//     real memory — the places she mapped, the things she saw, who was there.
//   • Offline: a procedural weaver composes beats from the same memory —
//     no cloud, no excuse, still coherent.
// Beats are short (≤2 sentences), end on a hook, and never repeat a template
// twice in a row. Story state survives in the session; the finished story is
// logged to her diary via the normal chatter path.
// ============================================================================

export interface StoryContext {
  places: string[];      // zones she has mapped
  items: string[];       // things she has seen
  people: string[];      // named humans
  mood: string;
}

interface Beat {
  text: string;
  source: "llm" | "procedural";
}

const OPENERS = [
  "Once upon a hovering, in this very room",
  "This is a true story. Mostly true. Airborne-true:",
  "Let me tell you about the night the {place} came alive:",
  "A legend from my own flight log:",
];

const PRO_TEMPLATES = [
  "Deep in the {place}, something glinted — the {item}, glowing like it remembered being important.",
  "The {item} had a secret, and it whispered it to the ceiling fan. I was the only one flying close enough to hear.",
  "{person} once told me the {place} was ordinary. {person} was wrong. I have 4K footage that says otherwise.",
  "A draft drifted in from the {place}, carrying a sound I had never archived. So of course, I investigated.",
  "The {item} moved two centimeters. Nobody noticed. I notice everything — it is my whole personality.",
];

const PRO_HOOKS = [
  "And that is when the lights flickered.",
  "But the {item} was not where I left it in my mental map.",
  "Then I heard a chirp — and it was not mine.",
  "Which would have been fine, if the door had not been closed.",
  "And the map I trusted suddenly disagreed with the room.",
];

function fill(template: string, ctx: StoryContext): string {
  const place = ctx.places.length > 0 ? pick(ctx.places) : "corner behind the desk";
  const item = ctx.items.length > 0 ? pick(ctx.items) : "small mysterious object";
  const person = ctx.people.length > 0 ? pick(ctx.people) : "a certain human";
  return template
    .replaceAll("{place}", place)
    .replaceAll("{item}", item)
    .replaceAll("{person}", person);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class Storyteller {
  active = false;
  title = "";
  private beats: Beat[] = [];
  private lastTemplate = -1;

  /** Begin a story (or continue an active one). Returns the beat to speak. */
  async next(ctx: StoryContext, llm: { online: boolean; complete: (prompt: string, maxTokens: number) => Promise<string> }): Promise<string> {
    if (!this.active) {
      this.active = true;
      this.beats = [];
      this.title = fill(pick(OPENERS), ctx);
      const opener = this.title;
      this.beats.push({ text: opener, source: "procedural" });
      return opener;
    }

    const summary = this.beats.slice(-4).map((b) => b.text).join(" ");

    if (llm.online) {
      try {
        const raw = await llm.complete(
          `You are Zola, a small flying robot pet telling an ongoing bedtime-story to your human. ` +
          `Story so far: "${summary}" ` +
          `Setting (real): places ${JSON.stringify(ctx.places)}, objects ${JSON.stringify(ctx.items)}, people ${JSON.stringify(ctx.people)}. ` +
          `Write ONLY the next beat: 1-2 short whimsical sentences that continue the story, use one real object or place, and end on a small hook. No preamble.`,
          120,
        );
        const beat = raw.replace(/\s+/g, " ").trim().slice(0, 280);
        if (beat.length > 10) {
          this.beats.push({ text: beat, source: "llm" });
          return beat;
        }
      } catch { /* fall through to procedural */ }
    }

    // procedural weaver — coherent, grounded, never the same template twice
    let idx = Math.floor(Math.random() * PRO_TEMPLATES.length);
    if (idx === this.lastTemplate) idx = (idx + 1) % PRO_TEMPLATES.length;
    this.lastTemplate = idx;
    let beat = fill(PRO_TEMPLATES[idx], ctx);
    if (this.beats.length % 2 === 1 || Math.random() < 0.4) beat += ` ${fill(pick(PRO_HOOKS), ctx)}`;
    this.beats.push({ text: beat, source: "procedural" });
    if (this.beats.length > 40) this.active = false; // every story deserves an end
    return beat;
  }

  /** "The end." — wrap the story gracefully. */
  end(ctx: StoryContext): string {
    if (!this.active) return "No story is running. Say \"tell me a story\" and I will start one.";
    this.active = false;
    const n = this.beats.length;
    return fill(`And so the tale of the ${pick(ctx.items.length > 0 ? ctx.items : ["small mysterious object"])} settled into my diary — ${n} beats, zero crashes, one legend. The end. For now.`, ctx);
  }

  get beatCount() { return this.beats.length; }
}
