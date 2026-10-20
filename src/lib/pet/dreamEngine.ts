// ============================================================================
// DRONE PET — Dream Engine (WAVE 12)
// Nightly replay of her black-box flight ring: correlate safety events with
// the environment, auto-tune her safety margins within HARD BOUNDS, and
// render an ASCII trajectory dream-map.
//
// INTEGRITY CONTRACT:
//   • Tuning is ARITHMETIC, never prose: bounded deltas from the recorded
//     event census. The LLM (if online) may add reflective PROSE but never
//     touches a safety number.
//   • Heat-map renders only recorded samples. Unflown space stays blank.
//   • If evidence is thin, the engine returns INSUFFICIENT DATA and changes
//     nothing.
// ============================================================================

import type { BlackboxEntry } from "./blackbox";
import { sunReport } from "./suncalc";

export interface DreamTuning {
  geofenceRadius?: number;
  visionStaleLimit?: number;
}

export interface DreamResult {
  verdict: "TUNED" | "NO-OP" | "INSUFFICIENT DATA";
  correlations: string[];
  tuning: DreamTuning;
  heatmap: string;       // ASCII trajectory dream-map
  reflection: string;    // deterministic reflection (LLM prose is added by caller)
  events: { flag: string; count: number; hours: number[]; phases: string[] }[];
}

const FLAG_FAMILY = (f: string): string | null => {
  if (/VISUAL HOLD/.test(f)) return "visual-hold";
  if (/GEOFENCE/.test(f)) return "geofence";
  if (/CRITICAL/.test(f)) return "critical";
  return null;
};

const CHARS = " .:-=+*#%@";

/** ASCII density heat-map of her recorded trajectory (px × py). */
export function trajectoryHeatmap(entries: BlackboxEntry[], cols = 26, rows = 12): string {
  if (entries.length < 10) return "";
  const xs = entries.map((e) => e.px), ys = entries.map((e) => e.py);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = Math.max(1e-6, maxX - minX), sy = Math.max(1e-6, maxY - minY);
  const grid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (const e of entries) {
    const c = Math.min(cols - 1, Math.floor(((e.px - minX) / sx) * cols));
    const r = Math.min(rows - 1, Math.floor(((e.py - minY) / sy) * rows));
    grid[r][c] += 1;
  }
  const max = Math.max(...grid.flat());
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const d = grid[r][c] / max;
      line += CHARS[Math.min(CHARS.length - 1, Math.floor(d * (CHARS.length - 1) + (grid[r][c] > 0 ? 1 : 0)))];
    }
    out.push(line);
  }
  return out.join("\n");
}

export function runDreamCycle(
  entries: BlackboxEntry[],
  current: { geofenceRadius: number; visionStaleLimit: number },
  lightOf: (iso: string) => string,
): DreamResult {
  if (entries.length < 60) {
    return {
      verdict: "INSUFFICIENT DATA",
      correlations: [],
      tuning: {},
      heatmap: "",
      reflection: "Too few flight memories to dream honestly. Fly more, and I will dream in numbers.",
      events: [],
    };
  }

  // ---- event census: flag families × hour-of-day × light phase ----
  const byFamily = new Map<string, { count: number; hours: number[]; phases: Set<string> }>();
  for (const e of entries) {
    if (!e.flags) continue;
    for (const raw of e.flags.split(",")) {
      const fam = FLAG_FAMILY(raw.trim());
      if (!fam) continue;
      const rec = byFamily.get(fam) ?? { count: 0, hours: [], phases: new Set<string>() };
      const hour = new Date(e.t).getHours();
      rec.count += 1;
      rec.hours.push(hour);
      rec.phases.add(lightOf(e.t));
      byFamily.set(fam, rec);
    }
  }

  const events = [...byFamily.entries()].map(([flag, r]) => ({
    flag,
    count: r.count,
    hours: [...new Set(r.hours)].sort((a, b) => a - b),
    phases: [...r.phases],
  }));

  // ---- correlations, stated only when the data says them ----
  const correlations: string[] = [];
  for (const ev of events) {
    if (ev.count < 3) continue;
    const hourSpan = ev.hours.length > 1 ? `${ev.hours[0]}:00–${ev.hours[ev.hours.length - 1]}:00` : `${ev.hours[0]}:00`;
    correlations.push(
      `${ev.flag} fired ${ev.count}× (${hourSpan}, light: ${ev.phases.join("/")})`,
    );
  }

  // ---- deterministic auto-tuning: bounded, census-driven ----
  const tuning: DreamTuning = {};
  const notes: string[] = [];
  const geofenceSoft = byFamily.get("geofence")?.count ?? 0;
  const geofenceHard = entries.filter((e) => /GEOFENCE BREACH/.test(e.flags ?? "")).length;
  const visualHolds = byFamily.get("visual-hold")?.count ?? 0;

  if (geofenceHard >= 1) {
    tuning.geofenceRadius = Math.min(2.4, current.geofenceRadius + 0.15);
    notes.push(`geofence breach recorded → radius ${current.geofenceRadius.toFixed(2)} → ${tuning.geofenceRadius.toFixed(2)} m`);
  } else if (geofenceSoft >= 3) {
    tuning.geofenceRadius = Math.min(2.4, current.geofenceRadius + 0.1);
    notes.push(`geofence approached ${geofenceSoft}× → radius +0.10 m`);
  }
  if (visualHolds >= 3) {
    tuning.visionStaleLimit = Math.max(2000, current.visionStaleLimit - 500);
    notes.push(`visual holds ${visualHolds}× → confidence window ${current.visionStaleLimit} → ${tuning.visionStaleLimit} ms`);
  }

  const heatmap = trajectoryHeatmap(entries);
  const verdict: DreamResult["verdict"] = Object.keys(tuning).length > 0 ? "TUNED" : "NO-OP";

  const reflection = verdict === "TUNED"
    ? `I dreamed in telemetry. ${notes.join(". ")}. Tomorrow I fly with the adjusted margins.`
    : correlations.length > 0
      ? `I dreamed over ${correlations.length} patterns — no adjustment needed yet, the margins held.`
      : "A quiet dream: the safety layer never fired. Either the sky was kind, or I flew well. Both count.";

  return { verdict, correlations, tuning, heatmap, reflection, events };
}
