// ============================================================================
// DRONE PET — Spatial Map
// The room as AURA knows it: bounds, a dock pad, obstacles (pillars) she must
// steer around, and geometry helpers used by navigation + avoidance.
// Item *positions* live in AuraMemory (persisted); obstacles are per-session
// (rooms change — she re-learns them by touching, or you place them here).
// ============================================================================

import type { Vec3 } from "./types";

export interface Obstacle {
  id: string;
  x: number;
  y: number;
  /** radius in meters */
  r: number;
  /** height — obstacles block flight below this altitude */
  h: number;
  /** HARM AWARENESS: hazard zone — bigger standoff, drawn red */
  hazard?: boolean;
}

/** Room half-extents (world is -EXTENT..+EXTENT on x and y). */
export const ROOM_EXTENT = 1.6;

/** The charging dock — her home. */
export const DOCK: Vec3 = { x: -1.2, y: -1.2, z: 0 };

const DRONE_RADIUS = 0.12;

export function segCircleHit(
  from: { x: number; y: number },
  to: { x: number; y: number },
  c: { x: number; y: number; r: number },
): boolean {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(from.x - c.x, from.y - c.y) < c.r;
  let t = ((c.x - from.x) * dx + (c.y - from.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = from.x + dx * t, py = from.y + dy * t;
  return Math.hypot(px - c.x, py - c.y) < c.r + DRONE_RADIUS;
}

export function pathClear(from: { x: number; y: number }, to: { x: number; y: number }, obstacles: Obstacle[], atAltitude: number): boolean {
  if (atAltitude > 0.9) return true; // above most furniture
  for (const o of obstacles) {
    if (atAltitude > o.h) continue; // fly over it
    if (segCircleHit(from, to, o)) return false;
  }
  return true;
}

/**
 * Whisker steering: try the direct path; if blocked, rotate the leg in 30°
 * increments (alternating sides) until a clear heading is found.
 */
export function steerAround(from: { x: number; y: number }, to: { x: number; y: number }, obstacles: Obstacle[], atAltitude: number): { x: number; y: number } {
  if (pathClear(from, to, obstacles, atAltitude)) return to;
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  const base = Math.atan2(dy, dx);
  for (const side of [1, -1]) {
    for (const deg of [30, 60, 90, 120]) {
      const a = base + side * (deg * Math.PI) / 180;
      const cand = { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
      if (pathClear(from, cand, obstacles, atAltitude)) return cand;
    }
  }
  return from; // fully boxed in — hold position (governor keeps her safe)
}

export class PetMap {
  private obstacles: Obstacle[] = [];

  all(): Obstacle[] { return this.obstacles; }

  toggle(x: number, y: number): boolean {
    const hit = this.obstacles.find((o) => Math.hypot(o.x - x, o.y - y) < o.r + 0.05);
    if (hit) {
      this.obstacles = this.obstacles.filter((o) => o.id !== hit.id);
      return false; // removed
    }
    this.obstacles.push({
      id: `o_${Date.now().toString(36)}`,
      x, y, r: 0.16, h: 0.55 + Math.random() * 0.3,
    });
    return true; // added
  }

  clear() { this.obstacles = []; }

  /**
   * Self-learned obstacle: scanned items become soft obstacles automatically —
   * she marks her own room as she explores (never near her dock).
   */
  /** HARM AWARENESS: hazard zones keep a LARGER standoff than plain obstacles. */
  addHazard(x: number, y: number, r: number) {
    const rr = Math.min(0.45, r * 2.2); // hazards get a wide berth
    if (this.obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + rr) * 0.8)) return;
    this.obstacles.push({
      id: `h_${Date.now().toString(36)}`,
      x, y, r: rr, h: 1.0, hazard: true,
    });
  }

  addSoft(x: number, y: number, r: number) {
    if (Math.hypot(x - DOCK.x, y - DOCK.y) < 0.5) return; // keep her landing zone clear
    if (this.obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + r) * 0.8)) return;
    this.obstacles.push({
      id: `s_${Date.now().toString(36)}${Math.floor(Math.random() * 1e3).toString(36)}`,
      x, y, r: Math.min(0.3, r), h: 0.5,
    });
  }

  steer(from: { x: number; y: number }, to: { x: number; y: number }, atAltitude: number) {
    return steerAround(from, to, this.obstacles, atAltitude);
  }
}
