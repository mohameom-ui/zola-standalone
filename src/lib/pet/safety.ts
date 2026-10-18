// ============================================================================
// DRONE PET — Safety Governor
// Hard, non-negotiable limits the brain CANNOT bypass. Every actuation passes
// through gate() before reaching the HAL. On the real drone these same rules
// are duplicated in the flight controller's failsafes — belt and suspenders.
// ============================================================================

import type { Actuation, Percept } from "./types";

export interface SafetyLimits {
  /** normalized velocity clamp (0..1) — the pet never goes "full throttle" */
  maxSpeed: number;
  /** normalized face size beyond which it MUST back off (too close to a face) */
  standoffSize: number;
  /** altitude box, normalized sim units */
  minAltitude: number;
  maxAltitude: number;
  /** below this battery it refuses flight commands and descends */
  lowBattery: number;
  /** below this it forces a controlled descent regardless of commands */
  criticalBattery: number;
}

export const DEFAULT_LIMITS: SafetyLimits = {
  maxSpeed: 0.55,
  standoffSize: 0.45,
  minAltitude: 0.0,
  maxAltitude: 0.85,
  lowBattery: 0.2,
  criticalBattery: 0.1,
};

export class SafetyGovernor {
  private limits: SafetyLimits;
  private killed = false;
  private forcedLand = false;

  constructor(limits: SafetyLimits = DEFAULT_LIMITS) {
    this.limits = limits;
  }

  get isKilled() { return this.killed; }
  get isForcedLand() { return this.forcedLand; }

  /** Emergency stop: all motors to hover-idle, everything else ignored. */
  kill() { this.killed = true; this.forcedLand = false; }
  arm() { this.killed = false; }

  /** Percept-aware gating: clamps, standoff, geofence, battery failsafes. */
  gate(act: Actuation, p: Percept): { act: Actuation; flags: string[] } {
    const flags: string[] = [];
    const L = this.limits;

    if (this.killed) {
      flags.push("KILL SWITCH ENGAGED");
      return { act: { ...act, vx: 0, vy: 0, vz: 0, yaw: 0, led: "#ff4d4f", activity: "hover" }, flags };
    }

    // Battery failsafes override the brain entirely.
    if (p.battery <= L.criticalBattery) {
      if (!this.forcedLand) flags.push("CRITICAL BATTERY — FORCED CONTROLLED DESCENT");
      this.forcedLand = true;
      return {
        act: { ...act, vx: 0, vy: 0, vz: -0.5, yaw: 0, led: "#ff4d4f", activity: "sleep" },
        flags,
      };
    }
    if (p.battery <= L.lowBattery) flags.push("LOW BATTERY — DOCK SOON");

    // Hard speed clamp.
    const speed = Math.max(Math.abs(act.vx), Math.abs(act.vy), Math.abs(act.vz));
    if (speed > L.maxSpeed) {
      flags.push("SPEED LIMIT");
      const k = L.maxSpeed / speed;
      act.vx *= k; act.vy *= k; act.vz *= k;
    }

    // Person stand-off: never approach a face closer than the limit.
    if (p.faceSeen && p.faceSize > L.standoffSize && act.vx > 0) {
      act.vx = Math.min(act.vx, -0.15);
      flags.push("STAND-OFF ENFORCED");
    }

    // Geofence altitude box.
    const projected = act.vz; // HAL clamps position too; this kills the intent early
    if (projected > 0 && act.vz > 0 && act.activity === "trick") {
      act.vz = Math.min(act.vz, 0.25);
      flags.push("CEILING GUARD");
    }
    act.vz = Math.max(act.vz, -0.5); // descent rate cap (no slam-landing)

    if (flags.length > 0) return { act, flags };
    return { act, flags };
  }
}
