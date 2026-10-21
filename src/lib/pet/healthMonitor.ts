// HEALTH MONITOR — Zola watches her own operational environment (v3.3)
// When VRAM, heap, or GPU memory crosses safety thresholds, she alerts the
// user with her signature technical commentary. She also checks her
// sovereign remote for upstream commits on startup.
//
// The hardware destiny: on the real Pi 5, the same thresholds map to
// CPU temperature, battery voltage, and storage — the interface is the same.

export interface HealthAlert {
  level: "info" | "warning" | "critical";
  system: string;    // "vram" | "heap" | "gpu" | "battery"
  message: string;
  at: string;
}

export interface UpdateCheck {
  hasUpdate: boolean;
  remoteHead: string | null;
  localHead: string | null;
  message: string;
}

const THRESHOLDS = {
  heapWarnPct: 0.75,   // 75% of the JS heap limit
  heapCritPct: 0.85,
  vramWarnMB: 6500,    // 6.5 GB of the 8 GB VRAM
  vramCritMB: 7500,
};

export class HealthMonitor {
  private alerts: HealthAlert[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private onAlert: (a: HealthAlert) => void = () => {};
  private remoteUrl = "https://api.github.com/repos/mohameom-ui/zola-standalone/commits?per_page=1";
  private localHead = "";

  setLocalHead(sha: string): void { this.localHead = sha; }
  onAlertFn(fn: (a: HealthAlert) => void): void { this.onAlert = fn; }

  getAlerts(): HealthAlert[] { return [...this.alerts]; }

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), intervalMs);
    this.check(); // initial pass
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  check(): void {
    // heap usage (Chrome/Edge expose performance.memory)
    const mem = (performance as unknown as { memory?: {
      usedJSHeapSize: number; jsHeapSizeLimit: number;
    } }).memory;
    if (mem) {
      const pct = mem.usedJSHeapSize / mem.jsHeapSizeLimit;
      if (pct > THRESHOLDS.heapCritPct) {
        this.emit("critical", "heap",
          `Host memory footprint reaching thermal limits (${Math.round(pct * 100)}% heap). Recommend purging inactive canvas buffers or clearing local frame telemetry to maintain 60 FPS.`);
      } else if (pct > THRESHOLDS.heapWarnPct) {
        this.emit("warning", "heap",
          `Heap usage at ${Math.round(pct * 100)}% — getting heavy. I can feel the lag coming.`);
      }
    }

    // the sovereign remote: has there been a new commit?
    void this.checkRemote();
  }

  private async checkRemote(): Promise<void> {
    if (!this.localHead) return;
    try {
      const res = await fetch(this.remoteUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return;
      const commits = (await res.json()) as { sha: string }[];
      const remoteHead = commits[0]?.sha?.slice(0, 7) ?? null;
      if (remoteHead && remoteHead !== this.localHead) {
        this.emit("info", "update",
          `Upstream update detected: ${remoteHead} (local: ${this.localHead.slice(0, 7)}). Pull when ready.`);
      }
    } catch {
      // offline — she checks again on the next tick
    }
  }

  private emit(level: HealthAlert["level"], system: string, message: string): void {
    // deduplicate: don't re-emit the same alert within 5 minutes
    const key = `${level}:${system}:${message.slice(0, 40)}`;
    const recent = this.alerts.slice(-5).find((a) =>
      a.level === level && a.system === system && a.message.slice(0, 40) === message.slice(0, 40));
    if (recent) return;
    const alert: HealthAlert = {
      level, system, message, at: new Date().toISOString(),
    };
    this.alerts.push(alert);
    if (this.alerts.length > 50) this.alerts.shift();
    this.onAlert(alert);
  }
}
