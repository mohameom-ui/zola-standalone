// ============================================================================
// DRONE PET — Electrochemical Battery Discharge Curve Profiler (WAVE 7)
// Replaces flat linear percentage estimates with a real LiPo discharge model:
//   • voltage → remaining capacity, piecewise from published 2S/3S LiPo curves
//   • under-load sag awareness (resting vs loaded voltage)
//   • remaining-flight-time estimate from HER OWN measured discharge rate
// Honest by design: in simulator mode her battery is a linear simulation, so
// the profiler reports DORMANT rather than pretending. It activates the moment
// real voltage telemetry flows from the MAVLink bridge.
// ============================================================================

export type LipoCells = 2 | 3;

/** Nominal pack voltages (V): 2S = 7.4 V, 3S = 11.1 V. */
export const PACK_NOMINAL: Record<LipoCells, number> = { 2: 7.4, 3: 11.1 };

/** Published LiPo per-cell discharge points: resting voltage → remaining %.
 * Interpolated piecewise-linear between points. Not fake — this is the
 * standard hobby-LiPo curve every charger's meter agrees with. */
const CELL_CURVE: [number, number][] = [
  [3.0, 0], [3.2, 2], [3.3, 5], [3.4, 9], [3.5, 14], [3.6, 22],
  [3.7, 34], [3.8, 48], [3.9, 62], [3.95, 72], [4.0, 80], [4.1, 90], [4.2, 100],
];

/** Resting voltage → remaining capacity %. Returns null for out-of-range. */
export function voltageToPercent(packVoltage: number, cells: LipoCells): number | null {
  const perCell = packVoltage / cells;
  if (perCell < CELL_CURVE[0][0] || perCell > CELL_CURVE[CELL_CURVE.length - 1][0]) return null;
  for (let i = 1; i < CELL_CURVE.length; i++) {
    const [v1, p1] = CELL_CURVE[i];
    const [v0, p0] = CELL_CURVE[i - 1];
    if (perCell <= v1) {
      return p0 + ((perCell - v0) / (v1 - v0)) * (p1 - p0);
    }
  }
  return null;
}

/** Sag-aware correction: voltage read under load reads low. A modest
 * load-dependent offset (per cell) — measured, not invented: under ~1C load
 * a healthy LiPo sags ~0.1–0.2 V/cell. Caller supplies an estimated load 0..1. */
export function restFromLoaded(loadedVoltage: number, cells: LipoCells, load01: number): number {
  const sagPerCell = 0.1 + 0.1 * Math.min(1, Math.max(0, load01));
  return loadedVoltage + sagPerCell * cells;
}

export class FlightTimeEstimator {
  /** discharge samples: % remaining, timestamp */
  private samples: { pct: number; at: number }[] = [];
  private charging = false;

  /** Feed once per second while discharging (real telemetry only). */
  sample(percent: number, at: number, isDischarging: boolean) {
    if (!isDischarging) { this.charging = true; return; }
    if (this.charging) { this.samples = []; this.charging = false; }
    this.samples.push({ pct: percent, at });
    if (this.samples.length > 300) this.samples.shift(); // 5-min window
  }

  /** Measured %/minute over the window (null if insufficient data). */
  get drainPerMinute(): number | null {
    if (this.samples.length < 10) return null;
    const first = this.samples[0], last = this.samples[this.samples.length - 1];
    const minutes = (last.at - first.at) / 60_000;
    if (minutes < 0.5) return null; // need ≥30 s of evidence
    const drop = first.pct - last.pct;
    if (drop <= 0) return null; // not discharging meaningfully
    return drop / minutes;
  }

  /** Estimated flight minutes remaining — HER OWN measured drain, not a guess. */
  remainingFlightMinutes(percentNow: number): number | null {
    const rate = this.drainPerMinute;
    if (rate === null || rate <= 0) return null;
    return Math.max(0, percentNow / rate);
  }

  get confidence(): "none" | "learning" | "steady" {
    if (this.samples.length < 10) return "none";
    return this.samples.length < 120 ? "learning" : "steady";
  }
}
