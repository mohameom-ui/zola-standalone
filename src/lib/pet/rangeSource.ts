// ============================================================================
// ZOLA — range source (the device boundary behind fuseRange)
//
// fuseRange() knows how to put one honest reading into the map. This class is
// what a transport plugs into: any sensor bridge that speaks JSON lines can
// feed her without touching the map code, and every accepted/rejected reading
// is counted so a flaky device is visible instead of silent.
//
//   const src = new RangeSource(map, () => ({ ...hal.pose(), yaw: hal.yaw() }));
//   src.attach({ onReading: (cb) => socketLines(cb) });
//
// No DOM, no sockets in here — testable in CI.
// ============================================================================

import { fuseRange, type Pose2D, type RangeReading } from "./rangeFusion";
import type { SpatialMap } from "./spatialMap";

export interface RangeTransport {
  /** Deliver every parsed reading; return an unsubscribe function. */
  onReading(cb: (r: RangeReading) => void): () => void;
  close?(): void;
}

export interface RangeSourceStats {
  accepted: number;
  rejected: number;
  lastAcceptedAt: number;
  lastRejectedAt: number;
}

export class RangeSource {
  private transport: RangeTransport | null = null;
  private unsubscribe: (() => void) | null = null;
  private accepted = 0;
  private rejected = 0;
  private lastAcceptedAt = 0;
  private lastRejectedAt = 0;

  constructor(
    private readonly map: SpatialMap,
    private readonly pose: () => Pose2D,
    private readonly now: () => number = () => Date.now(),
    private readonly maxAgeMs?: number,
  ) {}

  /** Start consuming a transport. Re-attaching detaches the previous one. */
  attach(transport: RangeTransport): void {
    this.detach();
    this.transport = transport;
    this.unsubscribe = transport.onReading((r) => this.ingest(r));
  }

  detach(): void {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    if (this.transport?.close) this.transport.close();
    this.transport = null;
  }

  /** Fuse one reading. Returns whether it was accepted. */
  ingest(reading: RangeReading): boolean {
    const ok = fuseRange(this.map, this.pose(), reading, this.now(), this.maxAgeMs);
    if (ok) {
      this.accepted += 1;
      this.lastAcceptedAt = this.now();
    } else {
      this.rejected += 1;
      this.lastRejectedAt = this.now();
    }
    return ok;
  }

  stats(): RangeSourceStats {
    return {
      accepted: this.accepted,
      rejected: this.rejected,
      lastAcceptedAt: this.lastAcceptedAt,
      lastRejectedAt: this.lastRejectedAt,
    };
  }
}

/**
 * Parse one line from a sensor bridge.
 *
 *   {"distance":1.2,"bearing":0.1,"elevation":0,"at":1730000000000}
 *   {"d":1.2,"b":0.1,"e":0,"t":1730000000000}
 *
 * Anything malformed returns null — the caller counts it as rejected.
 */
export function parseRangeLine(line: string): RangeReading | null {
  const text = line.trim();
  if (!text) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const distance = num(raw.distance ?? raw.d);
  const bearing = num(raw.bearing ?? raw.b);
  if (distance === null || bearing === null) return null;
  const elevation = num(raw.elevation ?? raw.e);
  const at = num(raw.at ?? raw.t);
  return {
    distance,
    bearing,
    ...(elevation !== null ? { elevation } : {}),
    at: at ?? Date.now(),
  };
}
