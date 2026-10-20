// ============================================================================
// DRONE PET — Telemetry Black-Box (WAVE 2)
// A local ring buffer of her flight + cognitive state vectors, sampled from
// the panel's main loop. Hardware-agnostic: the same recording works for
// SimDroneHAL and the MAVLink bridge. Memory-capped, zero network, and a
// one-click export for debugging (or for her day-one flight report).
// ============================================================================

export interface BlackboxEntry {
  t: string;              // ISO timestamp
  mood: string;
  activity: string;
  battery: number;        // 0..1
  alt: number;            // meters (sim or real)
  yaw: number;            // radians
  px: number;             // position x
  py: number;             // position y
  pitch?: number;         // WAVE 8 — degrees (attitude stability diagnostics)
  roll?: number;          // WAVE 8 — degrees
  flags?: string;         // safety governor flags at sample time
}

const CAP = 2_400; // ~20 min at 2 Hz — old samples fall off the ring

export class Blackbox {
  private ring: BlackboxEntry[] = [];
  private lastAt = 0;
  recording = true;

  /** Rate-limited sampler — call every tick; stores at most ~2 Hz. */
  record(entry: Omit<BlackboxEntry, "t">, nowMs: number) {
    if (!this.recording) return;
    if (nowMs - this.lastAt < 500) return;
    this.lastAt = nowMs;
    this.ring.push({ ...entry, t: new Date().toISOString() });
    if (this.ring.length > CAP) this.ring.splice(0, this.ring.length - CAP);
  }

  note(event: string) {
    if (!this.recording || this.ring.length === 0) return;
    const last = this.ring[this.ring.length - 1];
    last.flags = last.flags ? `${last.flags} | ${event}` : event;
  }

  get size() { return this.ring.length; }

  exportJSON(): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      count: this.ring.length,
      entries: [...this.ring],
    }, null, 2);
  }

  /** WAVE 4 — mood arc: how her emotional time was spent in the window. */
  moodArc(): { counts: Record<string, number>; dominant: string; samples: number } {
    const counts: Record<string, number> = {};
    for (const e of this.ring) counts[e.mood] = (counts[e.mood] ?? 0) + 1;
    let dominant = "idle";
    let best = 0;
    for (const [m, c] of Object.entries(counts)) if (c > best) { best = c; dominant = m; }
    return { counts, dominant, samples: this.ring.length };
  }

  /** WAVE 8 — read-only copy for the diagnostics engine. */
  snapshot(): BlackboxEntry[] {
    return [...this.ring];
  }

  /** Quick stats for the panel chip. */
  summary(): string {
    if (this.ring.length === 0) return "empty";
    const bats = this.ring.map((e) => e.battery);
    return `${this.ring.length} samples · battery ${(Math.min(...bats) * 100).toFixed(0)}–${(Math.max(...bats) * 100).toFixed(0)}%`;
  }

  clear() { this.ring = []; }
}
