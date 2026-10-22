// SAFETY GOVERNOR — test suite. This is the code that must never be wrong:
// it is the layer her brain CANNOT bypass. Every test here is a situation
// where getting it wrong hurts something real.

import { describe, it, expect } from "vitest";
import { SafetyGovernor, DEFAULT_LIMITS } from "./safety";
import type { Actuation, Percept } from "./types";

const basePercept: Percept = {
  battery: 0.86,
  faceSeen: false,
  faceSize: 0,
  faceX: 0,
  faceY: 0,
  visibleItems: [],
  px: 0,
  py: 0,
  pz: 0.3,
  yaw: 0,
  visionStaleMs: 0,
} as unknown as Percept;

const act = (over: Partial<Actuation> = {}): Actuation => ({
  vx: 0, vy: 0, vz: 0, yaw: 0, led: "#f0b90b", activity: "hover", mood: "idle",
  ...over,
} as Actuation);

describe("the kill switch — nothing outranks it", () => {
  it("freezes all motion and forces hover", () => {
    const g = new SafetyGovernor();
    g.kill();
    const { act: a, flags } = g.gate(act({ vx: 0.9, vz: 0.5, activity: "trick" }), basePercept);
    expect(a.vx).toBe(0); expect(a.vy).toBe(0); expect(a.vz).toBe(0); expect(a.yaw).toBe(0);
    expect(a.activity).toBe("hover");
    expect(flags.some((f) => /KILL/.test(f))).toBe(true);
  });

  it("releases when armed again", () => {
    const g = new SafetyGovernor();
    g.kill(); g.arm();
    const { flags } = g.gate(act(), basePercept);
    expect(flags.some((f) => /KILL/.test(f))).toBe(false);
  });
});

describe("battery failsafes override the brain entirely", () => {
  it("critical battery forces a controlled descent, whatever the brain wanted", () => {
    const g = new SafetyGovernor();
    const { act: a } = g.gate(act({ vx: 0.5, vz: 0.4, activity: "trick" }),
      { ...basePercept, battery: DEFAULT_LIMITS.criticalBattery });
    expect(a.vz).toBeLessThanOrEqual(-0.5);
    expect(a.vx).toBe(0); expect(a.vy).toBe(0);
  });

  it("flags low battery without seizing control", () => {
    const g = new SafetyGovernor();
    const { act: a, flags } = g.gate(act({ vx: 0.2 }),
      { ...basePercept, battery: DEFAULT_LIMITS.lowBattery });
    expect(a.vx).toBeCloseTo(0.2); // still hers
    expect(flags.some((f) => /LOW BATTERY/.test(f))).toBe(true);
  });
});

describe("clamps and stand-off", () => {
  it("clamps overspeed proportionally, never boosts underspeed", () => {
    const g = new SafetyGovernor();
    const fast = g.gate(act({ vx: 1.0, vz: 0.3 }), basePercept).act;
    expect(Math.max(Math.abs(fast.vx), Math.abs(fast.vz))).toBeLessThanOrEqual(DEFAULT_LIMITS.maxSpeed + 1e-9);
    const slow = g.gate(act({ vx: 0.2 }), basePercept).act;
    expect(slow.vx).toBeCloseTo(0.2);
  });

  it("backs off from a face that is too close", () => {
    const g = new SafetyGovernor();
    const { act: a } = g.gate(act({ vx: 0.4 }),
      { ...basePercept, faceSeen: true, faceSize: 0.6 });
    expect(a.vx).toBeLessThan(0); // moving AWAY
    expect(a.vx <= -0.15).toBe(true);
  });

  it("does not back off when approaching nothing", () => {
    const g = new SafetyGovernor();
    const { flags } = g.gate(act({ vx: 0.4 }), basePercept);
    expect(flags.some((f) => /STAND-OFF/.test(f))).toBe(false);
  });
});

describe("the geofence — soft inside, firm at the line", () => {
  it("returns her home past the radius", () => {
    const g = new SafetyGovernor();
    const { act: a, flags } = g.gate(
      act({ vx: 0.3 }), // facing +x... yaw 0: body-frame +x is world +x here
      { ...basePercept, px: DEFAULT_LIMITS.geofenceRadius + 0.05, py: 0 });
    expect(flags.some((f) => /GEOFENCE BREACH/.test(f))).toBe(true);
  });

  it("leaves her alone well inside the fence", () => {
    const g = new SafetyGovernor();
    const { flags } = g.gate(act({ vx: 0.3 }), { ...basePercept, px: 0.2, py: 0.2 });
    expect(flags.some((f) => /GEOFENCE/.test(f))).toBe(false);
  });

  it("never lets dream-tuning loosen the fence past the default", () => {
    const g = new SafetyGovernor();
    g.setLimits({ geofenceRadius: 2.4 }); // tried to double it
    expect(g.currentLimits.geofenceRadius).toBeLessThanOrEqual(DEFAULT_LIMITS.geofenceRadius);
  });
});

describe("the altitude box — enforced in the GOVERNOR, not just the sim", () => {
  it("kills upward intent at the ceiling — on any HAL", () => {
    const g = new SafetyGovernor();
    const { act: a, flags } = g.gate(act({ vz: 0.4 }),
      { ...basePercept, pz: DEFAULT_LIMITS.maxAltitude });
    expect(a.vz).toBe(0);
    expect(flags.some((f) => /CEILING/.test(f))).toBe(true);
  });

  it("refuses below-floor intent — but never blocks a landing", () => {
    const g = new SafetyGovernor();
    const refused = g.gate(act({ vz: -0.3, activity: "hover" }),
      { ...basePercept, pz: DEFAULT_LIMITS.minAltitude });
    expect(refused.act.vz).toBe(0);
    expect(refused.flags.some((f) => /FLOOR/.test(f))).toBe(true);
    const landing = g.gate(act({ vz: -0.5, activity: "sleep" }),
      { ...basePercept, pz: DEFAULT_LIMITS.minAltitude });
    expect(landing.act.vz).toBeLessThan(0); // sleep owns its descent
  });
});

describe("the visual hold — honest degradation", () => {
  it("locks altitude and slows her when her feed goes stale", () => {
    const g = new SafetyGovernor();
    g.setVisionFeed(true);
    const { act: a, flags } = g.gate(act({ vx: 0.4, vz: 0.2 }),
      { ...basePercept, visionStaleMs: DEFAULT_LIMITS.visionStaleLimit + 1 });
    expect(a.vz).toBe(0);
    expect(a.vx).toBeLessThan(0.4);
    expect(flags.some((f) => /VISUAL HOLD/.test(f))).toBe(true);
  });

  it("stays silent while her feed is healthy", () => {
    const g = new SafetyGovernor();
    g.setVisionFeed(true);
    const { flags } = g.gate(act({ vx: 0.4, vz: 0.2 }),
      { ...basePercept, visionStaleMs: 100 });
    expect(flags.some((f) => /VISUAL HOLD/.test(f))).toBe(false);
  });
});
