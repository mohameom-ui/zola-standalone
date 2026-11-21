// ============================================================================
// ZOLA — deliberation helpers (two-pass brain)
//
// One call asking a 1.5B model to understand, choose, and speak at once is a
// lot. Splitting it — plan as strict JSON, then voice the decision — is the
// cheapest reasoning upgrade available to a small model.
//
// The model calls live in llm.ts; everything testable lives here: verb
// validation, tolerant JSON parsing, and action normalisation. A malformed
// plan must never become a malformed command.
// ============================================================================

/** Every action her brain may emit. Kept in sync with the prompt's list. */
export const ACTION_VERBS = [
  "none", "come", "follow", "trick", "dance", "sleep", "wake", "hover",
  "scan", "cancel", "status", "patrol", "walk", "diagnose", "vlog", "dream",
  "story", "sun", "quiet", "find", "goto", "name", "remember", "recon",
  "build", "run", "mood", "mode", "mission", "body", "gesture", "remind",
  "task", "play", "web",
] as const;

export type ActionVerb = (typeof ACTION_VERBS)[number];

const VERB_SET = new Set<string>(ACTION_VERBS);

export interface Plan {
  action: string;
  verb: ActionVerb;
  confidence: number;
  why: string;
}

/** Verb of an action string ("find:cup" → "find"), or null if unknown. */
export function verbOf(action: string): ActionVerb | null {
  const verb = action.trim().toLowerCase().split(":")[0].split(/\s+/)[0];
  return VERB_SET.has(verb) ? (verb as ActionVerb) : null;
}

/**
 * Parse a model's planning reply. Tolerates prose around the JSON (small
 * models love to explain), rejects unknown verbs and nonsensical confidence.
 */
export function parsePlan(raw: string): Plan | null {
  if (!raw) return null;
  const match = /\{[\s\S]*?\}/.exec(raw);
  if (!match) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const action = typeof obj.action === "string" ? obj.action.trim() : "";
  if (!action) return null;
  const verb = verbOf(action);
  if (!verb) return null;
  const rawConf = typeof obj.confidence === "number" ? obj.confidence : 0.5;
  const confidence = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf)) : 0.5;
  const why = typeof obj.why === "string" ? obj.why.slice(0, 80) : "";
  // normalise "none" and casing; keep arguments verbatim
  const normalised = action === action.toUpperCase() ? action.toLowerCase() : action;
  return { action: normalised, verb, confidence, why };
}

/**
 * A one-line voice prompt for the second pass. The decision is fixed; the
 * model only has to sound like her.
 */
export function voiceInstruction(action: string, confidence: number): string {
  const hedge = confidence < 0.45 ? " If you are unsure, say so in character." : "";
  return (
    `The action has already been decided: ${action}. ` +
    "Reply with ONE spoken line in character, at most 20 words. " +
    "Do not mention JSON, planning, confidence, or action names." + hedge
  );
}
