// ============================================================================
// DRONE PET — Autonomous Mission Executor (WAVE 10)
// Deterministic waypoint + orbit-POI missions as a pure state machine.
//
// ARCHITECTURE CONTRACT:
//   • The executor PROPOSES actuation — the SafetyGovernor still gates every
//     frame (soft geofence, visual hold, battery failsafes override missions,
//     never the reverse).
//   • Override handoff: when the governor reports a breach/hold flag, the
//     mission PAUSES itself (holding pattern) instead of fighting the safety
//     layer; it resumes when the flags clear.
//   • Waypoint tolerance is checked against ACTUAL pose — no dead-reckoning:
//     if she can't confirm arrival, she holds rather than guesses.
// ============================================================================

export interface Waypoint {
  x: number;
  y: number;
  z: number;
  holdMs: number;
}

interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface MissionAct {
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
}

export type MissionStatus =
  | { state: "idle" }
  | { state: "goto"; step: number; of: number; dist: number }
  | { state: "hold"; step: number; of: number; remainingMs: number }
  | { state: "orbit"; angle: number; radius: number }
  | { state: "paused"; reason: string }
  | { state: "done" };

const ARRIVAL_TOLERANCE = 0.12;  // meters (sim-exact; real VIO tightens this)
const MAX_MISSION_SPEED = 0.35;  // below her governor clamp — missions are calm

export class MissionExecutor {
  private steps: Waypoint[] = [];
  private i = 0;
  private phase: "goto" | "hold" = "goto";
  private holdUntil = 0;
  private orbiting: { cx: number; cy: number; cz: number; radius: number; angle: number; dir: 1 | -1 } | null = null;
  private pausedReason: string | null = null;
  private done = false;
  private orbitLaps = 0; // radians of arc remaining (laps × 2π)

  active(): boolean {
    return this.steps.length > 0 || this.orbiting !== null;
  }

  isPaused(): boolean {
    return this.pausedReason !== null;
  }

  status(): MissionStatus {
    if (this.orbiting) return { state: "orbit", angle: this.orbiting.angle, radius: this.orbiting.radius };
    if (this.done) return { state: "done" };
    if (this.pausedReason) return { state: "paused", reason: this.pausedReason };
    if (this.steps.length === 0) return { state: "idle" };
    const wp = this.steps[this.i];
    if (this.phase === "goto") return { state: "goto", step: this.i + 1, of: this.steps.length, dist: Math.hypot(wp.x - this.lastX, wp.y - this.lastY) };
    return { state: "hold", step: this.i + 1, of: this.steps.length, remainingMs: Math.max(0, this.holdUntil - Date.now()) };
  }

  private lastX = 0;
  private lastY = 0;

  /** Queue a waypoint mission. Returns the confirmation line. */
  begin(steps: Waypoint[]): string {
    if (steps.length === 0) return "Mission list is empty.";
    this.steps = steps.map((s) => ({ ...s, holdMs: Math.max(0, s.holdMs) }));
    this.i = 0;
    this.phase = "goto";
    this.orbiting = null;
    this.done = false;
    this.pausedReason = null;
    return `Mission loaded: ${this.steps.length} waypoints — executing now.`;
  }

  /** Orbit-POI: circle a point at a standoff radius, camera locked inward.
   * laps = number of full circles to fly before completing. */
  orbit(cx: number, cy: number, cz: number, radius: number, dir: 1 | -1, laps: number): string {
    this.orbiting = { cx, cy, cz, radius: Math.max(0.4, radius), angle: Math.atan2(cy - this.lastY, cx - this.lastX) + Math.PI, dir };
    this.orbitLaps = Math.max(0.25, laps) * Math.PI * 2;
    this.steps = [];
    this.done = false;
    this.pausedReason = null;
    return `Orbit mode: circling point (${cx.toFixed(2)}, ${cy.toFixed(2)}) at ${radius.toFixed(2)} m standoff, camera locked.`;
  }

