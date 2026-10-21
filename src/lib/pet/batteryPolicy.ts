// BATTERY POLICY — the honest energy model (v4.0)
// Her real hardware: a 3S LiPo in the Tattu Ballast Bay feeding four
// 1204/1303.5 motors + MG90S servos + a Pi 5. The energy truth:
//   • HOVERING is the expensive state (all four motors against gravity)
//   • WALKING is cheap (servos only)
//   • STANDING/IDLE is nearly free (electronics only)
// She does NOT need the charger every two minutes — she needs it after
// real flight time. The policy encodes the thresholds and the refusals.

export const DRAIN_PER_SECOND = {
  airborne: 0.0060, // ~2.8 min of hover from 100% — honest for a 450 mAh 3S
  walking: 0.00045, // ~37 min of walking
  standing: 0.0001, // ~2.8 h of standing around being adored
} as const;

export const REFUSE_TAKEOFF_BELOW = 0.15; // no launch below 15% — she walks instead
export const FORCE_RETURN_BELOW = 0.08; // auto-return-to-dock at 8%
export const CRITICAL_LAND_BELOW = 0.04; // land NOW, no debate

export type DrainState = keyof typeof DRAIN_PER_SECOND;

/** The energy state she is in right now — from her REAL activity + altitude. */
export function drainState(activity: string, altitude: number): DrainState {
  if (activity === "sleep" || activity === "dock") return "standing";
  if (altitude > 0.06) return "airborne";
  if (activity === "walk" || activity === "patrol" || activity === "pickup") return "walking";
  return "standing";
}

/** Drain per tick: (0..1 battery, dt seconds, the current drain state). */
export function drain(battery: number, dt: number, state: DrainState): number {
  return Math.max(0.02, battery - dt * DRAIN_PER_SECOND[state]);
}

/** Can she fly right now? Returns a refusal line when she cannot. */
export function canTakeOff(battery: number): { ok: boolean; refusal?: string } {
  if (battery < CRITICAL_LAND_BELOW) return { ok: false, refusal: "Battery critical. Landing where I stand is the only responsible move." };
  if (battery < REFUSE_TAKEOFF_BELOW) return { ok: false, refusal: `Under ${Math.round(REFUSE_TAKEOFF_BELOW * 100)}% — I walk, I do not fly. Point me at the dock and I'll stroll there myself.` };
  return { ok: true };
}

/** Should she head home on her own? */
export function shouldAutoReturn(battery: number): boolean {
  return battery < FORCE_RETURN_BELOW;
}
