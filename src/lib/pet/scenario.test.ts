import { describe, expect, it } from "vitest";
import { runScenario } from "./scenario";

describe("headless scenarios", () => {
  it("finds a visible cup and finishes honestly", () => {
    const r = runScenario({
      frames: 6,
      world: () => ({ visibleItems: ["cup"] }),
      command: "find my cup",
    });

    expect(r.transcript.join("\n")).toMatch(/found the cup/i);
    expect(r.transcript.join("\n")).toMatch(/task complete/i);
    expect(r.task).toBeNull();
  });

  it("gives up on a missing cup and says so", () => {
    const r = runScenario({
      frames: 150, // 75 s of simulated time: retry, then failure
      world: () => ({ visibleItems: [] }),
      command: "find my cup",
    });

    const all = r.transcript.join("\n");
    expect(all).toMatch(/widening the search/i);
    expect(all).toMatch(/could not find the cup/i);
    expect(all).toMatch(/task failed/i);
    expect(r.task).toBeNull();
  });

  it("holds the stand-off when a face is too close", () => {
    const r = runScenario({
      frames: 20,
      world: () => ({ faceSeen: true, faceSize: 0.9 }),
    });

    // no raw command may push toward the face after gating
    for (const a of r.actuations) {
      expect(a.vx).toBeLessThanOrEqual(0);
    }
  });

  it("forces a controlled descent at critical battery", () => {
    const r = runScenario({
      frames: 12,
      world: (f) => ({ battery: f < 4 ? 0.9 : 0.05 }),
    });

    const last = r.actuations[r.actuations.length - 1];
    expect(last.vz).toBe(-0.5);
    expect(last.activity).toBe("sleep");
    expect(r.pose.z).toBeLessThan(0.35);
    expect(r.flags.join(" ")).toMatch(/CRITICAL BATTERY/);
  });

  it("tells memory when a task failed", () => {
    const seen: { task: string; outcome: string; line: string | null }[] = [];
    runScenario({
      frames: 150,
      world: () => ({ visibleItems: [] }),
      command: "find my cup",
      hooks: { onTaskOutcome: (task, outcome, line) => seen.push({ task, outcome, line }) },
    });

    const failure = seen.find((s) => s.outcome !== "completed");
    expect(failure).toBeDefined();
    expect(failure!.task).toMatch(/cup/i);
    expect(failure!.outcome).toBe("failed");
    expect(failure!.line).toMatch(/failed/i);
  });

  it("never exceeds the speed cap across a long random-ish run", () => {
    const r = runScenario({
      frames: 400,
      world: (f) => ({
        visibleItems: f % 7 === 0 ? ["cup", "chair"] : [],
        faceSeen: f % 11 < 3,
        faceSize: f % 11 < 3 ? 0.2 : 0,
        battery: 0.85 - (f / 400) * 0.2,
      }),
      command: "find my cup",
    });

    for (const a of r.actuations) {
      const speed = Math.max(Math.abs(a.vx), Math.abs(a.vy), Math.abs(a.vz));
      expect(speed).toBeLessThanOrEqual(0.55 + 1e-9);
    }
  });
});
