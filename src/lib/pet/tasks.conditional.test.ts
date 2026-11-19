import { describe, expect, it } from "vitest";
import { evalPredicate, TaskRunner } from "./tasks";
import type { Predicate } from "./tasks";

function ctx(now: number, visibleItems: string[] = [], extra: Partial<{ faceSeen: boolean; battery: number }> = {}) {
  return {
    now,
    faceSeen: extra.faceSeen ?? false,
    faceSize: 0,
    visibleItems,
    yaw: 0,
    px: 0,
    py: 0,
    battery: extra.battery,
  };
}

describe("conditional task planning", () => {
  it("parses 'if you see X, action' into a gated step", () => {
    const runner = new TaskRunner();
    const task = runner.plan("if you see my cup, come to me");
    expect(task).not.toBeNull();
    if (!task) return;

    expect(task.steps).toHaveLength(1);
    expect(task.steps[0].kind).toBe("come");
    expect(task.steps[0].when).toEqual({ kind: "sees", target: "cup" });
    expect(task.steps[0].label).toMatch(/^If you see cup:/);
  });

  it("skips the step when the condition is false, and says so", () => {
    const runner = new TaskRunner();
    const task = runner.plan("if you see my cup, come to me");
    if (!task) throw new Error("plan did not parse");

    runner.start(task, 1_000);
    const gate = runner.tick(ctx(1_000)); // no cup visible

    expect(gate.say).toMatch(/condition not met — skipping/i);
    expect(gate.done).toBe(false);

    const end = runner.tick(ctx(1_100));
    expect(end.done).toBe(true);
    expect(end.outcome).toBe("completed");
    expect(end.say).toMatch(/1 step skipped \(condition not met\)/i);
    expect(task.steps[0].skipped).toBe(true);
  });

  it("runs the step when the condition is true", () => {
    const runner = new TaskRunner();
    const task = runner.plan("if you see my cup, come to me");
    if (!task) throw new Error("plan did not parse");

    runner.start(task, 1_000);
    const active = runner.tick(ctx(1_000, ["cup"]));

    expect(active.activity).toBe("come");
    expect(task.steps[0].skipped).toBeUndefined();
    expect(task.steps[0].gate).toBe("open");
  });

  it("evaluates a battery predicate against the live percentage", () => {
    const runner = new TaskRunner();
    const task = runner.plan("if your battery is below 20%, come to me");
    if (!task) throw new Error("plan did not parse");

    runner.start(task, 1_000);
    const low = runner.tick(ctx(1_000, [], { battery: 15 }));
    expect(low.activity).toBe("come");

    const runner2 = new TaskRunner();
    const task2 = runner2.plan("if your battery is below 20%, come to me");
    if (!task2) throw new Error("plan did not parse");
    runner2.start(task2, 1_000);
    const high = runner2.tick(ctx(1_000, [], { battery: 80 }));
    expect(high.say).toMatch(/skipping/i);
  });

  it("refuses an unknown condition instead of acting unconditionally", () => {
    const runner = new TaskRunner();
    const task = runner.plan("find my cup then if the moon is full, dance");
    if (!task) throw new Error("plan did not parse");

    expect(task.steps).toHaveLength(1);
    expect(task.unparsed).toEqual(["if the moon is full, dance"]);

    runner.start(task, 1_000);
    runner.tick(ctx(1_100, ["cup"]));
    const end = runner.tick(ctx(1_200, ["cup"]));
    expect(end.outcome).toBe("partial");
    expect(end.say).toMatch(/did not understand: if the moon is full, dance/i);
  });

  it("evaluates presence predicates from the face signal only", () => {
    const someone: Predicate = { kind: "someone" };
    const nobody: Predicate = { kind: "no_one" };
    expect(evalPredicate(someone, ctx(0, [], { faceSeen: true }))).toBe(true);
    expect(evalPredicate(someone, ctx(0, [], { faceSeen: false }))).toBe(false);
    expect(evalPredicate(nobody, ctx(0, [], { faceSeen: false }))).toBe(true);
    expect(evalPredicate(nobody, ctx(0, [], { faceSeen: true }))).toBe(false);
  });
});
