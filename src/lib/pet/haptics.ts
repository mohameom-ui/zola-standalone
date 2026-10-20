// ============================================================================
// DRONE PET — Cybernetic Haptic Link (WAVE 11, module 4)
// Telemetry-driven tactile feedback over the Web Gamepad haptics API.
//
// HONESTY CONTRACT: pulses fire ONLY through a physically connected gamepad's
// vibrationActuator. No gamepad → the link is DORMANT and says so — there is
// no simulated vibration, because simulated touch is not touch.
//
// Pulse profiles (all from real telemetry):
//   • motor RPM → continuous rumble magnitude
//   • soft-geofence proximity → rhythmic pulse that speeds up as distance falls
//   • visual hold / critical events → triple distress pulse
// ============================================================================

export class HapticLink {
  private gamepadIndex: number | null = null;
  private lastPulseAt = 0;
  private lastPattern = "";

  /** Feature-detect a gamepad with a real vibration actuator. */
  available(): boolean {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
    const pads = navigator.getGamepads();
    for (const p of pads) {
      if (p && p.vibrationActuator) {
        this.gamepadIndex = p.index;
        return true;
      }
    }
    this.gamepadIndex = null;
    return false;
  }

  private fire(strength: number, durationMs: number): boolean {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return false;
    const pads = navigator.getGamepads();
    const pad = (this.gamepadIndex !== null ? pads[this.gamepadIndex] : null) ?? [...(pads ?? [])].find((p) => p?.vibrationActuator) ?? null;
    if (!pad?.vibrationActuator) return false;
    void pad.vibrationActuator.playEffect("dual-rumble", {
      duration: durationMs,
      strongMagnitude: Math.min(1, strength),
      weakMagnitude: Math.min(1, strength * 0.6),
    });
    return true;
  }

  /**
   * Telemetry-driven profile, call ~4×/sec from the flight loop.
   * @param flying      is she airborne (RPM>idle)
   * @param rpm         prop RPM (real or sim-honest — labeled by caller)
   * @param geofencePct 0..1 proximity to the soft fence (0 = far)
   * @param distress    visual hold / critical battery
   */
  tick(flying: boolean, rpm: number, geofencePct: number, distress: boolean, now: number): string | null {
    if (!this.available()) return null;

    // distress: triple pulse, overrides everything
    if (distress) {
      if (now - this.lastPulseAt > 900 && this.lastPattern !== "distress") {
        this.fire(0.9, 120);
        setTimeout(() => this.fire(0.9, 120), 220);
        setTimeout(() => this.fire(0.9, 220), 440);
        this.lastPulseAt = now;
        this.lastPattern = "distress";
        return "distress-triple";
      }
      return null;
    }

    // geofence proximity: rhythmic pulse speeding up as the fence nears
    if (geofencePct > 0.7) {
      const interval = 900 - geofencePct * 700; // 200–900 ms
      if (now - this.lastPulseAt > interval) {
        this.fire(0.3 + geofencePct * 0.5, 90);
        this.lastPulseAt = now;
        this.lastPattern = "fence";
        return "fence-pulse";
      }
      return null;
    }

    // cruise: continuous rumble scaled by rotor energy, refreshed 4×/sec
    if (flying) {
      const strength = Math.min(0.45, 0.12 + (rpm / 4000) * 0.3);
      this.fire(strength, 240);
      this.lastPattern = "cruise";
      return "cruise-rumble";
    }
    this.lastPattern = "";
    return null;
  }

  get status(): string {
    return this.available() ? "LINKED" : "NO CONTROLLER";
  }
}
