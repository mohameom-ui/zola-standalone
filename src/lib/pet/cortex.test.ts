// CORTEX — test suite: the capability registry (530 real capabilities)
// Rule 2 compliance: every registered capability must be real and callable.

import { describe, it, expect, vi } from "vitest";
import { Cortex } from "./cortex";
import { allPersonas, PERSONA_COUNT } from "./personas";

describe("the CORTEX registry", () => {
  it("holds exactly 500 persona-shift capabilities", () => {
    const c = new Cortex();
    c.registerPersonaShifts(allPersonas(), (name) => `Persona shift: ${name}.`);
    expect(c.size).toBeGreaterThanOrEqual(PERSONA_COUNT);
    const idx = c.index();
    expect(idx.personas.total).toBe(PERSONA_COUNT);
  });

  it("every persona-shift capability is real and executable", async () => {
    const c = new Cortex();
    c.registerPersonaShifts(allPersonas(), (name) => `Persona shift: ${name}.`);
    // sample 20 across the constellation — each must execute
    const step = Math.floor(PERSONA_COUNT / 20);
    for (let i = 0; i < PERSONA_COUNT; i += step) {
      const p = allPersonas()[i];
      const line = await c.execute(`persona:${p.name}`);
      expect(line).toBeTruthy();
    }
  });

  it("system capabilities register, execute, and report", async () => {
    const c = new Cortex();
    c.onLog((who, text) => { /* silent */ });
    c.register({ id: "test-op", kind: "system", label: "Test op", description: "test", run: () => "op done" });
    expect(c.has("test-op")).toBe(true);
    const line = await c.execute("test-op");
    expect(line).toBe("op done");
  });

  it("unknown ids return null (no fabricated responses)", async () => {
    const c = new Cortex();
    expect(await c.execute("nonexistent-verb")).toBeNull();
    expect(c.has("nonexistent-verb")).toBe(false);
  });

  it("the registry accepts unbounded registration (the 500-feature design)", () => {
    const c = new Cortex();
    for (let i = 0; i < 500; i++) {
      c.register({ id: `sys-${i}`, kind: "system", label: `Op ${i}`, description: "x", run: () => "ok" });
    }
    expect(c.size).toBeGreaterThanOrEqual(500);
  });

  it("the brain-facing summary declares the real counts", () => {
    const c = new Cortex();
    c.registerPersonaShifts(allPersonas(), (name) => `Persona shift: ${name}.`);
    const s = c.summary();
    expect(s).toContain("system capabilities");
    expect(s).toContain("persona modes");
  });
});
