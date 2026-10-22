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
  /** WAVE 7 — soft geofence radius (horizontal, around home/origin). 0 = disabled. */
  geofenceRadius: number;
  /** WAVE 12 — vision-confidence hold threshold (ms without detections).
   * Dream auto-tuning may tighten this — bounded, never above the default. */
  visionStaleLimit: number;
}

export const DEFAULT_LIMITS: SafetyLimits = {
  maxSpeed: 0.55,
  standoffSize: 0.45,
  minAltitude: 0.0,
  maxAltitude: 0.85,
  lowBattery: 0.2,
  criticalBattery: 0.1,
  geofenceRadius: 1.2,
  visionStaleLimit: 4000,
};

export class SafetyGovernor {
  private limits: SafetyLimits;
  private killed = false;
  private forcedLand = false;
  /** WAVE 7 — is her vision feed expected to be live? (set by the panel) */
  private visionFeed = false;
  setVisionFeed(on: boolean) { this.visionFeed = on; }

  /** WAVE 12 — dream auto-tuning: apply a bounded patch to the limits.
   * Clamped to sane ranges — tuning can loosen nothing below floor, tighten
   * nothing past the default. Auto-tune adjusts margins, never disables safety. */
  setLimits(patch: Partial<SafetyLimits>) {
    if (patch.geofenceRadius !== undefined) {
      // the doc says it: tighten freely to the 0.6 floor, NEVER loosen past
      // the default — the old clamp allowed 2.4 (double the fence)
      this.limits.geofenceRadius = Math.min(DEFAULT_LIMITS.geofenceRadius, Math.max(0.6, patch.geofenceRadius));
    }
    if (patch.visionStaleLimit !== undefined) {
      this.limits.visionStaleLimit = Math.min(4000, Math.max(2000, patch.visionStaleLimit));
    }
  }
  get currentLimits(): SafetyLimits {
    return { ...this.limits };
  }
  /** WAVE 11 — PREDICTIVE TRAJECTORY GOVERNOR: an optional forecaster that
   * inspects a predicted future position (pose + measured velocity × horizon)
   * and returns a deceleration order if that future is unsafe. Wired by the
   * panel to the 3D occupancy map — the governor stays map-agnostic. */
  private predictor: ((px: number, py: number, pz: number, vx: number, vy: number, vz: number) => { decel: number; reason: string } | null) | null = null;
  setPredictor(fn: NonNullable<typeof this.predictor>) { this.predictor = fn; }

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

    // WAVE 11 — PREDICTIVE TRAJECTORY: extrapolate her MEASURED velocity 1.5 s
    // into the future. A predicted geofence breach decelerates her BEFORE the
    // soft fence reacts; a predicted occupied voxel orders hard deceleration.
    const vel = p.vel;
    if (vel && this.limits.geofenceRadius > 0) {
      const HORIZON = 1.5;
      const fx = p.px + vel.x * HORIZON, fy = p.py + vel.y * HORIZON;
      const fr = Math.hypot(fx, fy);
      if (fr > this.limits.geofenceRadius * 0.95) {
        const ux = fx / (fr || 1), uy = fy / (fr || 1);
        const outward = act.vx * ux + act.vy * uy;
        if (outward > 0) {
          act.vx -= ux * outward * 0.6;
          act.vy -= uy * outward * 0.6;
          flags.push("PREDICTIVE GEOFENCE · DECEL");
        }
      }
      const occ = this.predictor?.(fx, fy, p.pz + vel.z * HORIZON, vel.x, vel.y, vel.z);
      if (occ) {
        act.vx *= occ.decel; act.vy *= occ.decel; act.vz *= occ.decel;
        flags.push(occ.reason);
      }
    }

    // WAVE 7 — SOFT GEOFENCE: horizontal cylinder around home. At 85% of the
    // radius, outward velocity is proportionally canceled and an inward return
    // vector takes over — BEFORE the HAL/flight-controller hard clamp is needed.
    const R = this.limits.geofenceRadius;
    const r = Math.hypot(p.px, p.py);
    if (R > 0 && r > R * 0.85) {
      const ux = p.px / (r || 1), uy = p.py / (r || 1); // outward unit vector
      const outward = act.vx * ux + act.vy * uy;
      const breached = r >= R;
      if (outward > 0 || breached) {
        const factor = breached ? 0 : Math.max(0, 1 - (r - R * 0.85) / (R * 0.15));
        const canceled = Math.max(0, outward) * (1 - factor);
        act.vx -= ux * canceled;
        act.vy -= uy * canceled;
        // safe return-to-center vector — gentle inside the zone, firm past it
        const inward = breached ? 0.3 : 0.12 * (1 - factor);
        act.vx -= ux * inward;
        act.vy -= uy * inward;
        flags.push(breached ? "GEOFENCE BREACH — RETURNING HOME" : `SOFT GEOFENCE · ${Math.round((r / R) * 100)}%`);
      }
    }

    // WAVE 7 — VISUAL CONFIDENCE SAFEGUARD: if her feed is expected live but
    // produced nothing for the hold window (lighting drop, feature loss — WAVE 12:
    // window is dream-tunable), degrade to a conservative inertial hold: minimal
    // motion, altitude locked, until detections resume. Honest everywhere.
    if (this.visionFeed && (p.visionStaleMs ?? 0) > this.limits.visionStaleLimit) {
      const k = 0.25;
      act.vx *= k; act.vy *= k; act.vz = 0; // altitude lock
      flags.push("VISUAL HOLD · CONFIDENCE LOW");
    }

    // Geofence altitude box — enforced HERE, not just in the sim HAL: on the
    // real frame no SimDroneHAL clamp exists, so the ceiling must live in the
    // governor (the FC failsafe is the second belt, never the only one).
    if (p.pz >= L.maxAltitude && act.vz > 0) {
      act.vz = 0;
      flags.push("CEILING — ALTITUDE BOX");
    }
    if (p.pz <= L.minAltitude && act.vz < 0 && act.activity !== "sleep" && act.activity !== "dock") {
      // below-floor intent is refused — EXCEPT landing (sleep/dock own their descent)
      act.vz = 0;
      flags.push("FLOOR — ALTITUDE BOX");
    }
    act.vz = Math.max(act.vz, -0.5); // descent rate cap (no slam-landing)

    if (flags.length > 0) return { act, flags };
    return { act, flags };
  }
}
