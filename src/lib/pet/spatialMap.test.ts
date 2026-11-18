import { describe, expect, it } from "vitest";
import { SpatialMap } from "./spatialMap";

describe("SpatialMap depth evidence", () => {
  it("leaves unobserved space unknown", () => {
    const map = new SpatialMap();
    expect(map.isOccupied(5, 5, 5)).toBe(false);
    const stats = map.stats();
    expect(stats.occupied).toBe(0);
    expect(stats.free).toBe(0);
    expect(stats.rays).toBe(0);
  });

  it("marks the terminal voxel occupied and the path free", () => {
    const map = new SpatialMap();
    map.markRay({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(map.isOccupied(1, 0, 0)).toBe(true);
    expect(map.isOccupied(0.5, 0, 0)).toBe(false);
  });

  it("tags monocular sightlines as heuristic by default", () => {
    const map = new SpatialMap();
    map.markRay({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const stats = map.stats();
    expect(stats.evidence["heuristic-depth"]).toBe(1);
    expect(stats.evidence.rangefinder).toBe(0);
    expect(stats.heuristicOnly).toBe(true);
  });

  it("separates rangefinder evidence and clears heuristicOnly", () => {
    const map = new SpatialMap();
    map.markRay({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, "rangefinder");
    const stats = map.stats();
    expect(stats.evidence.rangefinder).toBe(1);
    expect(stats.evidence["heuristic-depth"]).toBe(0);
    expect(stats.heuristicOnly).toBe(false);
  });

  it("records the depth source behind each semantic anchor", () => {
    const map = new SpatialMap();
    map.anchor("cup", { x: 1, y: 2, z: 3 });
    map.anchor("door", { x: 4, y: 5, z: 6 }, "rangefinder");
    expect(map.getAnchor("CUP")).toEqual({ x: 1, y: 2, z: 3 });
    expect(map.getAnchorEvidence("cup")).toBe("heuristic-depth");
    expect(map.getAnchorEvidence("door")).toBe("rangefinder");
    expect(map.getAnchorEvidence("never-seen")).toBeNull();
    expect(map.anchorCount()).toBe(2);
  });

  it("does not mutate a returned anchor when the caller edits it", () => {
    const map = new SpatialMap();
    map.anchor("box", { x: 1, y: 1, z: 1 });
    const pos = map.getAnchor("box");
    expect(pos).not.toBeNull();
    if (pos) pos.x = 99;
    expect(map.getAnchor("box")).toEqual({ x: 1, y: 1, z: 1 });
  });
});
