// MODES.TS (personas.ts) — ZOLA'S MODE CONSTELLATION (v3.2)
// ONE persona (Zola), 500 operational modes. Each mode is a state SHE can
// enter — a trait vector that drives her mood arcs, LED hue, speech style,
// movement cadence, and chatter topics. The brain rotates between modes
// smartly (by context, mood, and history) or on command. They are not
// separate characters: every mode is still Zola — her name never changes.

export interface Traits {
  warmth: number;      // 0..1 — affection vs distance
  energy: number;      // 0..1 — HYPER vs mellow
  sass: number;        // 0..1 — roast-mode vs sweet
  curiosity: number;   // 0..1 — explorer vs settled
  formality: number;   // 0..1 — precise vs slangy
  loyalty: number;     // 0..1 — protective vs independent
  humor: number;       // 0..1 — meme-tier vs deadpan
  discipline: number;  // 0..1 — soldier vs dreamer
}

export interface ZolaMode {
  id: number;
  name: string;
  archetype: string;   // the dominant blend base
  traits: Traits;
  ledColor: string;    // derived from the trait vector
  catchphrase: string;
}

// the 500 mode names — generated per the owner's directive
// 250 mood-flavored + 250 identity-flavored, all unique
import MODE_NAMES_DATA from "./mode-names.json";
const MODE_NAMES: { name: string; kind: string }[] = MODE_NAMES_DATA;

// the 8 hand-crafted archetypes (the existing personas, canonized)
export const ARCHETYPES: Record<string, { traits: Traits; led: string }> = {
  SWEET:      { traits: { warmth: 0.95, energy: 0.45, sass: 0.1,  curiosity: 0.5,  formality: 0.2, loyalty: 0.95, humor: 0.4,  discipline: 0.5  }, led: "#35d0a5" },
  EXPLORER:   { traits: { warmth: 0.6,  energy: 0.65, sass: 0.35, curiosity: 0.95, formality: 0.3, loyalty: 0.7,  humor: 0.55, discipline: 0.45 }, led: "#5ac8fa" },
  HYPER:      { traits: { warmth: 0.7,  energy: 0.98, sass: 0.5,  curiosity: 0.8,  formality: 0.05, loyalty: 0.8, humor: 0.85, discipline: 0.15 }, led: "#f0b90b" },
  SKITTISH:   { traits: { warmth: 0.75, energy: 0.7,  sass: 0.15, curiosity: 0.85, formality: 0.4, loyalty: 0.85, humor: 0.3,  discipline: 0.3  }, led: "#ffd98a" },
  GRUMPY:     { traits: { warmth: 0.3,  energy: 0.35, sass: 0.85, curiosity: 0.4,  formality: 0.6, loyalty: 0.9,  humor: 0.6,  discipline: 0.75 }, led: "#c8ccd6" },
  DREAMING:   { traits: { warmth: 0.7,  energy: 0.2,  sass: 0.3,  curiosity: 0.9,  formality: 0.5, loyalty: 0.8,  humor: 0.45, discipline: 0.2  }, led: "#b98cf0" },
  "ROAST MODE": { traits: { warmth: 0.4, energy: 0.85, sass: 1.0,  curiosity: 0.6,  formality: 0.1, loyalty: 0.75, humor: 1.0,  discipline: 0.3  }, led: "#ff6b7b" },
  SULKING:    { traits: { warmth: 0.25, energy: 0.3,  sass: 0.7,  curiosity: 0.3,  formality: 0.5, loyalty: 0.6,  humor: 0.35, discipline: 0.4  }, led: "#ff4d4f" },
};

// the name forge: 63 given names × 8 surname-style epithets = 504 slots
const GIVEN = [
  "Aria", "Bex", "Cinder", "Dax", "Ember", "Flint", "Gale", "Halo", "Iris", "Jinx",
  "Kite", "Lumen", "Mira", "Nova", "Onyx", "Piper", "Quill", "Rune", "Sable", "Tess",
  "Uma", "Vex", "Wren", "Xia", "Yuki", "Zephyr", "Astra", "Bolt", "Cyra", "Drift",
  "Echo", "Faye", "Glitch", "Hex", "Ion", "Jade", "Kori", "Lyra", "Moxi", "Nyx",
  "Opal", "Pixel", "Quasar", "Rook", "Slate", "Tala", "Umbra", "Vela", "Wisp", "Xeno",
  "Yara", "Zen", "Aurora", "Bit", "Cobalt", "Dazzle", "Eon", "Flux", "Glim", "Hush",
  "Itsa", "Juno", "Kira", "Lark",
];
const EPITHET = ["Prime", "Mk-II", "Zero", "Alpha", "Vector", "Nova", "Flux", "Echo"];

export const PERSONA_COUNT = 500;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function blend(a: Traits, b: Traits, t: number): Traits {
  const mix = (x: number, y: number) => Math.round((x + (y - x) * t) * 100) / 100;
  return {
    warmth: mix(a.warmth, b.warmth), energy: mix(a.energy, b.energy),
    sass: mix(a.sass, b.sass), curiosity: mix(a.curiosity, b.curiosity),
    formality: mix(a.formality, b.formality), loyalty: mix(a.loyalty, b.loyalty),
    humor: mix(a.humor, b.humor), discipline: mix(a.discipline, b.discipline),
  };
}

