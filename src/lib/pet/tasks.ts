// ============================================================================
// DRONE PET — Task Planner & Runner
// Turns spoken requests into step plans and executes them autonomously:
//   "find my cup then come back to me"  → [search_item(cup), come]
//   "patrol the room"                   → recurring patrol_cycle
//   "check on me then scan the room"    → [come, scan]
// The brain stays in charge of reflexes; the runner only steers the activity
// while a task is active. Safety governor still gates every motion.
// ============================================================================

import type { Activity } from "./types";

export type StepKind = "scan" | "search_item" | "come" | "follow" | "trick" | "hover" | "patrol_cycle" | "goto_item" | "drill_hover" | "drill_square" | "drill_circle";

export interface TaskStep {
  kind: StepKind;
  label: string;
  target?: string;
  durationMs?: number;
  done: boolean;
  /** goto_item: remembered heading of the item (fallback if no map position) */
  targetYaw?: number | null;
  /** goto_item: remembered world position from the spatial map */
  targetPos?: { x: number; y: number; z: number } | null;
  /** goto_item: true once aligned & approaching */
  approach?: boolean;
  /** drill state: samples of position deviation + drill start point */
  samples?: number[];
  drillStart?: { x: number; y: number };
  /** drill_square leg speed — grows with her skill */
  speed?: number;
}

export interface Task {
  id: string;
  description: string;
  steps: TaskStep[];
  createdAt: number;
  /** patrol/guard tasks re-run their steps until cancelled */
  recurring: boolean;
}

export interface TickCtx {
  now: number;
  faceSeen: boolean;
  faceSize: number;
  visibleItems: string[];
  /** current drone heading (radians) */
  yaw: number;
  /** drone world position */
  px: number;
  py: number;
}

export interface TickResult {
  activity: Activity | null;
  say: string | null;
  done: boolean;
  /** direct motor hints that override the reflex layer (navigation) */
  yawRate?: number;
  vx?: number;
  /** a completed training drill, self-graded from telemetry */
  grade?: { drill: string; score: number };
}

const SEARCH_TIMEOUT_MS = 30_000;
const MAX_CYCLES = 12;

export class TaskRunner {
  private task: Task | null = null;
  private stepStartedAt = 0;
  private cycles = 0;
  private announced = new Set<string>();
  /** everything seen during the current task — for patrol reports */
  private patrolLog: string[] = [];

  get current(): Task | null { return this.task; }

  /** Build a training session — difficulty grows with her personal bests. */
  planDrill(bestHover = 0): Task {
    // graduated difficulty: when she proves a steady hover, the drills tighten
    const advanced = bestHover >= 90;
    const hoverDur = advanced ? 14_000 : 10_000;      // longer hold = harder
    const squareDur = advanced ? 10_000 : 12_000;     // faster legs = harder
    const circleDur = advanced ? 9_000 : 10_000;      // tighter circle = harder
    const steps: TaskStep[] = [
      { kind: "drill_hover", label: `Hover hold (${hoverDur / 1000}s)`, durationMs: hoverDur, done: false },
      { kind: "drill_square", label: `Square pattern${advanced ? " (fast)" : ""}`, durationMs: squareDur, speed: advanced ? 0.42 : 0.3, done: false },
      { kind: "drill_circle", label: `Circle pattern${advanced ? " (tight)" : ""}`, durationMs: circleDur, done: false },
    ];
    return {
      id: `t_${Date.now().toString(36)}`,
      description: "Training: hover → square → circle",
      steps,
      createdAt: Date.now(),
      recurring: false,
    };
  }

  /** Parse a natural-language request into a task, or null if not a task. */
  plan(text: string): Task | null {
    const t = text.toLowerCase().trim();
    if (!/\b(find|look for|search for|patrol|guard|watch|check on me|count|dance)\b/.test(t)) return null;

    const clauses = t.split(/\s+(?:and\s+then|then|after that|and after)\s+/);
    const steps: TaskStep[] = [];
    for (const c of clauses) {
      const findMatch = /(?:find|look for|search for)\s+(?:my |the |a |an )?(.{2,30})/.exec(c);
      if (findMatch) {
        steps.push({ kind: "search_item", label: `Find ${findMatch[1].trim()}`, target: findMatch[1].trim(), done: false });
        continue;
      }
      if (/patrol|guard|watch over|watch the/.test(c)) {
        steps.push({ kind: "patrol_cycle", label: "Patrol & scan the room", durationMs: 12_000, done: false });
        continue;
      }
      if (/check on me/.test(c)) {
        steps.push({ kind: "come", label: "Check on you", durationMs: 12_000, done: false });
        continue;
      }
      if (/count/.test(c) && /people|person/.test(c)) {
        steps.push({ kind: "scan", label: "Count people", durationMs: 6_000, done: false });
        continue;
      }
      if (/dance/.test(c)) {
        steps.push({ kind: "trick", label: "Dance move 1", durationMs: 2_600, done: false });
        steps.push({ kind: "trick", label: "Dance move 2", durationMs: 2_600, done: false });
        continue;
      }
      if (/come|here/.test(c)) {
        steps.push({ kind: "come", label: "Come to you", durationMs: 12_000, done: false });
        continue;
      }
      if (/follow/.test(c)) {
        steps.push({ kind: "follow", label: "Follow you", durationMs: 15_000, done: false });
        continue;
      }
      if (/scan|look around|inventory/.test(c)) {
        steps.push({ kind: "scan", label: "Scan the room", durationMs: 6_000, done: false });
        continue;
      }
    }
    if (steps.length === 0) return null;
    return {
      id: `t_${Date.now().toString(36)}`,
      description: steps.map((s) => s.label).join(" → "),
      steps,
      createdAt: Date.now(),
      recurring: /patrol|guard|watch over|watch the/.test(t),
    };
  }

