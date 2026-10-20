// ============================================================================
// DRONE PET — Sun Awareness (WAVE 3, room ecology)
// A LOCAL light model: where the sun is in her sky right now, computed from
// the clock and the season alone — no location services, no network, no API.
// Honest about being approximate (fixed mid-latitude). She uses it for mood
// color: golden hours are her favorite flying weather; night is quiet time.
// ============================================================================

export type SunPhase = "night" | "dawn" | "morning" | "midday" | "golden" | "dusk";

export interface SunReport {
  phase: SunPhase;
  /** 0 = dark, 1 = high sun */
  altitude: number;
  note: string;
}

/** Approximate day length factor per month (mid-latitude, northern hemisphere). */
const SUNRISE_BY_MONTH = [7.2, 6.9, 6.5, 6.1, 5.6, 5.3, 5.5, 6.0, 6.5, 7.0, 7.4, 7.7]; // ~h
const SUNSET_BY_MONTH = [17.0, 17.6, 18.2, 18.9, 19.6, 20.2, 20.3, 19.7, 18.9, 18.1, 17.3, 16.9];

export function sunReport(now = new Date()): SunReport {
  const month = now.getMonth();
  const hour = now.getHours() + now.getMinutes() / 60;
  const rise = SUNRISE_BY_MONTH[month];
  const set = SUNSET_BY_MONTH[month];
  const noon = (rise + set) / 2;

  if (hour < rise - 0.5 || hour > set + 0.5) {
    return { phase: "night", altitude: 0, note: "night — her dark, calm hours" };
  }
  if (hour < rise + 1.2) {
    return { phase: "dawn", altitude: 0.25, note: "dawn — the sky is warming up" };
  }
  if (hour > set - 1.2) {
    return { phase: "golden", altitude: 0.3, note: "golden hour — her favorite flying light" };
  }
  if (hour < noon - 2) {
    return { phase: "morning", altitude: 0.6, note: "morning sun — good visibility" };
  }
  if (hour > noon + 2.5) {
    return { phase: "dusk", altitude: 0.45, note: "afternoon light, softening" };
  }
  // high sun — altitude curves with distance from solar noon
  const t = 1 - Math.abs(hour - noon) / 2.5;
  return { phase: "midday", altitude: Math.max(0.7, Math.min(1, 0.7 + t * 0.3)), note: "high sun — shadows are short" };
}

/** Is this one of her favorite light moments? (rate-limited use in chatter) */
export function isGoldenHour(now = new Date()): boolean {
  return sunReport(now).phase === "golden";
}

// ---- WAVE 6 — CIRCADIAN VOICE MODEL ----------------------------------------
// Her acoustic presence follows human circadian rhythms: brighter, slightly
// faster delivery in the morning; softer, lower, slower toward evening/night.
// Pure clock math — no network, Pi-safe.
export function circadianVoice(now = new Date()): { rate: number; pitch: number; label: string } {
  const phase = sunReport(now).phase;
  switch (phase) {
    case "dawn": return { rate: 1.03, pitch: 1.06, label: "morning-bright" };
    case "morning": return { rate: 1.05, pitch: 1.08, label: "morning-bright" };
    case "midday": return { rate: 1.0, pitch: 1.0, label: "neutral" };
    case "golden": return { rate: 0.96, pitch: 0.95, label: "evening-soft" };
    case "dusk": return { rate: 0.95, pitch: 0.93, label: "evening-soft" };
    case "night": return { rate: 0.92, pitch: 0.88, label: "night-quiet" };
  }
}

/** WAVE 6.6 — envelope shape per phase: morning chirps are crisp (fast attack,
 * quick decay); evening/night chirps are round (slow attack, long release). */
export function circadianEnvelope(now = new Date()): { attack: number; release: number; label: string } {
  const phase = sunReport(now).phase;
  switch (phase) {
    case "dawn": return { attack: 0.8, release: 0.85, label: "crisp" };
    case "morning": return { attack: 0.7, release: 0.8, label: "crisp" };
    case "midday": return { attack: 1.0, release: 1.0, label: "neutral" };
    case "golden": return { attack: 1.3, release: 1.4, label: "round" };
    case "dusk": return { attack: 1.5, release: 1.6, label: "round" };
    case "night": return { attack: 1.8, release: 2.0, label: "velvet" };
  }
}
