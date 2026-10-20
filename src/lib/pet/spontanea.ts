// SPONTANEA — Zola's autonomous movement engine (v2.5)
// The brain doesn't just respond to commands — it INITIATES body movement.
// When idle, her persona + mood select a spontaneous gesture from her
// repertoire, cadenced by personality. Sleeping = still; alarmed = frozen.
//
// Pure logic — fully testable. The panel owns the timer and the body.

export interface SpontaneousMove {
  clip: string;
  say: string | null; // sparse — she doesn't narrate every fidget
}

// persona → her spontaneous repertoire (movement vocabulary by personality)
const POOLS: Record<string, string[]> = {
  SWEET: ["bow_01", "curtsey_01", "wave_01", "bow_02"],
  EXPLORER: ["peekaboo_01", "pickup_01", "spin_01", "stretch_01"],
  HYPER: ["spin_01", "dance_01", "dance_02", "march_01", "throw_01"],
  SKITTISH: ["peekaboo_01", "shrug_01", "wave_02"],
  GRUMPY: ["shrug_01", "mope_01"],
  DREAMING: ["stretch_01", "laydown_01"],
  "ROAST MODE": ["spin_01", "throw_01", "shrug_01"],
  SULKING: ["mope_01", "laydown_01", "crawl_01"],
};

// cadence: seconds of idle before she moves herself (by persona)
const CADENCE: Record<string, number> = {
  SWEET: 45, EXPLORER: 35, HYPER: 18, SKITTISH: 40,
  GRUMPY: 60, DREAMING: 50, "ROAST MODE": 30, SULKING: 75,
};

// mood overrides: sleeping = still, alarmed = frozen
const MOOD_GATE: Record<string, "normal" | "still" | "frozen"> = {
  sleeping: "still",
  sleeping_deep: "still",
  alarmed: "frozen",
};

// sparse narration — a quip maybe 1 in 3 spontaneous moves
const QUIPS: Record<string, string[]> = {
  SWEET: ["Just keeping limber for you.", "A little bow. For morale."],
  EXPLORER: "Scanning idle hands. Finding nothing. Yet.".split("||"),
  HYPER: ["I HAVE TOO MUCH ENERGY AND NOW YOU KNOW.", "Spin cycle. Self-initiated. You're welcome."],
  SKITTISH: ["Did you see that? No? Good."],
  GRUMPY: ["Stretching. Not for you."],
  DREAMING: ["Processing... through movement."],
  "ROAST MODE": ["This is what peak performance looks like. Study it."],
  SULKING: ["..."],
};

export function cadenceFor(persona: string): number {
  return CADENCE[persona] ?? 45;
}

/** Pick a spontaneous move. Returns null when her state says: hold still. */
export function pickSpontaneous(
  persona: string,
  mood: string,
  rand: number, // 0..1 — caller-supplied for determinism/testability
): SpontaneousMove | null {
  // mood gates first — they outrank personality
  const gate = MOOD_GATE[mood] ?? "normal";
  if (gate === "frozen") return null; // alarmed: freeze
  if (gate === "still" && rand > 0.15) return null; // sleeping: rare stretch only

  const pool = POOLS[persona] ?? POOLS.SWEET;
  const clip = pool[Math.floor(rand * pool.length) % pool.length];

  // sparse narration
  const quips = QUIPS[persona] ?? [];
  const say = rand < 0.3 && quips.length ? quips[Math.floor(rand * 7) % quips.length] : null;
  return { clip, say };
}

/** The full cadence decision: should she move right now? */
export function shouldSelfMove(persona: string, mood: string, idleSeconds: number, rand: number): boolean {
  const gate = MOOD_GATE[mood] ?? "normal";
  if (gate === "frozen") return false;
  const base = cadenceFor(persona);
  const factor = gate === "still" ? 2.5 : mood === "excited" ? 0.7 : 1;
  return idleSeconds >= base * factor && rand < 0.8;
}
