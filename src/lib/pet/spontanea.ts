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

// ---- v2.7: the mood → gesture chooser -------------------------------------
// She picks movement that FITS how she feels. Events bias the pool; her
// mood gates it; the last clip never repeats back-to-back (a pet who
// bowes twice in a row is a broken record, not a personality).

const MOOD_GESTURE_POOLS: Record<string, string[]> = {
  happy: ["wave_01", "wave_02", "spin_01", "dance_01", "peekaboo_01"],
  curious: ["peekaboo_01", "stretch_01", "shrug_01", "pickup_01"],
  excited: ["dance_01", "dance_02", "spin_01", "throw_01", "march_01"],
  idle: ["stretch_01", "shrug_01"],
  sleepy: ["stretch_01", "mope_01"],
  alarmed: ["getup_01", "crawl_01"],
  sleeping: [], // she is asleep — she does not perform on command
};

const EVENT_BIAS: Record<string, string[]> = {
  pet: ["peekaboo_01", "wave_01", "spin_01"],
  greet: ["wave_01", "bow_02", "curtsey_01"],
  praise: ["bow_01", "curtsey_01", "spin_01"],
  task_done: ["throw_01", "dance_01", "march_01"],
  confused: ["shrug_01"],
};

export interface GestureChoice {
  clip: string;
  reason: string;
}

/**
 * Pick a gesture that fits her mood and the moment's event. Returns null
 * when nothing fits (sleeping mood, unknown event with no pool). The
 * `lastClip` guard keeps her from repeating herself back-to-back.
 */
export function chooseGesture(
  mood: string,
  event: string | null,
  rand: number, // 0..1, caller-supplied for determinism/testability
  lastClip?: string | null,
): GestureChoice | null {
  const bias = event ? EVENT_BIAS[event] : undefined;
  const pool = bias ?? MOOD_GESTURE_POOLS[mood] ?? [];
  if (pool.length === 0) return null;
  // the anti-repeat filter applies to ANY pool size — a one-clip pool that
  // just played means she holds still rather than become a broken record
  const candidates = lastClip ? pool.filter((c) => c !== lastClip) : pool;
  if (candidates.length === 0) return null;
  const clip = candidates[Math.floor(rand * candidates.length) % candidates.length];
  const reason = bias ? `event:${event}` : `mood:${mood}`;
  return { clip, reason };
}
