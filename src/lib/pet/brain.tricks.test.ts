import { describe, it, expect } from "vitest";
import { PetBrain } from "./brain";

/** A brain wired to a recording body — every played clip lands in `played`. */
function trickBrain() {
  const played: string[] = [];
  const brain = new PetBrain({ playGesture: (clip) => { played.push(clip); return true; } });
  return { brain, played };
}

describe("the tricks — every clip has a voice", () => {
  it("dance plays a dance clip and lifts her mood", () => {
    const { brain, played } = trickBrain();
    const line = brain.command("dance for me", 0.9);
    expect(played[0]).toMatch(/^dance_0[12]$/);
    expect(line).toMatch(/Dance mode|footwork|victory dance/i);
    expect(brain.getMood()).toBe("excited");
  });

  it("take a bow plays a bow clip — and rainbow does not", () => {
    const { brain, played } = trickBrain();
    expect(brain.command("take a bow", 0.9)).toMatch(/bow/i);
    expect(played.some((c) => c.startsWith("bow_"))).toBe(true);
    const { brain: b2, played: p2 } = trickBrain();
    b2.command("the rainbow is pretty", 0.9);
    expect(p2).toEqual([]);
  });

  it("the whole trick lexicon routes to the right clips", () => {
    const cases: [string, string][] = [
      ["do a curtsey", "curtsey_01"],
      ["peekaboo", "peekaboo_01"],
      ["roll over", "rollover_01"],
      ["stretch a little", "stretch_01"],
      ["shrug it off", "shrug_01"],
      ["march in place", "march_01"],
      ["lay down", "laydown_01"],
      ["mope around", "mope_01"],
    ];
    for (const [said, clip] of cases) {
      const { brain, played } = trickBrain();
      expect(brain.command(said, 0.9), said).not.toBeNull();
      expect(played, said).toContain(clip);
    }
  });

  it("get up plays the recovery clip; wake up still wakes her", () => {
    const { brain, played } = trickBrain();
    expect(brain.command("get up", 0.9)).toMatch(/Getting up|feet|Recovery/i);
    expect(played).toContain("getup_01");
    const { brain: b2 } = trickBrain();
    b2.command("sleep", 0.9);
    expect(b2.command("wake up", 0.9)).toMatch(/awake|Ready|Systems online|dream|grump/i);
    expect(b2.getActivity()).toBe("hover");
  });

  it("without a body she admits it instead of lying", () => {
    const brain = new PetBrain({ playGesture: () => false });
    expect(brain.command("dance", 0.9)).toMatch(/stage is not loaded/i);
    // no hook at all: the tricks section is skipped, nothing crashes
    const bare = new PetBrain();
    expect(bare.command("dance", 0.9)).not.toBeNull();
  });
});
