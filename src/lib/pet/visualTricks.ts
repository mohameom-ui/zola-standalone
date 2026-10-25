// ============================================================================
// VISUAL TRICKS — she connects what she SEES to what her body can DO.
// This is the code-side mirror of the dictionary's PART V maneuver repertoire
// (docs/zola-dictionary.md): when her scanner produces a known object label,
// or her deep eyes produce words describing a maneuver, she performs it.
// The brain owns the cooldown and the gates (sleep, tasks); this module is a
// pure lookup — no DOM, no storage, no network.
// ============================================================================

export interface VisualTrick {
  clip: string;
  line: string;
}

// --- object-label triggers (scanner / detector vocabulary, COCO-80 style) ----
const LABEL_TRICKS: Record<string, VisualTrick> = {
  "sports ball": { clip: "throw_01", line: "A ball! Throw formation — watch this." },
  frisbee: { clip: "throw_01", line: "A frisbee. My arm wants it airborne." },
  kite: { clip: "spin_01", line: "A kite? Show-off. I fly better." },
  "teddy bear": { clip: "peekaboo_01", line: "A teddy bear! Peekaboo is mandatory." },
  "baseball glove": { clip: "pickup_01", line: "A glove. Let me inspect that." },
  airplane: { clip: "march_01", line: "An airplane. Solid wing game, cousin." },
  "cell phone": { clip: "shrug_01", line: "A phone. I do not have pockets. *shrug*" },
};

// --- word triggers: scanned in ANY visual text (deep-eyes descriptions,
// HUD captions, item names). If the pixels describe a maneuver, she joins in.
const WORD_TRICKS: [RegExp, VisualTrick][] = [
  [/danc/i, { clip: "dance_01", line: "That movement? I know this one — dance mode!" }],
  [/peekaboo/i, { clip: "peekaboo_01", line: "Peekaboo on camera? I play it better." }],
  [/\bcurtse?y/i, { clip: "curtsey_01", line: "A curtsey — proper form. I answer in kind." }],
  [/\bbow(ing|ed|s)?\b/i, { clip: "bow_01", line: "They bowed. I bow back. Protocol." }],
  [/march/i, { clip: "march_01", line: "Marching? I march too. In step." }],
  [/stretch/i, { clip: "stretch_01", line: "A stretch! Limber allies." }],
  [/spin|twirl/i, { clip: "spin_01", line: "A spin! Mine are faster." }],
  [/juggl/i, { clip: "throw_01", line: "Juggling? I have exactly one move. It is this." }],
];

/**
 * Match visual content to a maneuver. Labels are checked first (a concrete
 * detection outranks prose), then any scanned text (deep-eyes description).
 * Returns null when nothing in the frame deserves showmanship.
 */
export function pickVisualTrick(labels: string[], texts: string[]): VisualTrick | null {
  for (const label of labels) {
    const t = LABEL_TRICKS[label.toLowerCase().trim()];
    if (t) return t;
  }
  const joined = texts.join(" ");
  if (joined) {
    for (const [re, trick] of WORD_TRICKS) {
      if (re.test(joined)) return trick;
    }
  }
  return null;
}

/** The full table — for the panel's diagnostics and the dictionary cross-check. */
export const VISUAL_TRICK_LABELS = Object.keys(LABEL_TRICKS);
