// ============================================================================
// ZOLA — VLM closed loop (timing brain for look -> decide -> move)
//
// A vision-language model is slow. Asking it every frame would freeze her;
// asking it once and trusting the answer forever would fly her into a chair
// that moved. This class owns the cadence and the trust window, so the panel
// only has to ask three questions:
//
//   due(now)            may I take a new look?
//   started(now)        I asked (stops double-firing while inference runs)
//   succeeded/failed    what came back
//   trustedLabels(now)  what I may still act on (empty once stale)
//
// Pure timing + policy. No model, no camera, no DOM — testable in CI.
// ============================================================================

export interface VisualLoopOptions {
  /** normal cadence between looks, ms */
  intervalMs?: number;
  /** a snapshot older than this may not steer motion, ms */
  staleMs?: number;
  /** consecutive failures before backing off */
  maxFailures?: number;
  /** how long to stop asking after the failure budget is spent, ms */
  backoffMs?: number;
}

export interface VisualLoopStats {
  lastRunAt: number;
  lastOkAt: number;
  failures: number;
  blockedUntil: number;
  stale: boolean;
}

export class VisualLoop {
  private readonly intervalMs: number;
  private readonly staleMs: number;
  private readonly maxFailures: number;
  private readonly backoffMs: number;

  private lastRunAt = 0;
  private lastOkAt = 0;
  private labels: string[] = [];
  private failures = 0;
  private blockedUntil = 0;

  constructor(opts: VisualLoopOptions = {}) {
    this.intervalMs = Math.max(200, opts.intervalMs ?? 1_200);
    this.staleMs = Math.max(this.intervalMs, opts.staleMs ?? 4_000);
    this.maxFailures = Math.max(1, opts.maxFailures ?? 3);
    this.backoffMs = Math.max(1_000, opts.backoffMs ?? 15_000);
  }

  /** True when a new look is allowed: cadence elapsed and not backing off. */
  due(now: number): boolean {
    if (now < this.blockedUntil) return false;
    return now - this.lastRunAt >= this.intervalMs;
  }

  /** The request has been issued — prevents a second one while it runs. */
  started(now: number): void {
    this.lastRunAt = now;
  }

  /** A usable answer arrived. */
  succeeded(now: number, labels: string[]): void {
    this.lastOkAt = now;
    this.labels = labels.slice();
    this.failures = 0;
  }

  /**
   * The look failed. Returns true when this failure exhausted the budget and
   * started a backoff — the caller should stop asking until `due` says so.
   */
  failed(now: number): boolean {
    this.failures += 1;
    if (this.failures >= this.maxFailures) {
      this.failures = 0;
      this.blockedUntil = now + this.backoffMs;
      return true;
    }
    return false;
  }

  /** What she may act on right now — empty when the last look is stale. */
  trustedLabels(now: number): string[] {
    if (this.lastOkAt === 0 || now - this.lastOkAt > this.staleMs) return [];
    return this.labels;
  }

  isStale(now: number): boolean {
    return this.lastOkAt === 0 || now - this.lastOkAt > this.staleMs;
  }

  stats(): VisualLoopStats {
    return {
      lastRunAt: this.lastRunAt,
      lastOkAt: this.lastOkAt,
      failures: this.failures,
      blockedUntil: this.blockedUntil,
      stale: this.lastOkAt === 0,
    };
  }
}
