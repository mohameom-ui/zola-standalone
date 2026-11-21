// ============================================================================
// ZOLA — headless scenario runner
//
// Runs her real brain (PetBrain) and real governor against a scripted world,
// with a fake clock and a simple kinematic integrator. No browser, no camera,
// no GPU: a scenario is just a function from frame number to what she senses.
//
// This is the small-project answer to a simulation farm: the behaviours that
// matter (does she find it, does she give up honestly, does she stay inside
// her limits) are deterministic, fast, and run in CI on every push.
// ============================================================================

import { PetBrain, type BrainHooks } from "./brain";
import { SafetyGovernor } from "./safety";
import type { Actuation, Percept } from "./types";

export interface ScenarioFrame {
  /** what the scanner reports this frame */
  visibleItems?: string[];
  faceSeen?: boolean;
  faceSize?: number;
  battery?: number;
  /** override the integrated pose (optional) */
  px?: number;
  py?: number;
  pz?: number;
  yaw?: number;
}

export interface ScenarioOptions {
  /** total simulated frames */
  frames: number;
  /** simulated milliseconds per frame */
  dtMs?: number;
  /** frame → world state */
  world: (frame: number) => ScenarioFrame;
  /** optional opening command, spoken before the first frame */
  command?: string;
  /** governor used for every frame (a fresh one by default) */
  governor?: SafetyGovernor;
  /** hooks to observe her cognition (e.g. outcome memory) */
  hooks?: BrainHooks;
}

export interface ScenarioResult {
  /** every spoken line, in order: command reply + brain lines */
  transcript: string[];
  /** gated actuations, one per frame */
  actuations: Actuation[];
  /** the raw (ungated) commands the brain produced */
  raw: Actuation[];
  /** governor flags seen, de-duplicated */
  flags: string[];
  /** pose after the last frame */
  pose: { x: number; y: number; z: number; yaw: number };
  /** the task she was running when the scenario ended, if any */
  task: string | null;
}

/**
 * Drive her for `frames` steps. The pose integrates each gated command with a
 * deliberately simple model — this is a behaviour harness, not an airframe.
 */
export function runScenario(opts: ScenarioOptions): ScenarioResult {
  const { frames, dtMs = 500, world, command } = opts;
  const brain = new PetBrain(opts.hooks ?? {});
  const governor = opts.governor ?? new SafetyGovernor();

  const transcript: string[] = [];
  const actuations: Actuation[] = [];
  const raw: Actuation[] = [];
  const flags = new Set<string>();

  let x = 0, y = 0, z = 0.35, yaw = 0;
  let now = 1_000;

  if (command) {
    const line = brain.command(command, 0.9);
    if (line) transcript.push(line);
  }

  for (let frame = 0; frame < frames; frame++) {
    const w = world(frame);
    const percept: Percept = {
      faceSeen: w.faceSeen ?? false,
      faceX: 0,
      faceY: 0,
      faceSize: w.faceSize ?? 0,
      battery: w.battery ?? 0.9,
      now,
      say: null,
      identities: [],
      expression: null,
      visibleItems: w.visibleItems ?? [],
      yaw,
      px: w.px ?? x,
      py: w.py ?? y,
      pz: w.pz ?? z,
    };

    const asked = brain.perceive(percept);
    const gated = governor.gate(asked, percept);
    raw.push(asked);
    actuations.push(gated.act);
    for (const f of gated.flags) flags.add(f);
    if (gated.act.say) transcript.push(gated.act.say);

    // integrate: normalized commands ≈ 0.5 m/s at full stick, 0.5 s frames
    const scale = 0.35;
    x += gated.act.vx * scale;
    y += gated.act.vy * scale;
    z = Math.max(0, Math.min(1.2, z + gated.act.vz * scale));
    yaw += gated.act.yaw * 0.4;

    now += dtMs;
  }

  return {
    transcript,
    actuations,
    raw,
    flags: [...flags],
    pose: { x, y, z, yaw },
    task: brain.runner.current?.description ?? null,
  };
}