  abort(reason = "mission aborted"): string {
    const had = this.active();
    this.steps = [];
    this.orbiting = null;
    this.done = false;
    this.pausedReason = null;
    return had ? `Mission aborted — ${reason}. Control released.` : "No mission running.";
  }

  pause(reason: string) {
    if (this.active() && !this.pausedReason) this.pausedReason = reason;
  }

  /** Resume when the safety flags that paused her have cleared. */
  maybeResume(safetyClean: boolean) {
    if (this.pausedReason && safetyClean) this.pausedReason = null;
  }

  /**
   * Advance the mission one frame. Returns actuation to gate through the
   * governor, or null when idle/done/paused (hover in place while paused).
   */
  tick(pose: Pose, dt: number, now: number): { act: MissionAct | null; event: string | null } {
    this.lastX = pose.x;
    this.lastY = pose.y;
    if (this.pausedReason) return { act: null, event: null }; // hold pattern: zero motion

    if (this.orbiting) {
      const o = this.orbiting;
      const omega = (0.25 / o.radius) * o.dir; // 0.25 m/s tangential
      o.angle += omega * dt;
      const tx = o.cx + Math.cos(o.angle) * o.radius;
      const ty = o.cy + Math.sin(o.angle) * o.radius;
      const dx = tx - pose.x, dy = ty - pose.y;
      const dist = Math.hypot(dx, dy);
      // camera lock: yaw toward the POI at the circle's center
      const yawTarget = Math.atan2(o.cy - pose.y, o.cx - pose.x);
      let yawErr = yawTarget - pose.yaw;
      while (yawErr > Math.PI) yawErr -= Math.PI * 2;
      while (yawErr < -Math.PI) yawErr += Math.PI * 2;
      const act: MissionAct = {
        vx: dx * 1.4,
        vy: dy * 1.4,
        vz: (o.cz - pose.z) * 0.8,
        yaw: Math.max(-1, Math.min(1, yawErr * 2.0)),
      };
      // laps are tracked as total angle to travel (radians)
      this.orbitLaps -= Math.abs(omega) * dt;
      if (this.orbitLaps <= 0) {
        this.orbiting = null;
        this.done = true;
        return { act: null, event: "orbit complete — camera was locked throughout" };
      }
      return { act, event: null };
    }

    if (this.done || this.steps.length === 0) return { act: null, event: null };
    const wp = this.steps[this.i];

    if (this.phase === "goto") {
      const dx = wp.x - pose.x, dy = wp.y - pose.y, dz = wp.z - pose.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < ARRIVAL_TOLERANCE) {
        this.phase = "hold";
        this.holdUntil = now + wp.holdMs;
        return { act: null, event: `waypoint ${this.i + 1} reached — holding ${wp.holdMs} ms` };
      }
      const speed = Math.min(MAX_MISSION_SPEED, dist * 1.2);
      return {
        act: { vx: (dx / dist) * speed, vy: (dy / dist) * speed, vz: Math.max(-0.3, Math.min(0.3, dz * 1.0)), yaw: 0 },
        event: null,
      };
    }

    // hold phase
    if (now >= this.holdUntil) {
      this.i += 1;
      this.phase = "goto";
      if (this.i >= this.steps.length) {
        this.done = true;
        this.steps = [];
        return { act: null, event: "mission complete" };
      }
      return { act: null, event: `waypoint ${this.i} done — proceeding to ${this.i + 1} of ${this.steps.length}` };
    }
    return { act: null, event: null };
  }

  /** Human-readable status for the HUD. */
  hudStatus(): string {
    const s = this.status();
    if (s.state === "idle") return "NO MISSION";
    if (s.state === "done") return "MISSION COMPLETE";
    if (s.state === "paused") return `PAUSED · ${s.reason}`;
    if (s.state === "orbit") return `ORBIT · r=${s.radius.toFixed(2)} · cam locked`;
    if (s.state === "goto") return `WP ${s.step}/${s.of} · ${s.dist.toFixed(2)} m`;
    return `HOLD ${Math.round(s.remainingMs / 100) / 10}s`;
  }
}
