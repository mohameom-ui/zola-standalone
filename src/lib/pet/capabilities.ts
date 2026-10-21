// CAPABILITIES.TS — the action layer (v3.5)
// The things a human assistant does: reminders with real time parsing, a
// task list, music control, web navigation. Every capability registers
// into the CORTEX — the brain routes, these execute.
//
// Pure logic: fully testable. The panel supplies the side effects
// (speak, play, open) via the effect ports.

import { Cortex, type Capability } from "./cortex";

// ---------- the time parser (natural language → Date) ----------

export interface ParsedTime {
  at: Date;
  label: string; // the human-readable rest
  kind: "relative" | "absolute" | "date";
}

/**
 * Parse natural-language time expressions:
 *   "in 10 minutes" / "in 2 hours" / "in 30 seconds"
 *   "at 3pm" / "at 15:00" / "at 9:30am"
 *   "tomorrow" / "tomorrow at 8am"
 *   "every 5 minutes" / "every hour"  → recurring (kind: "date" marker)
 */
export function parseTimeExpression(text: string, now = new Date()): ParsedTime | null {
  const t = text.toLowerCase().trim();

  // "in N unit(s)"
  const rel = /in (\d+)\s*(second|minute|hour|day|week)s?/.exec(t);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const ms: Record<string, number> = {
      second: 1000, minute: 60_000, hour: 3_600_000,
      day: 86_400_000, week: 604_800_000,
    };
    const at = new Date(now.getTime() + n * ms[unit]);
    return { at, label: `in ${n} ${unit}${n > 1 ? "s" : ""}`, kind: "relative" };
  }

  // "every N unit(s)" — recurring
  const every = /every (\d+)\s*(second|minute|hour)s?/.exec(t);
  if (every) {
    const n = parseInt(every[1], 10);
    const at = new Date(now.getTime() + n * (every[2] === "minute" ? 60_000 : 3_600_000));
    return { at, label: `every ${n} ${every[2]}${n > 1 ? "s" : ""}`, kind: "date" };
  }

  // "at H[:MM][am|pm]"
  const abs = /at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(t);
  if (abs) {
    let h = parseInt(abs[1], 10);
    const m = abs[2] ? parseInt(abs[2], 10) : 0;
    if (abs[3] === "pm" && h < 12) h += 12;
    if (abs[3] === "am" && h === 12) h = 0;
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1); // next occurrence
    return { at, label: `at ${h}:${m.toString().padStart(2, "0")}`, kind: "absolute" };
  }

  // "tomorrow [at H[:MM]]"
  if (/tomorrow/.test(t)) {
    const at = new Date(now);
    at.setDate(at.getDate() + 1);
    const tm = /at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(t);
    if (tm) {
      let h = parseInt(tm[1], 10);
      const m = tm[2] ? parseInt(tm[2], 10) : 0;
      if (tm[3] === "pm" && h < 12) h += 12;
      at.setHours(h, m, 0, 0);
    } else {
      at.setHours(9, 0, 0, 0); // default: 9am
    }
    return { at, label: "tomorrow", kind: "date" };
  }

  return null;
}

// ---------- the task list ----------

export interface Task {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  due?: string;
}

export class TaskList {
  private tasks: Task[] = [];
  private nextId = 1;

  add(text: string, due?: string): Task {
    const t: Task = {
      id: `task-${this.nextId++}`,
      text,
      done: false,
      createdAt: new Date().toISOString(),
      due,
    };
    this.tasks.push(t);
    return t;
  }

  complete(id: string): boolean {
    const t = this.tasks.find((x) => x.id === id || x.text === id);
    if (!t || t.done) return false;
    t.done = true;
    return true;
  }

  list(): Task[] {
    return this.tasks.filter((t) => !t.done);
  }

  get open(): number {
    return this.tasks.filter((t) => !t.done).length;
  }

  get all(): Task[] {
    return [...this.tasks];
  }
}

// ---------- the capability builders (pure — the panel wires the effects) ----------

export interface EffectPorts {
  speak: (text: string) => void;
  playMusic: (query?: string) => void;
  openWeb: (url: string) => void;
  searchWeb: (query: string) => void;
  now?: Date;
}

/** Build the reminder capability — the brain says "remind me to X in N minutes". */
export function buildReminderCapability(
  ports: EffectPorts,
  onSchedule: (text: string, at: Date, label: string) => void,
): Capability {
  return {
    id: "remind",
    kind: "system",
    label: "Set a reminder",
    description: "Remind the human of something at a time they specify.",
    run: () => {
      // the caller (applyDecision) extracts the reminder text + time from
      // the decision's argument — this run() is the fallback prompt
      return "What should I remind you about, and when?";
    },
  };
}

/**
 * Parse a reminder from natural language:
 *   "remind me to drink water in 10 minutes"
 *   "remind me to call mom at 3pm"
 * Returns the reminder text + the parsed time, or null.
 */
export function parseReminder(text: string, now = new Date()): { what: string; time: ParsedTime } | null {
  const m = /remind me (?:to |about |that )?(.{2,80}?)(?:\s+(in .+|at \d{1,2}(?::\d{2})?\s*(?:am|pm)?|tomorrow[^.]*))?\s*$/i.exec(text);
  if (!m) return null;
  const what = m[1]?.trim();
  if (!what) return null;
  const timeText = m[2] ?? "in 1 hour";
  const time = parseTimeExpression(timeText, now);
  if (!time) return null;
  return { what, time };
}

/**
 * Build the full capability set for the action layer.
 * The panel calls this with its effect ports; the CORTEX absorbs the result.
 */
export function buildActionCapabilities(ports: EffectPorts): Capability[] {
  const caps: Capability[] = [];

  // reminders
  caps.push({
    id: "remind",
    kind: "system",
    label: "Set a reminder",
    description: "Remind the human of something at a time they specify.",
    run: () => "What should I remind you about, and when?",
  });

  // tasks
  caps.push({
    id: "tasks",
    kind: "system",
    label: "Task list",
    description: "Add, complete, or list tasks.",
    run: () => "Task list ready. What are we tracking?",
  });

  // music
  caps.push({
    id: "music",
    kind: "system",
    label: "Play music",
    description: "Play music, ambient sounds, or a specific track.",
    run: () => {
      ports.playMusic();
      return "Playing.";
    },
  });

  // web navigation
  caps.push({
    id: "navigate",
    kind: "system",
    label: "Navigate the web",
    description: "Open a URL or search the web for something.",
    run: () => {
      ports.searchWeb("everything");
      return "Web navigation ready.";
    },
  });

  return caps;
}