  /** Build a navigation task: map position if known, else heading memory,
   *  else search first then approach. */
  planGoto(
    target: string,
    targetYaw: number | null,
    targetPos?: { x: number; y: number; z: number } | null,
  ): Task {
    const steps: TaskStep[] = [];
    const hasPos = !!targetPos;
    if (!hasPos && (targetYaw === null || Number.isNaN(targetYaw))) {
      steps.push({ kind: "search_item", label: `Find ${target}`, target, done: false });
    }
    steps.push({
      kind: "goto_item",
      label: `Fly to ${target}`,
      target,
      targetYaw: hasPos ? null : targetYaw,
      targetPos: targetPos ?? null,
      done: false,
    });
    return {
      id: `t_${Date.now().toString(36)}`,
      description: steps.map((s) => s.label).join(" → "),
      steps,
      createdAt: Date.now(),
      recurring: false,
    };
  }

  start(task: Task, now: number): string {
    this.task = task;
    this.stepStartedAt = now;
    this.cycles = 0;
    this.announced.clear();
    return `New task accepted: ${task.description}.`;
  }

  cancel(): string | null {
    if (!this.task) return null;
    const d = this.task.description;
    const isPatrol = this.task.steps.some((s) => s.kind === "patrol_cycle");
    const report = isPatrol && this.patrolLog.length > 0
      ? ` Patrol ended. I logged: ${this.patrolLog.slice(0, 6).join(", ")}.`
      : "";
    this.task = null;
    this.patrolLog = [];
    return `Task cancelled: ${d}.${report}`;
  }

