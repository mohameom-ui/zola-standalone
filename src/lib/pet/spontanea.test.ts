// SPONTANEA — test suite
// The autonomous movement engine: persona pools, mood gates, cadence,
// sparse narration. If she moves when she shouldn't — the tests catch it.

import { describe, it, expect } from "vitest";
import { pickSpontaneous, shouldSelfMove, cadenceFor } from "./spontanea";

describe("SPONTANEA — the autonomous movement engine", () => {
  it("every wired persona has a movement pool and a cadence", () => {
    for (const p of ["SWEET", "EXPLORER", "HYPER", "SKITTISH", "GRUMPY", "DREAMING", "ROAST MODE", "SULKING"]) {
      expect(cadenceFor(p)).toBeGreaterThan(0);
    }
  });

  it("unknown personas fall back to the SWEET pool", () => {
    const r = pickSpontaneous("UNKNOWN_PERSONA", "curious", 0);
    expect(r).not.toBeNull();
    expect(["bow_01", "curtsey_01", "wave_01", "bow_02"]).toContain(r!.clip);
  });

  it("alarmed mood FREEZES her — no spontaneous movement at any rand", () => {
    for (let r = 0; r < 1; r += 0.1) {
      expect(pickSpontaneous("HYPER", "alarmed", r)).toBeNull();
    }
  });

  it("sleeping mood is mostly still (rare stretch only)", () => {
    const moves = [];
    for (let i = 0; i < 100; i++) {
      const r = pickSpontaneous("SWEET", "sleeping", i / 100);
      if (r) moves.push(r);
    }
    expect(moves.length).toBeLessThanOrEqual(16); // rand > 0.85 only
    for (const m of moves) expect(m.clip).toBe("bow_01"); // the SWEET pool's first
  });

  it("HYPER moves more often than SULKING (the cadence table means something)", () => {
    let hyper = 0, sulking = 0;
    for (let i = 0; i < 100; i++) {
      if (shouldSelfMove("HYPER", "curious", 20, i / 100)) hyper++;
      if (shouldSelfMove("SULKING", "curious", 20, i / 100)) sulking++;
    }
    expect(hyper).toBeGreaterThan(sulking); // HYPER's 18s cadence fires at 20s idle
  });

  it("never moves before the persona cadence elapses", () => {
    for (const p of ["SWEET", "EXPLORER", "GRUMPY", "SULKING"]) {
      expect(shouldSelfMove(p, "curious", 5, 0.5)).toBe(false);
      expect(shouldSelfMove(p, "curious", 10, 0.5)).toBe(false);
    }
  });

  it("excited mood shortens the wait (factor 0.7)", () => {
    // SULKING cadence 75s × 0.7 = 52.5s — at 40s idle: still no
    expect(shouldSelfMove("SULKING", "excited", 40, 0.5)).toBe(false);
    // but at 55s: yes
    expect(shouldSelfMove("SULKING", "excited", 55, 0.5)).toBe(true);
  });

  it("every pool clip exists in her repertoire", () => {
    // the movement ledger's canon — every pool entry must be a real clip
    const canon = new Set([
      "bow_01", "bow_02", "curtsey_01", "dance_01", "dance_02", "march_01",
      "wave_01", "wave_02", "shrug_01", "spin_01", "stretch_01", "throw_01",
      "peekaboo_01", "pickup_01", "rollover_01", "crawl_01", "getup_01",
      "laydown_01", "mope_01",
    ]);
    const pools = ["SWEET", "EXPLORER", "HYPER", "SKITTISH", "GRUMPY", "DREAMING", "ROAST MODE", "SULKING"];
    // pickSpontaneous must return a clip from the canon for every persona
    for (const p of pools) {
      for (let i = 0; i < 50; i++) {
        const r = pickSpontaneous(p, "curious", i / 50);
        if (r) expect(canon.has(r.clip)).toBe(true);
      }
    }
  });

  it("narration is sparse — she doesn't narrate every fidget", () => {
    let spoken = 0, total = 0;
    for (let i = 0; i < 200; i++) {
      const r = pickSpontaneous("HYPER", "curious", (i * 7) / 200);
      if (r) { total++; if (r.say) spoken++; }
    }
    expect(total).toBeGreaterThan(0);
    expect(spoken / total).toBeLessThan(0.5);
  });
});
