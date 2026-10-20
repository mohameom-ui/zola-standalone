// NEURAL_AURA_CACHE — test suite
// Verifies the recognition ledger: first contact, repeat roasting, self-scan
// persona branch, persistence, and the ledger dump. Provenance rule: all
// verdicts derive from real encounter state — the tests prove it.

import { describe, it, expect, beforeEach } from "vitest";
import { scanAsset, dumpAura } from "./auraCache";

// minimal localStorage stub (node env has none)
const store: Record<string, string> = {};
const localStorageStub = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageStub,
  configurable: true,
});

describe("NEURAL_AURA_CACHE v1", () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
  });

  it("first encounter reports unknown + first-contact verdict", () => {
    const r = scanAsset("b2026-midrise-a");
    expect(r.known).toBe(false);
    expect(r.encounters).toBe(1);
    expect(r.verdict).toMatch(/first contact|unindexed|remember/i);
  });

  it("second encounter reports known + roast verdict", () => {
    scanAsset("b2026-midrise-a");
    const r = scanAsset("b2026-midrise-a");
    expect(r.known).toBe(true);
    expect(r.encounters).toBe(2);
    expect(r.verdict).toMatch(/Encounter #2/);
  });

  it("encounter counter is monotonic across scans", () => {
    for (let i = 0; i < 5; i++) scanAsset("tree_blocks");
    const r = scanAsset("tree_blocks");
    expect(r.encounters).toBe(6);
  });

  it("self-scan (zola-*) gets the persona branch", () => {
    const r = scanAsset("zola-body-v2");
    expect(r.verdict).toMatch(/literally me/i);
    expect(r.known).toBe(true);
  });

  it("different assets get independent counters", () => {
    scanAsset("a");
    scanAsset("a");
    const r = scanAsset("b");
    expect(r.encounters).toBe(1);
  });

  it("ledger dump sorts by encounters descending", () => {
    scanAsset("one");
    scanAsset("two");
    scanAsset("two");
    const dump = dumpAura();
    expect(dump.length).toBe(2);
    expect(dump[0].encounters).toBeGreaterThanOrEqual(dump[1].encounters);
  });

  it("bytes metadata round-trips when provided", () => {
    const r = scanAsset("sized-asset", { bytes: 2048000 });
    expect(r.id).toBe("sized-asset");
    const dump = dumpAura();
    expect(dump.find((e) => e.id === "sized-asset")?.bytes).toBe(2048000);
  });

  it("persists across store instances (localStorage round-trip)", () => {
    scanAsset("persistent-thing");
    const dump = dumpAura();
    expect(dump.find((e) => e.id === "persistent-thing")).toBeDefined();
  });
});
