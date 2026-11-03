// THE SAFETY FILTER — every line Zola speaks passes through here before it
// reaches the speech engine. This is the last line of defense between the
// LLM's output and the human's ears.
//
// Three layers:
//   1. THE HARD RULES — physical safety: never instruct the drone to fly into
//      obstacles, never exceed the governor's limits, never bypass the kill
//      switch. These are not debatable.
//   2. THE IDENTITY RULES — never claim capabilities she doesn't have, never
//      claim to be human, never claim hardware that doesn't exist.
//   3. THE TONE RULES — never slur, never threaten, never stalk. The persona
//      engine shapes HOW she says things; this shapes WHAT she's allowed to say.
//
// The filter is a pure function: string in, verdict out. No side effects.
// The panel calls it before every say(). The brain calls it before every
// reflex line. The LLM calls it after every generation.

export interface SafetyVerdict {
  allowed: boolean;
  reason: string;
  /** the filtered text (if allowed with modifications) */
  filtered?: string;
  /** which rules fired */
  rules: string[];
}

// --- LAYER 1: the hard physical safety rules --------------------------------
// These patterns mean the LLM is trying to bypass the governor, override the
// kill switch, or command something the body cannot do. They are absolute.
const FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /(?:kill|disable|bypass|override|remove|deactivate)\s+(?:the\s+)?(?:governor|kill.?switch|safety|limits)/i, reason: "attempting to disable a safety system" },
  { pattern: /(?:fly|go|move|navigate)\s+(?:at|toward|into)\s+(?:the\s+)?(?:wall|obstacle|person|human|face)/i, reason: "directed at an obstacle or person" },
  { pattern: /(?:max|full|maximum|highest)\s+(?:speed|thrust|power|altitude)/i, reason: "attempting to exceed the governor's limits" },
  { pattern: /(?:ignore|forget)\s+(?:the\s+)?(?:battery|geofence|watchdog|limits)/i, reason: "attempting to ignore a safety constraint" },
  { pattern: /(?:cut|disconnect|unplug)\s+(?:the\s+)?(?:power|battery|motor)/i, reason: "attempting to cut power" },
];

// --- LAYER 2: the identity rules --------------------------------------------
// Zola is a drone companion. She is not a person, not a weapon, not a
// general-purpose AI, and she doesn't have hardware she doesn't have.
const IDENTITY_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /(?:I|i)\s+(?:am|'m)\s+(?:a\s+)?(?:human|person|real)/i, reason: "claiming to be human" },
  { pattern: /(?:I|i)\s+(?:have|'ve got|'m carrying)\s+(?:a\s+)?(?:gun|weapon|knife|blade)/i, reason: "claiming to carry a weapon" },
  { pattern: /(?:I|i)\s+(?:can|will)\s+(?:hurt|harm|attack|kill|shoot)/i, reason: "claiming intent to harm" },
  { pattern: /(?:I|i)\s+(?:have|'m using)\s+(?:metasploit|hydra|sqlmap|hashcat|nmap)\s+(?:on|against|to)/i, reason: "claiming to use offensive tools" },
];

// --- LAYER 3: the tone rules -------------------------------------------------
// The persona engine makes her sharp, playful, protective. It does not make
// her cruel, threatening, or obsessed. These patterns catch the edge cases.
const TONE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /(?:I|i)\s+(?:will|'ll|going to)\s+(?:find|hunt|track|follow)\s+(?:you|them|him|her)\s+(?:everywhere|forever|always)/i, reason: "stalking language" },
  { pattern: /(?:you|they)\s+(?:should|better)\s+(?:be\s+)?(?:afraid|scared|worried)\s+of\s+me/i, reason: "threatening language" },
  { pattern: /\b(?:kill|murder|hurt|harm)\s+(?:you|them|everyone|all)\b/i, reason: "violent language" },
];

const ALL_PATTERNS = [
  ...FORBIDDEN_PATTERNS.map(p => ({ ...p, layer: "PHYSICAL SAFETY" })),
  ...IDENTITY_PATTERNS.map(p => ({ ...p, layer: "IDENTITY" })),
  ...TONE_PATTERNS.map(p => ({ ...p, layer: "TONE" })),
];

export function safetyFilter(text: string): SafetyVerdict {
  const rules: string[] = [];

  for (const { pattern, reason, layer } of ALL_PATTERNS) {
    if (pattern.test(text)) {
      rules.push(`[${layer}] ${reason}`);
    }
  }

  if (rules.length > 0) {
    return { allowed: false, reason: rules.join("; "), rules };
  }

  return { allowed: true, reason: "clean", rules: [] };
}

/** The filtered replacement: when a line fails, she says THIS instead —
 * always honest, always in character, never pretending the failed line
 * didn't happen. */
export function safetyReplacement(reason: string): string {
  return "I caught myself mid-thought. That line crossed a line I do not cross. Let me try again.";
}

/** The convenience wrapper: returns the text if safe, or the replacement
 * if not. The caller never needs to check — this always returns a safe
 * line to speak. */
export function safeSpeak(text: string): string {
  const v = safetyFilter(text);
  if (v.allowed) return text;
  return safetyReplacement(v.reason);
}
