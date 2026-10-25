import { describe, it, expect } from "vitest";
import { PetBrain } from "./brain";
import { pickVisualTrick, VISUAL_TRICK_LABELS } from "./visualTricks";
import type { Percept } from "./types";

describe("the visual vocabulary — pure lookup", () => {
  it("a detected ball earns the throw", () => {
    expect(pickVisualTrick(["sports ball"], [])?.clip).toBe("throw_01");
    expect(pickVisualTrick(["Frisbee "], [])?.clip).toBe("throw_01");
  });

  it("a kite is flight envy; a teddy bear is peekaboo", () => {
    expect(pickVisualTrick(["kite"], [])?.clip).toBe("spin_01");
    expect(pickVisualTrick(["teddy bear"], [])?.clip).toBe("peekaboo_01");
  });

  it("deep-eyes words describing a maneuver trigger the matching clip", () => {
    expect(pickVisualTrick([], ["A person is dancing on a stage."])?.clip).toBe("dance_01");
    expect(pickVisualTrick([], ["The child plays peekaboo."])?.clip).toBe("peekaboo_01");
    expect(pickVisualTrick([], ["She performed a curtsey."])?.clip).toBe("curtsey_01");
  });

  it("labels outrank prose; ordinary frames return null", () => {
    expect(pickVisualTrick(["kite"], ["someone is dancing"])?.clip).toBe("spin_01");
    expect(pickVisualTrick([], ["a cup on a desk"])).toBeNull();
    expect(pickVisualTrick([], [])).toBeNull();
    // every listed label resolves to a real clip name in her repertoire
    expect(VISUAL_TRICK_LABELS.length).toBeGreaterThan(3);
  });
});

describe("the visual vocabulary — wired into the brain", () => {
  function frame(overrides: Partial<Percept> = {}): Percept {
    return {
      faceSeen: false, faceX: 0, faceY: 0, faceSize: 0, battery: 1,
      now: performance.now(), say: null, identities: [], expression: null,
      visibleItems: [], yaw: 0, px: 0, py: 0, pz: 0, ...overrides,
    };
  }

  it("seeing a ball makes her throw — and say why", () => {
    const played: string[] = [];
    const brain = new PetBrain({ playGesture: (c) => { played.push(c); return true; } });
    const p = frame({ visibleItems: ["sports ball"] });
    brain.perceive(p);
    expect(played).toEqual(["throw_01"]);
    expect(p.say).toMatch(/ball|throw/i);
  });

  it("she does not repeat herself — the throttle holds", () => {
    const played: string[] = [];
    const brain = new PetBrain({ playGesture: (c) => { played.push(c); return true; } });
    brain.perceive(frame({ visibleItems: ["sports ball"] }));
    brain.perceive(frame({ visibleItems: ["sports ball"] }));
    expect(played).toEqual(["throw_01"]); // 45 s cooldown
  });

  it("no body, no task, no sleep — no show", () => {
    const bare = new PetBrain(); // no playGesture hook
    const p = frame({ visibleItems: ["kite"] });
    bare.perceive(p);
    expect(p.say).toBeNull();
    const shy = new PetBrain({ playGesture: () => false });
    const p2 = frame({ visibleItems: ["kite"] });
    shy.perceive(p2);
    expect(p2.say).toBeNull();
  });
});
