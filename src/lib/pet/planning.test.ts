import { describe, expect, it } from "vitest";
import { parsePlan, verbOf, voiceInstruction } from "./planning";

describe("verbOf", () => {
  it("extracts the verb from an action with arguments", () => {
    expect(verbOf("find:my cup")).toBe("find");
    expect(verbOf("goto:kitchen")).toBe("goto");
    expect(verbOf("  SCAN ")).toBe("scan");
  });

  it("rejects unknown verbs", () => {
    expect(verbOf("fly-to:moon")).toBeNull();
    expect(verbOf("")).toBeNull();
  });
});

describe("parsePlan", () => {
  it("parses a clean JSON plan", () => {
    const plan = parsePlan('{"action":"find:cup","confidence":0.8,"why":"owner asked"}');
    expect(plan).toEqual({ action: "find:cup", verb: "find", confidence: 0.8, why: "owner asked" });
  });

  it("tolerates prose around the JSON", () => {
    const plan = parsePlan('Sure! Here is my plan:\n{"action":"patrol","confidence":0.62}\nHope that helps.');
    expect(plan?.verb).toBe("patrol");
    expect(plan?.confidence).toBeCloseTo(0.62, 6);
  });

  it("rejects unknown verbs instead of passing them through", () => {
    expect(parsePlan('{"action":"self-destruct","confidence":0.9}')).toBeNull();
  });

  it("rejects malformed or empty replies", () => {
    expect(parsePlan("I would probably scan the room.")).toBeNull();
    expect(parsePlan("{not json}")).toBeNull();
    expect(parsePlan("")).toBeNull();
    expect(parsePlan('{"confidence":0.9}')).toBeNull();
  });

  it("clamps confidence and defaults it when missing", () => {
    expect(parsePlan('{"action":"scan","confidence":4}')?.confidence).toBe(1);
    expect(parsePlan('{"action":"scan","confidence":-2}')?.confidence).toBe(0);
    expect(parsePlan('{"action":"scan"}')?.confidence).toBe(0.5);
  });

  it("caps the explanation", () => {
    const why = "x".repeat(200);
    expect(parsePlan(`{"action":"scan","why":"${why}"}`)?.why.length).toBe(80);
  });
});

describe("voiceInstruction", () => {
  it("states the fixed action and forbids meta talk", () => {
    const line = voiceInstruction("find:cup", 0.9);
    expect(line).toContain("find:cup");
    expect(line).toMatch(/do not mention json/i);
    expect(line).not.toMatch(/unsure/i);
  });

  it("invites an honest hedge when confidence is low", () => {
    expect(voiceInstruction("patrol", 0.3)).toMatch(/unsure/i);
  });
});
