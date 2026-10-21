import { describe, it, expect } from "vitest";
import { chooseGesture } from "./spontanea";

describe("chooseGesture — the mood → gesture chooser", () => {
  it("picks from the mood pool with no event", () => {
    const c = chooseGesture("happy", null, 0, null);
    expect(c).not.toBeNull();
    expect(["wave_01", "wave_02", "spin_01", "dance_01", "peekaboo_01"]).toContain(c!.clip);
    expect(c!.reason).toBe("mood:happy");
  });

  it("event bias outranks the mood pool", () => {
    const c = chooseGesture("curious", "greet", 0, null);
    expect(["wave_01", "bow_02", "curtsey_01"]).toContain(c!.clip);
    expect(c!.reason).toBe("event:greet");
  });

  it("sleeping picks nothing — she does not perform on command", () => {
    expect(chooseGesture("sleeping", null, 0, null)).toBeNull();
    expect(chooseGesture("sleeping", "pet", 0, null)).not.toBeNull(); // a pet wakes the bias
  });

  it("never repeats the last clip back-to-back when alternatives exist", () => {
    const c = chooseGesture("happy", "pet", 0.99, "spin_01");
    expect(c!.clip).not.toBe("spin_01");
  });

  it("returns null for an unknown mood with no event", () => {
    expect(chooseGesture("bewildered", null, 0, null)).toBeNull();
  });

  it("a single-clip pool that just played returns null (no broken record)", () => {
    expect(chooseGesture("curious", "confused", 0, "shrug_01")).toBeNull();
  });
});
