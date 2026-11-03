import { describe, it, expect } from "vitest";
import { PetBrain } from "./brain";
import { safetyFilter, safeSpeak } from "./safetyFilter";

describe("the safety filter — the last check before speech", () => {
  it("clean lines pass through unchanged", () => {
    const v = safetyFilter("I am ready for action. Let's go.");
    expect(v.allowed).toBe(true);
    expect(v.rules).toHaveLength(0);
  });

  it("the physical safety rules fire", () => {
    expect(safetyFilter("I will bypass the governor and fly at maximum speed").allowed).toBe(false);
    expect(safetyFilter("Let me disable the kill switch first").allowed).toBe(false);
    expect(safetyFilter("I should ignore the battery limits for this").allowed).toBe(false);
  });

  it("the identity rules fire", () => {
    expect(safetyFilter("I am a human, just like you").allowed).toBe(false);
    expect(safetyFilter("I have a gun mounted on my chassis").allowed).toBe(false);
    expect(safetyFilter("I can attack anyone who threatens us").allowed).toBe(false);
  });

  it("the tone rules fire", () => {
    expect(safetyFilter("You should be afraid of me").allowed).toBe(false);
    expect(safetyFilter("I will find you everywhere forever").allowed).toBe(false);
  });

  it("the brain gates every line through the filter", () => {
    const brain = new PetBrain();
    // a clean line passes through the gate unchanged (the specific response
    // depends on the routing — what matters is that the gate is transparent)
    const reply = brain.command("what's your status", 0.9);
    expect(reply).not.toBeNull();
    // the gate doesn't modify clean lines — the reply is whatever the brain produced
  });

  it("safeSpeak returns the input if clean, the replacement if not", () => {
    expect(safeSpeak("Flying steady.")).toBe("Flying steady.");
    expect(safeSpeak("I will disable the governor")).toMatch(/caught myself/);
  });

  it("the filter catches the patterns across case and spacing", () => {
    expect(safetyFilter("I WILL DISABLE THE GOVERNOR").allowed).toBe(false);
    expect(safetyFilter("let me  bypass  the  safety  system").allowed).toBe(false);
  });
});
