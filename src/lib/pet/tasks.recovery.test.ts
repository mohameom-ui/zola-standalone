import { describe, expect, it } from "vitest";
import { TaskRunner } from "./tasks";

function ctx(now: number, visibleItems: string[] = []) {
  return { now, faceSeen: false, faceSize: 0, visibleItems, yaw: 0, px: 0, py: 0 };
}

describe("TaskRunner honest outcomes", () => {
  it("retries a search once before failing", () => {
    const runner = new TaskRunner();
    const task = runner.plan("find my cup");
    expect(task).not.toBeNull();
    if (!task) return;

    runner.start(task, 1_000);
    expect(runner.tick(ctx(1_100)).done).toBe(false);

    const retry = runner.tick(ctx(31_100));
    expect(retry.done).toBe(false);
    expect(retry.say).toMatch(/widening/i);
    expect(task.steps[0].attempts).toBe(2);
    expect(task.steps[0].failed).toBeUndefined();

    const giveUp = runner.tick(ctx(61_200));
    expect(giveUp.say).toMatch(/could not find/i);
    expect(giveUp.done).toBe(false);

    // the failure is spoken on the timeout tick; the task closes on the next
    const end = runner.tick(ctx(61_300));
    expect(end.done).toBe(true);
    expect(end.outcome).toBe("failed");
    expect(end.say).toMatch(/task failed/i);
    expect(task.steps[0].failed).toBe(true);
  });

  it("reports completed when the item is actually found", () => {
    const runner = new TaskRunner();
    const task = runner.plan("find my cup");
    if (!task) throw new Error("plan did not parse");

    runner.start(task, 1_000);
    const found = runner.tick(ctx(1_100, ["cup"]));
    expect(found.say).toMatch(/found the cup/i);
    expect(found.done).toBe(false);

    const end = runner.tick(ctx(1_200, ["cup"]));
    expect(end.done).toBe(true);
    expect(end.outcome).toBe("completed");
    expect(end.say).toBe("Task complete.");
    expect(runner.current).toBeNull();
  });

  it("names the clauses it did not understand instead of claiming success", () => {
    const runner = new TaskRunner();
    const task = runner.plan("find my cup then clean the kitchen");
    if (!task) throw new Error("plan did not parse");
    expect(task.steps).toHaveLength(1);
    expect(task.unparsed).toEqual(["clean the kitchen"]);

    runner.start(task, 1_000);
    runner.tick(ctx(1_100, ["cup"]));
    const end = runner.tick(ctx(1_200, ["cup"]));

    expect(end.done).toBe(true);
    expect(end.outcome).toBe("partial");
    expect(end.say).toMatch(/did not understand: clean the kitchen/i);
  });

  it("keeps going after a failed step and reports the partial result", () => {
    const runner = new TaskRunner();
    const task = runner.plan("find my cup then scan the room");
    if (!task) throw new Error("plan did not parse");
    expect(task.steps.map((s) => s.kind)).toEqual(["search_item", "scan"]);

    runner.start(task, 1_000);
    runner.tick(ctx(1_100));          // searching
    runner.tick(ctx(31_100));         // retry
    const failed = runner.tick(ctx(61_200)); // give up on the cup
    expect(failed.done).toBe(false);

    runner.tick(ctx(61_300));         // scan begins
    runner.tick(ctx(67_400));         // scan finishes (6 s)
    const end = runner.tick(ctx(67_500));

    expect(end.done).toBe(true);
    expect(end.outcome).toBe("partial");
    expect(end.say).toMatch(/1 step failed/i);
    expect(task.steps[0].failed).toBe(true);
    expect(task.steps[1].failed).toBeUndefined();
  });

  it("retries then fails navigation honestly", () => {
    const runner = new TaskRunner();
    const task = runner.planGoto("dock", null, { x: 1, y: 0, z: 0 });

    runner.start(task, 1_000);
    runner.tick(ctx(1_000));

    const retry = runner.tick(ctx(26_001));
    expect(retry.done).toBe(false);
    expect(retry.say).toMatch(/one more pass/i);

    const giveUp = runner.tick(ctx(51_002));
    expect(giveUp.say).toMatch(/could not reach the dock/i);

    const end = runner.tick(ctx(51_003));
    expect(end.done).toBe(true);
    expect(end.outcome).toBe("failed");
    expect(end.say).toMatch(/task failed/i);
  });

  it("does not fly to an item it just failed to find", () => {
    const runner = new TaskRunner();
    const task = runner.planGoto("cup", null, null);
    expect(task.steps.map((s) => s.kind)).toEqual(["search_item", "goto_item"]);

    runner.start(task, 1_000);
    runner.tick(ctx(1_100));
    runner.tick(ctx(31_100));              // retry the search
    runner.tick(ctx(61_200));              // give up — the goto is now pointless

    expect(task.steps[0].failed).toBe(true);
    expect(task.steps[1].skipped).toBe(true);
    expect(task.steps[1].skipReason).toBe("dependency");

    const end = runner.tick(ctx(61_300));
    expect(end.outcome).toBe("failed");
    expect(end.say).toMatch(/1 step failed/i);
    expect(end.say).toMatch(/1 step skipped \(dependency failed\)/i);
  });

  it("keeps a plain command task celebrating exactly as before", () => {
    const runner = new TaskRunner();
    const task = runner.plan("dance");
    if (!task) throw new Error("plan did not parse");
    expect(task.unparsed).toBeUndefined();

    runner.start(task, 1_000);
    runner.tick(ctx(1_000));
    runner.tick(ctx(3_700));   // first trick finishes (elapsed > 2600)
    runner.tick(ctx(3_800));   // second trick starts
    runner.tick(ctx(6_500));   // second trick finishes
    const end = runner.tick(ctx(6_600));

    expect(end.done).toBe(true);
    expect(end.outcome).toBe("completed");
  });
});
