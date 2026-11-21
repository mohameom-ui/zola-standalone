import { describe, expect, it } from "vitest";
import { BRAIN_CASES, runBrainBench, type BenchCase } from "./brainBench";

const cases: BenchCase[] = [
  { text: "come here", expect: "come" },
  { text: "where are my glasses", expect: "find" },
  { text: "hello", expect: null },
];

describe("runBrainBench", () => {
  it("scores a perfect classifier at 100%", async () => {
    const answers = new Map([["come here", "come"], ["where are my glasses", "find:glasses"]]);
    const report = await runBrainBench(async (text) => answers.get(text) ?? null, cases);

    expect(report.total).toBe(3);
    expect(report.correct).toBe(3);
    expect(report.accuracy).toBe(1);
    expect(report.failures).toEqual([]);
    expect(report.latency.count).toBe(3);
  });

  it("records wrong verbs with what it actually said", async () => {
    const report = await runBrainBench(
      async (text) => (text === "come here" ? "scan" : text === "where are my glasses" ? "find:glasses" : null),
      cases,
    );
    expect(report.correct).toBe(2);
    expect(report.failures).toEqual([{ text: "come here", expected: "come", got: "scan" }]);
  });

  it("marks unknown verbs as invalid rather than matching", async () => {
    const report = await runBrainBench(async () => "self-destruct:now", cases);
    expect(report.accuracy).toBe(0);
    expect(report.failures.every((f) => f.got === "invalid")).toBe(true);
  });

  it("counts a thrown classifier as a conversation miss, not a crash", async () => {
    const report = await runBrainBench(async () => { throw new Error("model offline"); }, cases);
    expect(report.correct).toBe(1); // only the "hello" case expects none
    expect(report.failures).toHaveLength(2);
  });

  it("keeps the case set honest", () => {
    expect(BRAIN_CASES.length).toBeGreaterThanOrEqual(25);
    expect(BRAIN_CASES.some((c) => c.expect === null)).toBe(true);
  });

  it("handles an empty suite", async () => {
    const report = await runBrainBench(async () => null, []);
    expect(report).toMatchObject({ total: 0, correct: 0, accuracy: 0 });
  });
});
