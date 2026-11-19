import { describe, expect, it } from "vitest";
import { DeepSenseLoop } from "./deepSenseLoop";

describe("DeepSenseLoop", () => {
  it("does nothing before the cadence is due", async () => {
    let calls = 0;
    const loop = new DeepSenseLoop(
      { describe: async () => { calls += 1; return "a cup"; }, onText: () => {} },
      { intervalMs: 1_000 },
    );
    expect(await loop.tick(500)).toBe(false);
    expect(calls).toBe(0);
  });

  it("never runs two inferences at once", async () => {
    let calls = 0;
    let release!: (v: string | null) => void;
    const gate = new Promise<string | null>((resolve) => { release = resolve; });
    const loop = new DeepSenseLoop(
      { describe: () => { calls += 1; return gate; }, onText: () => {} },
      { intervalMs: 100 },
    );

    const first = loop.tick(1_000);
    const second = await loop.tick(2_000); // due, but the first is still running
    expect(second).toBe(false);
    expect(calls).toBe(1);

    release("a chair");
    await first;
  });

  it("delivers a usable description and refreshes the trust window", async () => {
    const seen: string[] = [];
    const loop = new DeepSenseLoop(
      { describe: async () => "  a red cup on the desk  ", onText: (t) => seen.push(t) },
      { intervalMs: 1_000, staleMs: 4_000 },
    );

    expect(await loop.tick(1_000)).toBe(true);
    expect(seen).toEqual(["a red cup on the desk"]);
    expect(loop.lastDescription).toBe("a red cup on the desk");
    expect(loop.loop.isStale(2_000)).toBe(false);
    expect(loop.loop.isStale(6_000)).toBe(true);
  });

  it("counts an empty answer as a failed look", async () => {
    const loop = new DeepSenseLoop(
      { describe: async () => "   ", onText: () => {} },
      { intervalMs: 100, maxFailures: 3 },
    );
    expect(await loop.tick(1_000)).toBe(true);
    expect(loop.loop.stats().failures).toBe(1);
  });

  it("reports errors and backs off after repeated failures", async () => {
    const errors: unknown[] = [];
    const loop = new DeepSenseLoop(
      {
        describe: async () => { throw new Error("model gone"); },
        onText: () => {},
        onError: (e) => errors.push(e),
      },
      { intervalMs: 100, maxFailures: 2, backoffMs: 10_000 },
    );

    await loop.tick(1_000);
    await loop.tick(200);       // not due; ignored
    await loop.tick(1_200);
    expect(errors).toHaveLength(2);
    expect(loop.loop.due(5_000)).toBe(false); // backing off
    expect(loop.loop.due(12_000)).toBe(true);
  });
});
