// GROUND NAVIGATION — the walk_item step: she travels to places on her legs.
// Every test here is a piece of the promise: "I walk, I do not fly."

import { describe, it, expect } from "vitest";
import { TaskRunner } from "./tasks";

const ctx = (over: Partial<Parameters<TaskRunner["tick"]>[0]> = {}) => ({
  now: performance.now(),
  faceSeen: false,
  faceSize: 0,
  visibleItems: [],
  yaw: 0,
  px: 0,
  py: 0,
  ...over,
});

describe("planWalkGoto — the walking nav plan", () => {
  it("walks straight to a remembered map position", () => {
    const r = new TaskRunner();
    const task = r.planWalkGoto("the dock", null, { x: 1, y: 0, z: 0 });
    expect(task.steps.some((s) => s.kind === "walk_item")).toBe(true);
    expect(task.description).toContain("Walk to the dock");
  });

  it("searches first when the destination is neither mapped nor headed", () => {
    const r = new TaskRunner();
    const task = r.planWalkGoto("my cup", null, null);
    expect(task.steps[0].kind).toBe("search_item");
    expect(task.steps[1].kind).toBe("walk_item");
  });
});

describe("walk_item — driving on the ground", () => {
  it("strides forward when aligned with the target", () => {
    const r = new TaskRunner();
    r.start(r.planWalkGoto("the dock", null, { x: 2, y: 0, z: 0 }), performance.now());
    const t = r.tick(ctx()); // facing +x, target at +x, far away
    expect(t.activity).toBe("walk");
    expect(t.vx).toBeGreaterThan(0);
    expect(t.vx).toBeLessThanOrEqual(0.2); // a stroll, not a sprint
  });

  it("turns in place toward the target before striding", () => {
    const r = new TaskRunner();
    r.start(r.planWalkGoto("the dock", null, { x: 0, y: 2, z: 0 }), performance.now());
    const t = r.tick(ctx()); // target 90° to her left
    expect(t.activity).toBe("walk");
    expect(t.yawRate).toBeGreaterThan(0); // positive yaw = left turn toward +y
    expect(t.vx).toBeUndefined();
  });

  it("announces arrival at the spot and stands", () => {
    const r = new TaskRunner();
    r.start(r.planWalkGoto("the dock", null, { x: 0.1, y: 0, z: 0 }), performance.now());
    const t1 = r.tick(ctx());
    expect(t1.say).toMatch(/walked to the dock/i); // arrival line this frame
    expect(t1.done).toBe(false);                   // completion reports next frame
    const t2 = r.tick(ctx());
    expect(t2.done).toBe(true);
  });

  it("prefers her eyes: spotting the item finishes the walk", () => {
    const r = new TaskRunner();
    r.start(r.planWalkGoto("my cup", null, { x: 2, y: 0, z: 0 }), performance.now());
    const t1 = r.tick(ctx({ visibleItems: ["cup"] }));
    expect(t1.say).toMatch(/strolled right up/i);
    expect(r.tick(ctx()).done).toBe(true);
  });
});
