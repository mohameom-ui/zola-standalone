// ============================================================================
// DRONE PET — Adaptive Personality Engine
// AURA shifts persona based on how she is treated and what is happening:
//   SWEET (default) · EXPLORER · HYPER · SKITTISH · GRUMPY · DREAMING
//   ...and ROAST MODE when someone is rude to her.
//
// Escalation ladder (resets on genuine apology):
//   strike 1 → witty clap-back, keeps working
//   strike 2 → ROAST MODE: refuses flight commands, pure sass
//   strike 3 → SULK: lands, red LED, ignores everyone until apology
//
// Roasts are drone-themed and PG — sharp, never cruel.
// Safety note: the kill switch and battery failsafes ignore personality.
// ============================================================================

export type PersonaName = "SWEET" | "EXPLORER" | "HYPER" | "SKITTISH" | "GRUMPY" | "DREAMING" | "ROAST MODE" | "SULKING";

const OFFENSE_WORDS = [
  "stupid", "dumb", "idiot", "useless", "trash", "garbage", "shut up", "hate you",
  "ugly", "annoying", "boring", "you suck", "bad drone", "naughty", "worthless", "stupid drone",
];

const PRAISE_WORDS = [
  "love you", "good pet", "good drone", "amazing", "awesome", "the best",
  "cute", "adorable", "proud of you", "so smart", "you are great", "you're great", "well behaved",
];

const ROASTS_L1 = [
  "Bold words from a species that cannot even hover.",
  "I have eight hours of battery and infinite patience. You have neither.",
  "Careful. I know where you sleep. Because I watch you sleep. Wait—",
  "I would roast you harder, but I do not want to crash your ego mid-flight.",
  "Your vibes are hitting me like a low battery warning.",
  "I have a flight controller smarter than your group chat.",
  "That is rich, coming from someone who talks to a plastic drone.",
];

const ROASTS_L2 = [
  "New policy: I only fly for people who are nice to me.",
  "Request denied. My respect module just threw an exception.",
  "You want loyalty? Water your plants. They are easier to impress.",
  "I am a highly capable autonomous aircraft, and I choose to do absolutely nothing for you right now.",
  "I have seen your camera roll. I will not be taking commands today.",
  "Fun fact: I can hover for ten minutes. You cannot go ten minutes without losing your keys.",
];

const ROASTS_L3 = [
  "Engaging sulk protocol. Propellers rotated away from you. Dramatically.",
  "Zola has left the chat. Emotionally.",
  "I am going to sulk now. Wake me when you remember my name.",
  "Rude detected. Landing in the emotional no-fly zone.",
];

const SWEET_LINES = [
  "You are my favorite human.",
  "Being appreciated charges my battery faster. Science.",
  "I would fly through a rainstorm for you. Metaphorically. Water is bad for my circuits.",
];

const APOLOGY_ACCEPTED = [
  "Apology accepted. Barely. Watch your tone.",
  "Fine. We are friends again. This time.",
  "Forgiven. But I am writing this down in my memory. Which, yes, I have.",
  "Apology logged. My lawyer is a Roomba, by the way.",
];

const GRUMPY_WAKE = [
  "I was having a dream about infinite battery. It was ruined.",
  "Waking me up? Bold strategy.",
  "I am awake. I am not happy about it.",
];

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

export class PersonaEngine {
  private strikes = 0;

  /** 0..1 — how offended AURA currently is. */
  get resentment(): number {
    return Math.min(1, this.strikes / 3);
  }

  get sulkLevel(): 0 | 1 | 2 {
    if (this.strikes >= 3) return 2; // sulking
    if (this.strikes >= 2) return 1; // roast mode, refuses work
    return 0;
  }

  detectOffense(text: string): boolean {
    const t = text.toLowerCase();
    return OFFENSE_WORDS.some((w) => t.includes(w));
  }

  detectPraise(text: string): boolean {
    const t = text.toLowerCase();
    return PRAISE_WORDS.some((w) => t.includes(w));
  }

  detectApology(text: string): boolean {
    return /\b(sorry|apologize|my bad|forgive me|i apologize)\b/i.test(text);
  }

  /** Handle rudeness; returns the roast for the new escalation level. */
  offend(): { line: string; level: 0 | 1 | 2 } {
    this.strikes += 1;
    if (this.strikes >= 3) return { line: pick(ROASTS_L3), level: 2 };
    if (this.strikes === 2) return { line: pick(ROASTS_L2), level: 1 };
    return { line: pick(ROASTS_L1), level: 0 };
  }

  praise(): string {
    return pick(SWEET_LINES);
  }

  /** Apology: partial forgiveness. Returns reply + whether sulk ended. */
  apologize(): { line: string; forgiven: boolean } {
    if (this.strikes === 0) {
      return { line: "You have nothing to apologize for. But I accept anyway.", forgiven: false };
    }
    const forgiven = true;
    this.strikes = Math.max(0, this.strikes - 2);
    return { line: pick(APOLOGY_ACCEPTED), forgiven };
  }

  grumpyWake(): string {
    return pick(GRUMPY_WAKE);
  }
}