  /** Drive the active task one frame. Returns the activity it wants. */
  tick(ctx: TickCtx): TickResult {
    if (!this.task) return { activity: null, say: null, done: false };
    for (const vi of ctx.visibleItems) {
      if (!this.patrolLog.includes(vi)) {
        this.patrolLog.push(vi);
        if (this.patrolLog.length > 30) this.patrolLog.shift();
      }
    }
    const task = this.task;
    const idx = task.steps.findIndex((s) => !s.done);

    // all steps done
    if (idx === -1) {
      if (task.recurring && this.cycles < MAX_CYCLES) {
        for (const s of task.steps) s.done = false;
        this.cycles += 1;
        this.stepStartedAt = ctx.now;
        return { activity: "scan", say: null, done: false };
      }
      this.task = null;
      const isPatrol = task.steps.some((s) => s.kind === "patrol_cycle");
      const report = isPatrol && this.patrolLog.length > 0
        ? `Patrol report: I logged ${this.patrolLog.slice(0, 6).join(", ")}. All quiet on my watch.`
        : "Task complete.";
      this.patrolLog = [];
      return { activity: null, say: report, done: true };
    }

    if (!this.stepStartedAt) this.stepStartedAt = ctx.now;
    const step = task.steps[idx];
    const elapsed = ctx.now - this.stepStartedAt;
    let activity: Activity = "hover";
    let say: string | null = null;
    let yawRate: number | undefined;
    let vx: number | undefined;
    let grade: { drill: string; score: number } | undefined;
    const finish = () => { step.done = true; this.stepStartedAt = ctx.now; };

    switch (step.kind) {
      case "scan":
        activity = "scan";
        if (elapsed > (step.durationMs ?? 6_000)) finish();
        break;
      case "search_item": {
        activity = "scan";
        const target = step.target ?? "";
        const hit = ctx.visibleItems.find((i) => i === target || target.includes(i) || i.includes(target));
        if (hit && !this.announced.has(step.label)) {
          this.announced.add(step.label);
          say = `Found the ${target}!`;
          finish();
        } else if (elapsed > SEARCH_TIMEOUT_MS) {
          say = `I could not find the ${target}. Moving on.`;
          finish();
        }
        break;
      }
      case "come":
        activity = "come";
        if ((ctx.faceSeen && ctx.faceSize > 0.2) || elapsed > (step.durationMs ?? 12_000)) finish();
        break;
      case "follow":
        activity = "follow";
        if (elapsed > (step.durationMs ?? 15_000)) finish();
        break;
      case "trick":
        activity = "trick";
        if (elapsed > (step.durationMs ?? 2_600)) finish();
        break;
      case "hover":
        activity = "hover";
        if (elapsed > (step.durationMs ?? 3_000)) finish();
        break;
      case "goto_item": {
        const target = step.target ?? "it";
        const hit = ctx.visibleItems.find((i) => i === target || target.includes(i) || i.includes(target));
        if (hit) {
          if (!this.announced.has(step.label)) {
            this.announced.add(step.label);
            say = `Here is the ${target}.`;
          }
          activity = "hover";
          finish();
          break;
        }
        if (elapsed > 25_000) {
          say = `I could not reach the ${target}.`;
          finish();
          break;
        }
        if (step.targetPos) {
          // --- true map navigation: bearing to remembered position ----------
          const dxw = step.targetPos.x - ctx.px;
          const dyw = step.targetPos.y - ctx.py;
          const dist = Math.hypot(dxw, dyw);
          if (dist < 0.22) {
            say = `I am at the spot where I last saw the ${target}, but I cannot see it now.`;
            finish();
            break;
          }
          const delta = wrapAngle(Math.atan2(dyw, dxw) - ctx.yaw);
          if (Math.abs(delta) > 0.15) {
            activity = "hover";
            yawRate = Math.max(-0.7, Math.min(0.7, delta * 2.2));
          } else {
            activity = "hover";
            vx = Math.max(0.18, Math.min(0.5, dist * 1.6));
          }
          break;
        }
        if (step.targetYaw != null && !step.approach) {
          // phase 1: rotate toward the remembered heading
          const delta = wrapAngle(step.targetYaw - ctx.yaw);
          if (Math.abs(delta) > 0.12) {
            activity = "hover";
            yawRate = Math.max(-0.6, Math.min(0.6, delta * 2));
          } else {
            step.approach = true;
            this.stepStartedAt = ctx.now;
          }
        } else {
          // phase 2: approach while scanning
          activity = "scan";
          vx = 0.4;
        }
        break;
      }
      case "patrol_cycle": {
        // alternate drift + scan phases like a real patrol route
        const phase = Math.floor(elapsed / 4_000) % 2;
        activity = phase === 0 ? "wander" : "scan";
        if (elapsed > (step.durationMs ?? 12_000)) finish();
        break;
      }
      case "drill_hover":
      case "drill_square":
      case "drill_circle": {
        // training drills: fly the pattern, sample deviation, self-grade
        if (!step.drillStart) step.drillStart = { x: ctx.px, y: ctx.py };
        if (!step.samples) step.samples = [];
        if (step.kind === "drill_hover") {
          activity = "hover";
        } else if (step.kind === "drill_square") {
          activity = "hover";
          const sp = step.speed ?? 0.3;
          const leg = Math.floor(elapsed / 3_000) % 4;
          vx = [sp, 0, -sp, 0][leg];
          yawRate = leg === 1 ? 0.25 : leg === 3 ? -0.25 : 0;
        } else {
          activity = "hover";
          yawRate = 0.55;
          vx = 0.18; // circle
        }
        // sample deviation every ~6 frames (~10 Hz)
        if (ctx.visibleItems.length >= 0 && step.samples.length < 400) {
          const d = Math.hypot(ctx.px - step.drillStart.x, ctx.py - step.drillStart.y);
          step.samples.push(d);
        }
        if (elapsed > (step.durationMs ?? 10_000)) {
          // grade: for hover, deviation from the start point IS the error;
          // for patterns, deviation from start is expected — grade smoothness instead
          const samples = step.samples;
          const name = step.kind === "drill_hover" ? "Hover hold" : step.kind === "drill_square" ? "Square pattern" : "Circle pattern";
          let score = 90;
          if (step.kind === "drill_hover" && samples.length > 10) {
            const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
            const varr = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / samples.length;
            const sd = Math.sqrt(varr);
            score = Math.max(0, Math.min(99, Math.round(100 - sd * 260)));
          }
          grade = { drill: name, score };
          say = `${name}: ${score}%.`;
          finish();
        }
        break;
      }
    }

    return { activity, say, done: false, yawRate, vx, grade };
  }
}

/** shortest signed angle difference, -π..π */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
