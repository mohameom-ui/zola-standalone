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

/** A semantic zone — a named area of the home with a centroid. */
export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  /** items associated with this zone (auto-clustered from spatial memory) */
  itemLabels: string[];
}

/** Room zone presets — auto-named from object clustering */
const ZONE_NAMES = [
  "workspace", "reading corner", "kitchen counter", "living area",
  "storage zone", "entryway", "hobby station", "window perch",
];

export class PetMap {
  private obstacles: Obstacle[] = [];
  private zones: Zone[] = [];

  all(): Obstacle[] { return this.obstacles; }
  getZones(): Zone[] { return this.zones; }

  /** Auto-detect zones by clustering items spatially (DBSCAN-lite). */
  detectZones(items: { label: string; pos: { x: number; y: number } | null }[]): Zone[] {
    if (items.length < 3) return this.zones;
    const positioned = items.filter((i) => i.pos);
    if (positioned.length < 3) return this.zones;
    // cluster by proximity (0.8m threshold)
    const clusters: { x: number; y: number; labels: string[] }[] = [];
    for (const item of positioned) {
      const p = item.pos!;
      const nearest = clusters.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 0.8);
      if (nearest) { nearest.labels.push(item.label); }
      else clusters.push({ x: p.x, y: p.y, labels: [item.label] });
    }
    // name each cluster from its dominant object type
    this.zones = clusters.slice(0, 8).map((c, i) => ({
      id: `zone_${i}`,
      name: ZONE_NAMES[i % ZONE_NAMES.length],
      x: c.x, y: c.y,
      itemLabels: c.labels,
    }));
    return this.zones;
  }

  /** Find a zone by natural language query ("the desk", "kitchen area"). */
  findZone(query: string): Zone | null {
    const q = query.toLowerCase();
    return this.zones.find((z) => q.includes(z.name) || z.itemLabels.some((l) => q.includes(l))) ?? null;
  }

  /** HARM AWARENESS: hazard zones keep a LARGER standoff than plain obstacles. */
  addHazard(x: number, y: number, r: number) {
    const rr = Math.min(0.45, r * 2.2);
    if (this.obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + rr) * 0.8)) return;
    this.obstacles.push({ id: `h_${Date.now().toString(36)}`, x, y, r: rr, h: 1.0, hazard: true });
  }

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
