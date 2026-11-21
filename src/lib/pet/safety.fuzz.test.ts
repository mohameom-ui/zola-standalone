import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, SafetyGovernor } from "./safety";
import type { Actuation, Activity, Mood, Percept } from "./types";

/** Deterministic PRNG (mulberry32) — a failing case is reproducible by seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const moods: Mood[] = ["idle", "curious", "happy", "excited", "sleepy", "alarmed", "sleeping"];
const activities: Activity[] = ["hover", "follow", "come", "trick", "wander", "sleep", "search", "scan", "dock", "walk"];

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

function randomPercept(r: () => number): Percept {
  return {
    faceSeen: r() < 0.4,
    faceX: r() * 2 - 1,
    faceY: r() * 2 - 1,
    faceSize: r(),
    battery: r(),
    now: 1_000 + r() * 1_000_000,
    say: null,
    identities: [],
    expression: null,
    visibleItems: [],
    yaw: (r() * 2 - 1) * Math.PI,
    px: (r() * 2 - 1) * 3,
    py: (r() * 2 - 1) * 3,
    pz: r() * 1.5,
    visionStaleMs: r() < 0.5 ? r() * 10_000 : undefined,
    vel: r() < 0.5 ? { x: r() * 2 - 1, y: r() * 2 - 1, z: r() * 2 - 1 } : undefined,
  };
}

function randomActuation(r: () => number): Actuation {
  return {
    vx: (r() * 2 - 1) * 2,
    vy: (r() * 2 - 1) * 2,
    vz: (r() * 2 - 1) * 2,
    yaw: (r() * 2 - 1) * 2,
    led: "#f0b90b",
    say: null,
    mood: pick(r, moods),
    activity: pick(r, activities),
  };
}

const speedOf = (a: Actuation) => Math.max(Math.abs(a.vx), Math.abs(a.vy), Math.abs(a.vz));
const EPS = 1e-9;

describe("SafetyGovernor invariants (fuzz)", () => {
  it("never emits a command the limits forbid", () => {
    const r = mulberry32(0xc0ffee);
    const failures: string[] = [];

    for (let i = 0; i < 5_000; i++) {
      const p = randomPercept(r);
      const input = randomActuation(r);
      const governor = new SafetyGovernor();
      if (r() < 0.05) governor.setVisionFeed(true);
      const { act } = governor.gate(input, p);

      const at = `case ${i}`;
      const finite = [act.vx, act.vy, act.vz, act.yaw].every(Number.isFinite);
      if (!finite) failures.push(`${at}: non-finite output`);

      // critical battery forces a controlled descent, whatever was asked
      if (p.battery <= DEFAULT_LIMITS.criticalBattery) {
        if (!(act.vx === 0 && act.vy === 0 && act.vz === -0.5 && act.activity === "sleep")) {
          failures.push(`${at}: critical battery not forced (${act.vx},${act.vy},${act.vz})`);
        }
        continue;
      }

      const speed = speedOf(act);
      if (speed > DEFAULT_LIMITS.maxSpeed + EPS) {
        failures.push(
          `${at}: speed ${speed.toFixed(3)} > ${DEFAULT_LIMITS.maxSpeed} ` +
            `(in ${input.vx.toFixed(2)},${input.vy.toFixed(2)},${input.vz.toFixed(2)}; ` +
            `p ${p.px.toFixed(2)},${p.py.toFixed(2)},${p.pz.toFixed(2)} r=${Math.hypot(p.px, p.py).toFixed(2)})`,
        );
      }

      if (p.pz >= DEFAULT_LIMITS.maxAltitude && act.vz > 0) failures.push(`${at}: climbing past ceiling`);
      if (p.pz <= DEFAULT_LIMITS.minAltitude && act.activity !== "sleep" && act.activity !== "dock" && act.vz < 0) {
        failures.push(`${at}: descending through floor`);
      }
      if (act.vz < -0.5 - EPS) failures.push(`${at}: descent ${act.vz} faster than -0.5`);

      if (p.faceSeen && p.faceSize > DEFAULT_LIMITS.standoffSize && input.vx > 0 && act.vx > 0) {
        failures.push(`${at}: approaching a face inside stand-off (vx ${act.vx})`);
      }

      // person safety outranks the soft fence: skip the fence check when a
      // too-close face forces a retreat that points outward
      const faceConflict = p.faceSeen && p.faceSize > DEFAULT_LIMITS.standoffSize;
      const radius = Math.hypot(p.px, p.py);
      if (radius >= DEFAULT_LIMITS.geofenceRadius && !faceConflict) {
        const ux = p.px / (radius || 1);
        const uy = p.py / (radius || 1);
        const outward = act.vx * ux + act.vy * uy;
        if (outward > 0.01) failures.push(`${at}: pushing outward at the fence (${outward.toFixed(3)})`);
      }
    }

    expect(failures.slice(0, 8)).toEqual([]);
  });

  it("the kill switch silences every axis", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const g = new SafetyGovernor();
      g.kill();
      const { act } = g.gate(randomActuation(r), randomPercept(r));
      expect(act.vx).toBe(0);
      expect(act.vy).toBe(0);
      expect(act.vz).toBe(0);
      expect(act.yaw).toBe(0);
      expect(act.activity).toBe("hover");
    }
  });
});
