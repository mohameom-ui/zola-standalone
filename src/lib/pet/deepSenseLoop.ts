// ============================================================================
// ZOLA — deep-sense loop (VLM cadence + overlap guard)
//
// Composes VisualLoop with a describer so a slow vision-language model can be
// driven from a frame loop without stacking inferences. The caller owns the
// camera and the speech; this owns "when" and "not twice at once".
//
// Deliberately not started automatically: background VLM inference costs real
// CPU/GPU, and enabling it is a product decision, not a default.
// ============================================================================

import { VisualLoop, type VisualLoopOptions } from "./visualLoop";

export interface DeepSenseDeps {
  /** Describe the current frame; null/empty means "nothing usable". */
  describe: () => Promise<string | null>;
  /** Receives every usable description. */
  onText: (text: string) => void;
  onError?: (err: unknown) => void;
}

export class DeepSenseLoop {
  readonly loop: VisualLoop;
  private inFlight = false;
  private lastText: string | null = null;

  constructor(private readonly deps: DeepSenseDeps, opts: VisualLoopOptions = {}) {
    this.loop = new VisualLoop(opts);
  }

  get busy(): boolean {
    return this.inFlight;
  }

  get lastDescription(): string | null {
    return this.lastText;
  }

  /**
   * Drive one frame. Cheap when nothing is due or an inference is already
   * running. Returns true only when a look was actually taken.
   */
  async tick(now: number): Promise<boolean> {
    if (this.inFlight || !this.loop.due(now)) return false;
    this.inFlight = true;
    this.loop.started(now);
    try {
      const text = await this.deps.describe();
      const clean = typeof text === "string" ? text.trim() : "";
      if (clean.length > 0) {
        this.lastText = clean;
        this.loop.succeeded(now, []);
        this.deps.onText(clean);
      } else {
        this.loop.failed(now);
      }
      return true;
    } catch (e) {
      this.loop.failed(now);
      this.deps.onError?.(e);
      return false;
    } finally {
      this.inFlight = false;
    }
  }
}
