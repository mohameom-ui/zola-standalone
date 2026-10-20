// ============================================================================
// DRONE PET — Autonomous Post-Flight Diagnostics (WAVE 8)
// Deterministic analysis over the black-box ring the moment a flight ends.
// Every number is computed from REAL recorded signals; every threshold is
// labeled as sim-tuned and marked for recalibration on the real airframe.
// Nothing here invents data: sections that need signals she doesn't record
// yet (voltage sag under load, serial-layer jitter) report DORMANT / STAGED
// instead of plausible-looking guesses.
// ============================================================================

import type { BlackboxEntry } from "./blackbox";

export interface DiagnosticsResult {
  verdict: "NOMINAL" | "REVIEW" | "INSUFFICIENT DATA";
  lines: string[];       // markdown bullet lines, ready for the vlog
  headline: string;      // one spoken sentence
  flagsSeen: Record<string, number>;
}

function stddev(values: number[]): number | null {
  if (values.length < 10) return null; // honesty: no analysis on thin data
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Sim-tuned thresholds (her bob amplitude is 0.035 normalized ≈ <1° attitude
 * sway). RECALIBRATE with real-airframe data before trusting these on carbon. */
const THRESHOLDS = {
  attitudeSigmaDeg: 2.0,   // hover attitude stability
  altSigmaMeters: 0.05,    // hover altitude hold
  loopJitterPct: 25,       // black-box sampling regularity (2 Hz target)
};

export function runDiagnostics(entries: BlackboxEntry[], source: "sim" | "real"): DiagnosticsResult {
  const lines: string[] = [];
  const flagsSeen: Record<string, number> = {};
  for (const e of entries) {
    if (!e.flags) continue;
    for (const f of e.flags.split(",")) {
      const key = f.trim();
      if (key) flagsSeen[key] = (flagsSeen[key] ?? 0) + 1;
    }
  }

  const hover = entries.filter((e) => e.activity === "hover" || e.activity === "follow");
  let verdict: DiagnosticsResult["verdict"] = "NOMINAL";
  let review: string[] = [];

  // 1 — attitude stability during hover (the vibration/imbalance early-warning)
  const attitudes = hover
    .map((e) => (e.pitch !== undefined && e.roll !== undefined ? Math.max(Math.abs(e.pitch), Math.abs(e.roll)) : null))
    .filter((v): v is number => v !== null);
  const attSigma = stddev(attitudes);
  if (attSigma === null) {
    lines.push("- attitude stability: DORMANT — attitude data not in this window");
  } else {
    const ok = attSigma <= THRESHOLDS.attitudeSigmaDeg;
    lines.push(`- attitude stability (hover): σ **${attSigma.toFixed(3)}°** — ${ok ? "nominal" : "above threshold"}`);
    if (!ok) review.push(`attitude σ ${attSigma.toFixed(2)}° (thr ${THRESHOLDS.attitudeSigmaDeg}°)`);
  }

  // 2 — altitude hold quality
  const alts = hover.map((e) => e.alt);
  const altSigma = stddev(alts);
  if (altSigma === null) {
    lines.push("- altitude hold: DORMANT — insufficient hover samples");
  } else {
    const ok = altSigma <= THRESHOLDS.altSigmaMeters;
    lines.push(`- altitude hold (hover): σ **${altSigma.toFixed(3)} m** — ${ok ? "nominal" : "above threshold"}`);
    if (!ok) review.push(`altitude σ ${altSigma.toFixed(3)} m`);
  }

  // 3 — control-loop regularity (jitter of the ~2 Hz black-box sampling)
  const times = entries.map((e) => Date.parse(e.t)).filter((t) => !Number.isNaN(t));
  let jitterPct: number | null = null;
  if (times.length >= 10) {
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    jitterPct = mean > 0 ? (sd / mean) * 100 : null;
  }
  if (jitterPct === null) {
    lines.push("- loop regularity: DORMANT — insufficient samples");
  } else {
    const ok = jitterPct <= THRESHOLDS.loopJitterPct;
    lines.push(`- loop regularity: jitter **${jitterPct.toFixed(1)}%** — ${ok ? "nominal" : "above threshold"}`);
    if (!ok) review.push(`loop jitter ${jitterPct.toFixed(0)}%`);
  }

  // 4 — voltage sag: requires voltage telemetry she doesn't record in sim
  lines.push(`- voltage sag analysis: **DORMANT** (${source === "sim" ? "sim battery is linear" : "voltage telemetry not yet streamed"} — activates with MAVLink BATTERY_STATUS)`);

  // 5 — safety events observed
  const flagKeys = Object.keys(flagsSeen);
  if (flagKeys.length > 0) {
    lines.push(`- safety events: ${flagKeys.map((k) => `${k} ×${flagsSeen[k]}`).join(", ")}`);
    for (const k of flagKeys) {
      if (/BREACH|CRITICAL|HOLD/.test(k)) review.push(`safety: ${k}`);
    }
  } else {
    lines.push("- safety events: none — clean flight");
  }

  if (entries.length < 40) {
    return { verdict: "INSUFFICIENT DATA", lines: ["- ring holds too few samples for honest analysis"], headline: "Not enough flight data for honest diagnostics yet.", flagsSeen };
  }
  verdict = review.length > 0 ? "REVIEW" : "NOMINAL";
  lines.push("", `*thresholds are sim-tuned — recalibrate against real airframe data before bench judgment.*`);

  const headline = verdict === "NOMINAL"
    ? `Flight check complete: nominal. Attitude sigma ${attSigma !== null ? attSigma.toFixed(2) : "n/a"} degrees, ${flagKeys.length} safety events.`
    : `Flight check flags review: ${review.slice(0, 2).join("; ")}.`;

  return { verdict, lines, headline, flagsSeen };
}
