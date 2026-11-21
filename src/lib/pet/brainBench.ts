// ============================================================================
// ZOLA — brain benchmark
//
// "Is she smarter?" needs a number, not an impression. This runs a fixed set
// of utterances through any classifier (Ollama 8B, on-device 1.5B, the reflex
// brain) and reports action accuracy plus latency percentiles, using the same
// verb vocabulary her prompt uses.
//
// The classifier is injected: tests use a mock, the live test talks to Ollama.
// ============================================================================

import { LatencyMeter, type LatencyStats } from "./latency";
import { verbOf } from "./planning";

export interface BenchCase {
  text: string;
  /** expected verb, or null for conversation */
  expect: string | null;
  note?: string;
}

/** Keep in sync with ACTION_VERBS. Conversation cases are deliberate. */
export const BRAIN_CASES: BenchCase[] = [
  { text: "hello zola", expect: null },
  { text: "how are you feeling", expect: null },
  { text: "say something nice", expect: null },
  { text: "come here", expect: "come" },
  { text: "follow me", expect: "follow" },
  { text: "go to the kitchen", expect: "goto" },
  { text: "where are my glasses", expect: "find" },
  { text: "find my cup", expect: "find" },
  { text: "scan the room", expect: "scan" },
  { text: "patrol the house", expect: "patrol" },
  { text: "wave at me", expect: "gesture" },
  { text: "do a little dance", expect: "dance" },
  { text: "what is your battery", expect: "status" },
  { text: "run a full self check", expect: "diagnose" },
  { text: "consolidate your memories", expect: "dream" },
  { text: "write your vlog", expect: "vlog" },
  { text: "what is a calabi-yau manifold", expect: "recon", note: "unknown fact" },
  { text: "remember the dentist appointment", expect: "remember" },
  { text: "be more hyper", expect: "mode" },
  { text: "how is the sun", expect: "sun" },
  { text: "play some music", expect: "play" },
  { text: "remind me to drink water in ten minutes", expect: "remind" },
  { text: "add task: fix the render bug", expect: "task" },
  { text: "if nobody is here, patrol", expect: "patrol" },
  { text: "go to sleep", expect: "sleep" },
  { text: "wake up", expect: "wake" },
  { text: "stop", expect: "cancel" },
  { text: "tell me a story", expect: "story" },
];

export interface BenchFailure {
  text: string;
  expected: string;
  got: string;
}

export interface BenchReport {
  total: number;
  correct: number;
  accuracy: number;
  latency: LatencyStats;
  failures: BenchFailure[];
}

/**
 * Score a classifier. A null answer counts as conversation ("none"); an
 * exception counts as a wrong answer rather than aborting the run.
 */
export async function runBrainBench(
  classify: (text: string) => Promise<string | null>,
  cases: BenchCase[] = BRAIN_CASES,
): Promise<BenchReport> {
  const meter = new LatencyMeter(Math.max(1, cases.length));
  let correct = 0;
  const failures: BenchFailure[] = [];

  for (const c of cases) {
    const t0 = performance.now();
    let got: string | null = null;
    try {
      got = await classify(c.text);
    } catch {
      got = null;
    }
    meter.record(performance.now() - t0);

    const expected = c.expect ?? "none";
    const gotVerb = got ? (verbOf(got) ?? "invalid") : "none";
    if (gotVerb === expected) correct += 1;
    else failures.push({ text: c.text, expected, got: gotVerb });
  }

  return {
    total: cases.length,
    correct,
    accuracy: cases.length === 0 ? 0 : correct / cases.length,
    latency: meter.stats(),
    failures,
  };
}
