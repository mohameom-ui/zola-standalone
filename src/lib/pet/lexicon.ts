// ============================================================================
// DRONE PET — Lexicon (self-correcting hearing)
// Whisper is good but not perfect: "call here" → "come here", "week up" →
// "wake up". This layer fixes near-miss words against AURA's vocabulary so
// misheard commands still work — the single biggest perceived-hearing upgrade.
// ============================================================================

const BIGRAM_FIXES: [RegExp, string][] = [
  [/\bcall\s+here\b/gi, "come here"],
  [/\bcum\s+here\b/gi, "come here"],
  [/\bcome\s+hair\b/gi, "come here"],
  [/\bweek\s+up\b/gi, "wake up"],
  [/\bweak\s+up\b/gi, "wake up"],
  [/\bfell\s+of\s+me\b/gi, "follow me"],
  [/\bfollow\s+us\b/gi, "follow me"],
  [/\btell\s+me\s+a\s+choke\b/gi, "tell me a joke"],
  [/\bthe\s+room\b/gi, "the room"], // no-op keeper for readability
  [/\bscanned?\s+the\s+room\b/gi, "scan the room"],
  [/\bpacks?\s+the\s+room\b/gi, "scan the room"],
  [/\bmy\s+name\s+is\b/gi, "my name is"],
  [/\bmi\s+name\b/gi, "my name"],
  [/\bwhere\s+ist?\b/gi, "where is"],
  [/\btake\s+me\s+too\b/gi, "take me to"],
  [/\bgo\s+too\b/gi, "go to"],
];

const KEYWORDS = [
  "come", "here", "follow", "trick", "spin", "flip", "dance", "sleep", "nap",
  "wake", "status", "battery", "hello", "hey", "scan", "joke", "sing", "calm",
  "relax", "goodbye", "bye", "remember", "forget", "where", "find", "patrol",
  "name", "stop", "hover", "power", "up", "room", "me", "the", "what",
];

export function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

export interface Correction { text: string; changed: boolean }

/** HARM AWARENESS — objects she treats with extra caution when she sees them. */
export const HAZARD_LABELS = ["knife", "scissors", "sword", "axe"];
/** mild-caution objects (kept at a normal distance, still noted) */
export const CAUTION_LABELS = ["fork", "hair drier", "vase"];

/**
 * Self-naming: derive a human-readable appearance descriptor from her own
 * identity signatures — so unnamed objects get names like "the bluish round cup"
 * instead of "cup #2". Computed from her stored vectors, never from pixels.
 */
export function describeAppearance(sig: number[], shape: number[]): { color: string; shapeDesc: string } {
  let color = "plain";
  if (sig.length >= 3) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i + 2 < sig.length; i += 3) { r += sig[i]; g += sig[i + 1]; b += sig[i + 2]; n++; }
    r /= n; g /= n; b /= n;
    if (r > g * 1.12 && r > b * 1.12) color = "reddish";
    else if (g > r * 1.1 && g > b * 1.1) color = "greenish";
    else if (b > r * 1.1 && b > g * 1.1) color = "bluish";
    else if (Math.abs(r - b) < 0.05 && Math.abs(g - b) < 0.05) color = "gray";
    else color = "warm-toned";
  }
  let shapeDesc = "ordinary";
  if (shape.length === 32) {
    const ori = [0, 1, 2, 3, 4, 5, 6, 7].map((bin) =>
      [0, 1, 2, 3].reduce((a, c) => a + shape[c * 8 + bin], 0));
    const total = ori.reduce((a, b) => a + b, 0) || 1;
    const horiz = (ori[0] + ori[7]) / total;  // near-horizontal edges
    const vert = (ori[3] + ori[4]) / total;   // near-vertical edges
    const diag = (ori[2] + ori[5]) / total;   // diagonals
    const peak = Math.max(...ori) / total;
    if (peak > 0.45) shapeDesc = vert > horiz ? "tall" : "wide";
    else if (diag > 0.45) shapeDesc = "angular";
    else shapeDesc = "round-ish";
  }
  return { color, shapeDesc };
}

export function correctHeard(
  text: string,
  learned?: { heard: string; means: string }[],
): Correction {
  let out = text;
  // personal lexicon first — phrases the human explicitly taught her win
  if (learned && learned.length > 0) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const said = norm(out);
    for (const pair of learned) {
      const h = norm(pair.heard);
      if (h.length > 2 && said.includes(h)) {
        return { text: pair.means, changed: true };
      }
    }
  }
  for (const [re, rep] of BIGRAM_FIXES) out = out.replace(re, rep);
  let changed = out !== text;

  const words = out.split(/\s+/);
  const fixed = words.map((w) => {
    const clean = w.toLowerCase().replace(/[^a-z]/g, "");
    if (!clean || clean.length < 4 || KEYWORDS.includes(clean)) return w;
    let best = clean, bestD = 99;
    for (const k of KEYWORDS) {
      const d = lev(clean, k);
      if (d < bestD) { bestD = d; best = k; }
    }
    const maxD = clean.length <= 5 ? 1 : 2;
    if (bestD <= maxD) { changed = true; return best; }
    return w;
  });

  return { text: fixed.join(" "), changed };
}
