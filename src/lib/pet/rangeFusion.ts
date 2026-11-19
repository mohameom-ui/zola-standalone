// ============================================================================
// ZOLA — physical range fusion (ToF / LiDAR boundary)
//
// The spatial map has been able to tag a sightline as "rangefinder" since the
// v13 evidence change, but nothing produced such a sightline. This module is
// the boundary a real sensor plugs into: one reading in, one measured ray in
// the map — no monocular guessing, no interpolation.
//
// Deliberately hardware-free: the driver belongs to the body, the geometry
// and the honesty rules belong here, where CI can prove them.
// ============================================================================

import type { SpatialMap, Vec3 } from "./spatialMap";

export interface RangeReading {
  /** metres along the beam, sensor frame */
  distance: number;
  /** radians, relative to her heading (0 = straight ahead, + = left) */
  bearing: number;
  /** radians, + up. Omit for a planar scanner. */
  elevation?: number;
  /** capture time, ms — the same clock the caller passes to fuseRange */
  at: number;
}

export interface Pose2D {
  x: number;
  y: number;
  z: number;
  /** her heading in radians (world frame) */
  yaw: number;
}

/** A short-range ToF cone; readings outside this are noise, not geometry. */
export const RANGE_MIN_M = 0.08;
export const RANGE_MAX_M = 4.0;
/** A reading older than this may not move the map — the world has changed. */
export const RANGE_MAX_AGE_MS = 500;

/** Reject anything a real rangefinder could not have produced. */
export function validReading(r: RangeReading, now: number, maxAgeMs = RANGE_MAX_AGE_MS): boolean {
  if (!Number.isFinite(r.distance) || !Number.isFinite(r.bearing)) return false;
  if (r.distance < RANGE_MIN_M || r.distance > RANGE_MAX_M) return false;
  const age = now - r.at;
  return age >= 0 && age <= maxAgeMs;
}

/** Sensor frame -> world point. The only place the trigonometry lives. */
export function rangePoint(pose: Pose2D, r: RangeReading): Vec3 {
  const elevation = r.elevation ?? 0;
  const horizontal = r.distance * Math.cos(elevation);
  const yaw = pose.yaw + r.bearing;
  return {
    x: pose.x + Math.cos(yaw) * horizontal,
    y: pose.y + Math.sin(yaw) * horizontal,
    z: pose.z + r.distance * Math.sin(elevation),
  };
}

/**
 * Fuse one reading as a measured sightline. Returns false (and changes
 * nothing) when the reading is stale or implausible — a rangefinder that
 * lies is worse than no rangefinder.
 */
export function fuseRange(
  map: SpatialMap,
  pose: Pose2D,
  reading: RangeReading,
  now: number,
  maxAgeMs = RANGE_MAX_AGE_MS,
): boolean {
  if (!validReading(reading, now, maxAgeMs)) return false;
  map.markRay(
    { x: pose.x, y: pose.y, z: pose.z },
    rangePoint(pose, reading),
    "rangefinder",
  );
  return true;
}
