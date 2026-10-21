import { describe, it, expect } from "vitest";
import { drain, drainState, canTakeOff, shouldAutoReturn, DRAIN_PER_SECOND, chargeTimeEstimate, PAD_CHARGE_PER_SECOND, REFUSE_TAKEOFF_BELOW, flightReadiness } from "./batteryPolicy";

describe("battery policy — she does NOT need the charger every 2 minutes", () => {
  it("hovering is expensive, standing is nearly free", () => {
    expect(DRAIN_PER_SECOND.airborne).toBeGreaterThan(DRAIN_PER_SECOND.walking * 10);
    expect(DRAIN_PER_SECOND.walking).toBeGreaterThan(DRAIN_PER_SECOND.standing * 3);
  });

  it("states map from her real activity + altitude", () => {
    expect(drainState("hover", 0.5)).toBe("airborne");
    expect(drainState("hover", 0.05)).toBe("standing"); // below 6 cm she is basically parked
    expect(drainState("walk", 0)).toBe("walking");
    expect(drainState("sleep", 0)).toBe("standing");
  });

  it("a mixed session lasts hours, not minutes", () => {
    // 5 min standing + 5 min walking + 30 s hover from 100%
    let b = 1;
    for (let i = 0; i < 300; i++) b = drain(b, 1, "standing");
    for (let i = 0; i < 300; i++) b = drain(b, 1, "walking");
    for (let i = 0; i < 30; i++) b = drain(b, 1, "airborne");
    expect(b).toBeGreaterThan(0.5); // most of her battery left — standing and walking are cheap
  });

  it("pure hover honest limit: ~3 min from full", () => {
    let b = 1;
    let seconds = 0;
    while (b > 0.05 && seconds < 600) { b = drain(b, 1, "airborne"); seconds++; }
    expect(seconds).toBeGreaterThan(140);
    expect(seconds).toBeLessThan(240);
  });

  it("she refuses to fly low and says why", () => {
    expect(canTakeOff(0.5).ok).toBe(true);
    expect(canTakeOff(0.1).ok).toBe(false);
    expect(canTakeOff(0.1).refusal).toMatch(/walk/i);
    expect(canTakeOff(0.03).refusal).toMatch(/critical/i);
  });

  it("auto-return triggers under the force-return threshold", () => {
    expect(shouldAutoReturn(0.07)).toBe(true);
    expect(shouldAutoReturn(0.5)).toBe(false);
  });
});

describe("chargeTimeEstimate — she knows when she'll be ready", () => {
  it("already flight-ready returns zero", () => {
    expect(chargeTimeEstimate(0.5)).toBe(0);
    expect(chargeTimeEstimate(REFUSE_TAKEOFF_BELOW)).toBe(0);
  });
  it("counts real seconds to reach the takeoff line", () => {
    // from 10%: 5 points to go at 0.004/s = 1250 s
    expect(chargeTimeEstimate(0.10)).toBe(Math.ceil(0.05 / PAD_CHARGE_PER_SECOND));
  });
});

describe("flightReadiness — the one-call answer", () => {
  it("ready now: no refusal, zero seconds", () => {
    const r = flightReadiness(0.9);
    expect(r.ready).toBe(true);
    expect(r.secondsToReady).toBe(0);
    expect(r.refusal).toBeUndefined();
  });
  it("not ready: refusal line plus real seconds to the takeoff line", () => {
    const r = flightReadiness(0.1);
    expect(r.ready).toBe(false);
    expect(r.refusal).toMatch(/walk/i);
    expect(r.secondsToReady).toBeGreaterThan(0);
  });
});
