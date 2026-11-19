import { describe, expect, it } from "vitest";
import { fuseRange, rangePoint, validReading } from "./rangeFusion";
import { SpatialMap } from "./spatialMap";

const pose = { x: 0, y: 0, z: 0, yaw: 0 };

describe("range reading validation", () => {
  it("accepts a plausible, fresh reading", () => {
    expect(validReading({ distance: 1.2, bearing: 0, at: 1_000 }, 1_100)).toBe(true);
  });

  it("rejects stale readings", () => {
    expect(validReading({ distance: 1.2, bearing: 0, at: 1_000 }, 1_600)).toBe(false);
  });

  it("rejects readings from the future and impossible distances", () => {
    expect(validReading({ distance: 1.2, bearing: 0, at: 2_000 }, 1_000)).toBe(false);
    expect(validReading({ distance: 0.01, bearing: 0, at: 1_000 }, 1_000)).toBe(false);
    expect(validReading({ distance: 4.5, bearing: 0, at: 1_000 }, 1_000)).toBe(false);
    expect(validReading({ distance: Number.NaN, bearing: 0, at: 1_000 }, 1_000)).toBe(false);
  });
});

describe("range geometry", () => {
  it("projects a forward reading along +x", () => {
    const p = rangePoint(pose, { distance: 1, bearing: 0, at: 0 });
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it("rotates with her heading and the beam bearing", () => {
    const p = rangePoint({ ...pose, yaw: Math.PI / 2 }, { distance: 1, bearing: 0, at: 0 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(1, 6);

    const q = rangePoint(pose, { distance: 1, bearing: -Math.PI / 2, at: 0 });
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(-1, 6);
  });

  it("lifts a reading with elevation", () => {
    const p = rangePoint(pose, { distance: 1, bearing: 0, elevation: Math.PI / 2, at: 0 });
    expect(p.z).toBeCloseTo(1, 6);
    expect(p.x).toBeCloseTo(0, 6);
  });
});

describe("fusing into the spatial map", () => {
  it("marks a measured hit and counts rangefinder evidence", () => {
    const map = new SpatialMap();
    const ok = fuseRange(map, pose, { distance: 1, bearing: 0, at: 1_000 }, 1_100);

    expect(ok).toBe(true);
    expect(map.isOccupied(1, 0, 0)).toBe(true);
    expect(map.stats().evidence.rangefinder).toBe(1);
    expect(map.stats().heuristicOnly).toBe(false);
  });

  it("leaves the map untouched when the reading is rejected", () => {
    const map = new SpatialMap();
    const ok = fuseRange(map, pose, { distance: 1, bearing: 0, at: 1_000 }, 9_000);

    expect(ok).toBe(false);
    expect(map.stats().rays).toBe(0);
    expect(map.stats().evidence.rangefinder).toBe(0);
    expect(map.stats().heuristicOnly).toBe(true);
  });

  it("mixes measured and monocular sightlines without confusing them", () => {
    const map = new SpatialMap();
    map.markRay({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }); // heuristic
    fuseRange(map, pose, { distance: 1, bearing: 0, at: 5_000 }, 5_100);

    const stats = map.stats();
    expect(stats.evidence["heuristic-depth"]).toBe(1);
    expect(stats.evidence.rangefinder).toBe(1);
    expect(stats.heuristicOnly).toBe(false);
  });
});
