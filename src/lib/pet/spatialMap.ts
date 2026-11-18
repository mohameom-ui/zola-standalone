// ============================================================================
// DRONE PET — 3D Spatial Occupancy Map (WAVE 11)
// A sparse voxel-hash occupancy map with probabilistic log-odds updates —
// the standard practical form of an octree (recursion is pointless when the
// map is sparse; the hash IS the tree's frontier).
//
// INTEGRITY GUARDRAIL (from the blueprint, kept verbatim in spirit):
// voxels are only updated along TRUE camera sightlines — the ray from her
// pose through a detection's bounding-box center, out to the distance her
// own monocular size-model estimated. Space she has not observed remains
// strictly UNKNOWN — never free, never occupied, never interpolated.
//
// EVIDENCE TAG (v13 open item, closed here): every sightline records WHERE
// its depth came from. Today that is the monocular size model, so the map
// reports `heuristicOnly: true` and the HUD can say so honestly. When the
// ToF/LiDAR rangefinder lands, its stream passes "rangefinder" and no other
// line in the map changes — the ray-marcher is the same, only the evidence is.
// ============================================================================

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Where a sightline's terminal distance came from. */
export type DepthEvidence = "heuristic-depth" | "rangefinder";

const VOXEL = 0.1;          // 0.1 m resolution
const LOG_ODDS_HIT = 0.85;  // a sightline ENDING here: evidence of surface
const LOG_ODDS_MISS = -0.35; // a sightline PASSING through: evidence of free space
const LOG_ODDS_CLAMP = 4.0;
const OCCUPIED_THRESHOLD = 0.65; // P(occupied) after logistic(lo)

const key = (ix: number, iy: number, iz: number) => `${ix},${iy},${iz}`;

export interface SpatialMapStats {
  rays: number;
  occupied: number;
  free: number;
  anchors: number;
  /** sightline count per depth source — the audit trail behind the map */
  evidence: Record<DepthEvidence, number>;
  /** true when every sightline is monocular; false once real range data lands */
  heuristicOnly: boolean;
}

export class SpatialMap {
  /** voxel key → log-odds of occupancy */
  private voxels = new Map<string, number>();
  /** semantic anchors: label → last confirmed 3D position + its depth source */
  private anchors = new Map<string, { pos: Vec3; evidence: DepthEvidence }>();
  /** sightline count per depth source */
  private evidence: Record<DepthEvidence, number> = { "heuristic-depth": 0, rangefinder: 0 };
  rayCount = 0;

  private mark(ix: number, iy: number, iz: number, lo: number) {
    const k = key(ix, iy, iz);
    const cur = this.voxels.get(k) ?? 0;
    this.voxels.set(k, Math.max(-LOG_ODDS_CLAMP, Math.min(LOG_ODDS_CLAMP, cur + lo)));
  }

  /**
   * Integrate one camera sightline: from her pose to the estimated surface
   * point. Voxels along the ray become MORE free; the terminal voxel becomes
   * MORE occupied. Marches in voxel-size steps — no interpolation beyond
   * the ray geometry itself.
   *
   * `source` defaults to "heuristic-depth" because that is the only depth
   * source she has today; a rangefinder stream must say so explicitly.
   */
  markRay(from: Vec3, to: Vec3, source: DepthEvidence = "heuristic-depth") {
    this.rayCount += 1;
    this.evidence[source] += 1;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < VOXEL) {
      const ix = Math.round(to.x / VOXEL), iy = Math.round(to.y / VOXEL), iz = Math.round(to.z / VOXEL);
      this.mark(ix, iy, iz, LOG_ODDS_HIT);
      return;
    }
    const steps = Math.floor(len / VOXEL);
    const ux = dx / len, uy = dy / len, uz = dz / len;
    for (let s = 1; s < steps; s++) {
      const x = from.x + ux * s * VOXEL, y = from.y + uy * s * VOXEL, z = from.z + uz * s * VOXEL;
      this.mark(Math.round(x / VOXEL), Math.round(y / VOXEL), Math.round(z / VOXEL), LOG_ODDS_MISS);
    }
    // terminal voxel — the surface her size-model resolved
    this.mark(Math.round(to.x / VOXEL), Math.round(to.y / VOXEL), Math.round(to.z / VOXEL), LOG_ODDS_HIT);
  }

  isOccupied(x: number, y: number, z: number): boolean {
    const lo = this.voxels.get(key(Math.round(x / VOXEL), Math.round(y / VOXEL), Math.round(z / VOXEL)));
    if (lo === undefined) return false; // UNKNOWN is NOT occupied — ever
    return 1 / (1 + Math.exp(-lo)) > OCCUPIED_THRESHOLD;
  }

  /** Bind a semantic anchor: a label at a confirmed 3D position. */
  anchor(label: string, pos: Vec3, source: DepthEvidence = "heuristic-depth") {
    this.anchors.set(label.toLowerCase(), { pos: { ...pos }, evidence: source });
  }

  getAnchor(label: string): Vec3 | null {
    const anchored = this.anchors.get(label.toLowerCase());
    return anchored ? { ...anchored.pos } : null; // defensive: callers cannot edit the map
  }

  /** The depth source behind a label's last anchor — null when never seen. */
  getAnchorEvidence(label: string): DepthEvidence | null {
    return this.anchors.get(label.toLowerCase())?.evidence ?? null;
  }

  anchorCount(): number {
    return this.anchors.size;
  }

  stats(): SpatialMapStats {
    let occupied = 0, free = 0;
    for (const lo of this.voxels.values()) {
      const p = 1 / (1 + Math.exp(-lo));
      if (p > OCCUPIED_THRESHOLD) occupied += 1;
      else if (p < 0.4) free += 1;
    }
    return {
      rays: this.rayCount,
      occupied,
      free,
      anchors: this.anchors.size,
      evidence: { ...this.evidence },
      heuristicOnly: this.evidence.rangefinder === 0,
    };
  }
}
