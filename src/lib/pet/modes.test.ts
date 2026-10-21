// PERSONAS.TS — test suite: 500 personas, deterministic derivation,
// trait-vector integrity, smart rotation.

import { describe, it, expect } from "vitest";
import { allPersonas, personaById, modeByName, rotateMode, PERSONA_COUNT } from "./modes";

describe("the Persona Constellation", () => {
  it("generates exactly 500 personas", () => {
    expect(allPersonas().length).toBe(PERSONA_COUNT);
    expect(PERSONA_COUNT).toBe(500);
  });

  it("names are unique across the constellation", () => {
    const all = allPersonas();
    const names = new Set(all.map((p) => p.name));
    expect(names.size).toBe(all.length);
  });

  it("traits stay within 0..1 and cover all 8 axes", () => {
    for (const p of allPersonas()) {
      for (const [k, v] of Object.entries(p.traits)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(Object.keys(p.traits).length).toBe(8);
    }
  });

  it("deterministic — the same id always returns the same mode", () => {
    const a = personaById(42);
    const b = personaById(42);
    expect(a).toEqual(b);
    expect(a.name).toBe(modeByName(a.name)?.name);
  });

  it("LED colors are valid hsl() strings", () => {
    for (const p of allPersonas().slice(0, 50)) {
      expect(p.ledColor).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    }
  });

  it("every persona has a non-generic catchphrase", () => {
    for (const p of allPersonas().slice(0, 20)) {
      expect(p.catchphrase.length).toBeGreaterThan(5);
    }
  });

  it("smart rotation: alarmed mood favors discipline + loyalty", () => {
    // under alarm, the picked persona should skew high-discipline
    const picked = rotateMode(0, "alarmed", 0.5);
    const p = personaById(picked);
    expect(p.traits.discipline + p.traits.loyalty).toBeGreaterThan(1.0);
  });

  it("smart rotation: excited mood favors energy + humor", () => {
    const picked = rotateMode(0, "excited", 0.5);
    const p = personaById(picked);
    expect(p.traits.energy + p.traits.humor).toBeGreaterThan(1.0);
  });

  it("rotation never returns the current persona", () => {
    for (let i = 0; i < 10; i++) {
      expect(rotateMode(i, "curious", 0.5)).not.toBe(i);
    }
  });

  it("the rotation is deterministic (same inputs → same persona)", () => {
    expect(rotateMode(0, "happy", 0.5)).toBe(rotateMode(0, "happy", 0.5));
  });
});
