import { describe, expect, it } from "vitest";
import { parseRangeLine, RangeSource } from "./rangeSource";
import type { RangeReading } from "./rangeFusion";
import { SpatialMap } from "./spatialMap";

const pose = () => ({ x: 0, y: 0, z: 0, yaw: 0 });

describe("parseRangeLine", () => {
  it("accepts long and short key spellings", () => {
    expect(parseRangeLine('{"distance":1.2,"bearing":0.1,"elevation":0,"at":500}')).toEqual({
      distance: 1.2,
      bearing: 0.1,
      elevation: 0,
      at: 500,
    });
    expect(parseRangeLine('{"d":2,"b":-0.2,"t":900}')).toEqual({ distance: 2, bearing: -0.2, at: 900 });
  });

  it("defaults the timestamp when the bridge omits one", () => {
    const before = Date.now();
    const r = parseRangeLine('{"d":1,"b":0}');
    expect(r).not.toBeNull();
    expect(r!.at).toBeGreaterThanOrEqual(before);
    expect(r!.at).toBeLessThanOrEqual(Date.now());
  });

  it("refuses malformed lines instead of guessing", () => {
    expect(parseRangeLine("")).toBeNull();
    expect(parseRangeLine("not json")).toBeNull();
    expect(parseRangeLine('{"d":"1","b":0}')).toBeNull();
    expect(parseRangeLine('{"d":1}')).toBeNull();
    expect(parseRangeLine('{"b":0}')).toBeNull();
  });
});

describe("RangeSource", () => {
  it("fuses accepted readings and counts them", () => {
    const map = new SpatialMap();
    const src = new RangeSource(map, pose, () => 1_000, 500);

    expect(src.ingest({ distance: 1, bearing: 0, at: 900 })).toBe(true);
    expect(map.stats().evidence.rangefinder).toBe(1);
    expect(src.stats().accepted).toBe(1);

    expect(src.ingest({ distance: 1, bearing: 0, at: 100 })).toBe(false);
    expect(src.stats().rejected).toBe(1);
    expect(map.stats().evidence.rangefinder).toBe(1);
  });

  it("routes a transport through the same path", () => {
    const map = new SpatialMap();
    const src = new RangeSource(map, pose, () => 1_000, 500);
    let deliver: ((r: RangeReading) => void) | null = null;
    let unsubscribed = 0;
    let closed = 0;

    src.attach({
      onReading: (cb) => {
        deliver = cb;
        return () => { unsubscribed += 1; };
      },
      close: () => { closed += 1; },
    });

    deliver!({ distance: 1, bearing: 0, at: 950 });
    expect(src.stats().accepted).toBe(1);

    src.detach();
    expect(unsubscribed).toBe(1);
    expect(closed).toBe(1);
  });

  it("replaces the previous transport on re-attach", () => {
    const map = new SpatialMap();
    const src = new RangeSource(map, pose, () => 1_000, 500);
    let firstClosed = 0;
    let secondClosed = 0;

    src.attach({ onReading: () => () => {}, close: () => { firstClosed += 1; } });
    src.attach({ onReading: () => () => {}, close: () => { secondClosed += 1; } });
    expect(firstClosed).toBe(1);

    src.detach();
    expect(secondClosed).toBe(1);
  });
});
