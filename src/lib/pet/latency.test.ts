import { describe, expect, it } from "vitest";
import { LatencyMeter } from "./latency";

describe("LatencyMeter", () => {
  it("reports nothing before the first sample", () => {
    const meter = new LatencyMeter();
    expect(meter.stats()).toEqual({ count: 0, lastMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
  });

  it("computes p50 and p95 from a known window", () => {
    const meter = new LatencyMeter();
    for (const ms of [400, 100, 300, 200]) meter.record(ms);
    const s = meter.stats();
    expect(s.count).toBe(4);
    expect(s.p50Ms).toBe(200);
    expect(s.p95Ms).toBe(400);
    expect(s.maxMs).toBe(400);
    expect(s.lastMs).toBe(200);
  });

  it("keeps only the most recent samples", () => {
    const meter = new LatencyMeter(3);
    for (const ms of [10, 20, 30, 40, 50]) meter.record(ms);
    const s = meter.stats();
    expect(s.count).toBe(3);
    expect(s.maxMs).toBe(50);
    expect(s.p50Ms).toBe(40);
  });

  it("ignores invalid timings", () => {
    const meter = new LatencyMeter();
    meter.record(Number.NaN);
    meter.record(-5);
    meter.record(Number.POSITIVE_INFINITY);
    expect(meter.stats().count).toBe(0);

    meter.record(120);
    expect(meter.stats().count).toBe(1);
  });

  it("resets cleanly", () => {
    const meter = new LatencyMeter();
    meter.record(100);
    meter.reset();
    expect(meter.stats().count).toBe(0);
  });
});
