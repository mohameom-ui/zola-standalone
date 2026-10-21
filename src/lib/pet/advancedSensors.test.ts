// ADVANCED SENSORS — test suite
// The emotion classifier: pure function, real mappings from her face
// tracker's blendshape composites. The recognition adaptation: the
// library-confidence boost.

import { describe, it, expect } from "vitest";
import { classifyEmotion, adaptConfidence } from "./advancedSensors";

const make = (vals: Record<string, number>) => (name: string) => {
  // split-left/right composite names get summed from their single source
  if (name === "mouthSmileLeft" || name === "mouthSmileRight") return vals.smile ?? 0;
  if (name === "browOuterUpLeft" || name === "browOuterUpRight") return vals.browRaise ?? 0;
  if (name === "browDownLeft" || name === "browDownRight") return vals.browDown ?? 0;
  if (name === "eyeSquintLeft" || name === "eyeSquintRight") return vals.eyeSquint ?? 0;
  if (name === "mouthPressLeft" || name === "mouthPressRight") return vals.jawPress ?? 0;
  if (name === "jawOpen") return vals.jawOpen ?? 0;
  return 0;
};

describe("the emotion classifier", () => {
  it("a big smile reads as happy with high confidence", () => {
    const r = classifyEmotion(make({ smile: 0.85, browRaise: 0.2 }));
    expect(r.emotion).toBe("happy");
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.detail.smile).toBe(1.7); // both sides summed
  });

  it("brow-down + squint + jaw reads as stressed", () => {
    const r = classifyEmotion(make({ browDown: 0.9, eyeSquint: 0.8, jawPress: 0.7 }));
    expect(r.emotion).toBe("stressed");
    expect(r.stress).toBeGreaterThan(0.5);
  });

  it("high brow raise without a smile reads as surprised", () => {
    const r = classifyEmotion(make({ browRaise: 1.0, smile: 0.05 }));
    expect(r.emotion).toBe("surprised");
  });

  it("flat readings read as neutral", () => {
    const r = classifyEmotion(make({}));
    expect(r.emotion).toBe("neutral");
    expect(r.stress).toBeLessThan(0.2);
  });

  it("moderate squint without a smile reads as focused", () => {
    const r = classifyEmotion(make({ eyeSquint: 0.7, browDown: 0.3 }));
    expect(r.emotion).toBe("focused");
  });

  it("the stress composite is bounded 0..1", () => {
    const r = classifyEmotion(make({ browDown: 2, eyeSquint: 2, jawPress: 2 }));
    expect(r.stress).toBeLessThanOrEqual(1);
    expect(r.stress).toBeGreaterThanOrEqual(0);
  });
});

describe("the recognition adaptation", () => {
  it("a first sighting gets no boost", () => {
    expect(adaptConfidence(0.6, 0)).toBe(0.6);
  });

  it("familiar items get boosted (+3% per sighting, capped +0.25)", () => {
    expect(adaptConfidence(0.6, 5)).toBeCloseTo(0.75);
    expect(adaptConfidence(0.6, 20)).toBe(0.85); // capped at +0.25
  });

  it("the boost never pushes past 1.0", () => {
    expect(adaptConfidence(0.95, 30)).toBeLessThanOrEqual(1);
  });

  it("the boost makes familiar items reliably detectable", () => {
    // an item seen 10 times at raw 0.55 reads as 0.85 — she KNOWS it now
    expect(adaptConfidence(0.55, 10)).toBeGreaterThanOrEqual(0.8);
  });
});
