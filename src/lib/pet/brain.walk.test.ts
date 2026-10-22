import { describe, it, expect } from "vitest";
// her brain is constructed with hooks it may not need in these tests
import { PetBrain } from "./brain";

describe("the stroll — reflex-fast ground verbs", () => {
  it("take a stroll engages walk activity with a spoken line", () => {
    const brain = new PetBrain();
    const line = brain.command("take a stroll", 0.86);
    expect(line).not.toBeNull();
    expect(line).toMatch(/Ground mode|Strolling|Walking the floor/i);
    expect(brain.getActivity()).toBe("walk");
  });

  it("walk around works too", () => {
    const brain = new PetBrain();
    expect(brain.command("walk around", 0.9)).toMatch(/Ground mode|Strolling|Walking the floor/i);
    expect(brain.getActivity()).toBe("walk");
  });
});
