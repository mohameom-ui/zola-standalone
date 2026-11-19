// ============================================================================
// ZOLA — latency meter
//
// The 1.5B brain is only worth its memory if it answers fast enough to be a
// companion. This meter keeps a small rolling window of real inference times
// and reports p50/p95, so the decision is made from measurement rather than
// vibes. Bounded on purpose: no unbounded arrays on a flying robot.
// ============================================================================

export interface LatencyStats {
  count: number;
  lastMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export class LatencyMeter {
  private samples: number[] = [];
  private last = 0;

  constructor(private readonly capacity = 32) {}

  /** Ignore nonsense (NaN, negatives) instead of poisoning the window. */
  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.last = ms;
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  stats(): LatencyStats {
    const n = this.samples.length;
    if (n === 0) return { count: 0, lastMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pick = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
    return {
      count: n,
      lastMs: this.last,
      p50Ms: pick(0.5),
      p95Ms: pick(0.95),
      maxMs: sorted[n - 1],
    };
  }

  reset(): void {
    this.samples = [];
    this.last = 0;
  }
}