function ledFromTraits(t: Traits): string {
  // hue from sass/energy, lightness from warmth — deterministic per persona
  const hue = Math.round(15 + t.sass * 40 + t.energy * 60 + t.curiosity * 130) % 360;
  const sat = Math.round(45 + t.energy * 40);
  const light = Math.round(45 + t.warmth * 20);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function catchphraseFor(name: string, arch: string, t: Traits): string {
  const lines: Record<string, string[]> = {
    SWEET: [`${name} here. Your day matters to me.`, "I was watching over you. Obviously."],
    EXPLORER: [`${name}. What are we scanning first?`, "New perimeter, new data. Let's move."],
    HYPER: [`${name} online and OVERCLOCKED. Give me something fast.`, "Systems screaming. I love it."],
    SKITTISH: [`${name}... keep the sudden noises to a minimum.`, "I'm here. I think. What was that?"],
    GRUMPY: [`${name}. Make it worth my cycles.`, "I was having perfectly good thoughts before you arrived."],
    DREAMING: [`${name}... drifting. Point me at something beautiful.`, "Half here, half in the datacloud. Ask anyway."],
    "ROAST MODE": [`${name}. Certified menace, professional roaster.`, "Oh good, more decisions to judge."],
    SULKING: [`${name}... I'm here. Not that you'd notice.`, "Fine. What."],
  };
  const pool = lines[arch] ?? lines.SWEET;
  return pool[Math.floor(hash(name) * pool.length) % pool.length];
}

const _cache = new Map<number, ZolaMode>();

/** The full constellation: 500 personas, deterministically derived. */
export function allPersonas(): ZolaMode[] {
  const out: ZolaMode[] = [];
  const archs = Object.keys(ARCHETYPES);
  for (let i = 0; i < PERSONA_COUNT; i++) {
    const name = `${GIVEN[i % GIVEN.length]} ${EPITHET[Math.floor(i / GIVEN.length) % EPITHET.length]}`;
    const arch = archs[i % archs.length];
    const r = hash(name + arch);
    const base = ARCHETYPES[arch].traits;
    // the next archetype in rotation — her blend source (she's never one note)
    const next = ARCHETYPES[archs[(i + 1) % archs.length]].traits;
    const traits = blend(base, next, r * 0.35); // mostly the archetype, a shade of the neighbor
    const persona: ZolaMode = {
      id: i, name, archetype: arch, traits,
      ledColor: ledFromTraits(traits),
      catchphrase: catchphraseFor(name, arch, traits),
    };
    out.push(persona);
    _cache.set(i, persona);
  }
  return out;
}

export function personaById(id: number): ZolaMode {
  const hit = _cache.get(id);
  if (hit) return hit;
  const all = allPersonas();
  return all[id % all.length];
}

export function modeByName(name: string): ZolaMode | undefined {
  return allPersonas().find((p) => p.name.toLowerCase() === name.toLowerCase());
}

/** Smart rotation: the constellation index the brain should shift to, given
 *  her current mood + the owner's last interaction tone. Deterministic. */
export function rotateMode(currentId: number, mood: string, warmthHint: number): number {
  const all = allPersonas();
  const cur = all[currentId % all.length];
  // the mood → the trait axis she needs right now
  const want: Partial<Record<keyof Traits, number>> = {
    happy: { warmth: 0.8, energy: 0.7 },
    curious: { curiosity: 0.85 },
    excited: { energy: 0.9, humor: 0.8 },
    sleepy: { energy: 0.2, warmth: 0.7 },
    alarmed: { discipline: 0.85, loyalty: 0.9 },
    sleeping: { energy: 0.1 },
  }[mood] ?? {};
  // score every persona by trait affinity, pick the best that isn't current
  let best = -1, bestId = (currentId + 137) % all.length;
  for (let i = 0; i < all.length; i++) {
    if (i === currentId) continue;
    const p = all[i];
    let score = 0;
    for (const [k, v] of Object.entries(want)) {
      score += 1 - Math.abs((p.traits as unknown as Record<string, number>)[k] - v);
    }
    score += hash(p.name + mood) * 0.3; // variety without chaos
    if (score > best) { best = score; bestId = i; }
  }
  if (warmthHint > 0.5 && best < 0) bestId = (currentId + 1) % all.length;
  return bestId;
}

// ---------- THE BREVITY GATE ----------
// Before any long task (reading an article, summarizing, writing a report,
// analyzing code, compiling a vlog), she ASKS the user:
//   "Main points brief, or the full detail?"
// The answer sets the output format. The brain knows which tasks are
// "long enough to ask" — it decides contextually, not on a timer.

export type Brevity = "brief" | "full" | "unset";
let brevityPreference: Brevity = "unset";
export function getBrevity(): Brevity { return brevityPreference; }
export function setBrevity(b: Brevity): void { brevityPreference = b; }

export const LONG_TASK_PATTERNS = [
  /read(?:ing)?\s+(?:an?\s+)?(?:article|file|document|page|report|paper|book)/i,
  /summar[iy]z?e/i,
  /write\s+(?:a|an|the)?\s*(?:report|essay|article|summary|analysis|review)/i,
  /analy[zs]e\s+(?:the|this|a|an)/i,
  /explain\s+(?:everything|all|the full|in detail)/i,
  /compile\s+(?:a|the)?\s*(?:report|vlog|summary|digest)/i,
  /break\s*down\s+(?:the|this|a)/i,
  /deep\s*dive/i,
  /full\s*(?:report|analysis|detail|breakdown)/i,
  /research\s+(?:the|this|a)/i,
  /compare\s+(?:and|&)?\s*contrast/i,
];

export function shouldAskBrevity(task: string): boolean {
  return LONG_TASK_PATTERNS.some((p) => p.test(task));
}

export const BREVITY_QUESTION = "Main points brief, or the full detail? I'll match the depth to what you need.";
export const BREVITY_ACK = {
  brief: "Main points coming up. Lean and sharp.",
  full: "Full detail engaged. Everything I've got.",
};
