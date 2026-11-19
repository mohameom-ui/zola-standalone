import { describe, expect, it } from "vitest";
import { VisualLoop } from "./visualLoop";

describe("VisualLoop cadence", () => {
  it("does not ask twice inside the interval", () => {
    const loop = new VisualLoop({ intervalMs: 1_000 });
    expect(loop.due(1_000)).toBe(true);
    loop.started(1_000);
    expect(loop.due(1_500)).toBe(false);
    expect(loop.due(2_000)).toBe(true);
  });

  it("allows a new look after the interval even if the last one failed", () => {
    const loop = new VisualLoop({ intervalMs: 1_000, maxFailures: 3 });
    loop.started(1_000);
    loop.failed(1_100);
    expect(loop.due(2_100)).toBe(true);
  });
});

describe("VisualLoop trust window", () => {
  it("trusts a fresh snapshot", () => {
    const loop = new VisualLoop({ intervalMs: 1_000, staleMs: 3_000 });
    loop.succeeded(1_000, ["cup", "chair"]);
    expect(loop.trustedLabels(2_000)).toEqual(["cup", "chair"]);
    expect(loop.isStale(2_000)).toBe(false);
  });

  it("refuses to steer on a stale snapshot", () => {
    const loop = new VisualLoop({ intervalMs: 1_000, staleMs: 3_000 });
    loop.succeeded(1_000, ["cup"]);
    expect(loop.trustedLabels(5_000)).toEqual([]);
    expect(loop.isStale(5_000)).toBe(true);
  });

  it("has no labels before the first successful look", () => {
    const loop = new VisualLoop();
    expect(loop.trustedLabels(10_000)).toEqual([]);
    expect(loop.isStale(10_000)).toBe(true);
  });
});

describe("VisualLoop failure backoff", () => {
  it("backs off only after the failure budget is exhausted", () => {
    const loop = new VisualLoop({ intervalMs: 500, maxFailures: 3, backoffMs: 10_000 });
    loop.started(1_000);
    expect(loop.failed(1_100)).toBe(false);
    expect(loop.failed(1_200)).toBe(false);
    expect(loop.failed(1_300)).toBe(true);

    // blocked for the backoff window
    expect(loop.due(5_000)).toBe(false);
    expect(loop.due(11_300)).toBe(true);
  });

  it("resets the failure count on success", () => {
    const loop = new VisualLoop({ maxFailures: 3, backoffMs: 10_000 });
    loop.failed(1_000);
    loop.failed(1_100);
    loop.succeeded(1_500, ["cup"]);
    expect(loop.failed(2_000)).toBe(false);
    expect(loop.stats().failures).toBe(1);
  });
});
