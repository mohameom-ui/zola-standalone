// ZOLA POLICIES TRAIN API — the trigger for a background training round.
// POST { task: "sit" } (or any trainer-console task key) proxies to the
// trainer console on :3002, which owns the Isaac process lifecycle (it
// kills any current run first — one GPU, one training at a time). This
// route deliberately does NOT spawn Isaac itself: two parents for one
// child process is how orphans happen. If the console is down, the honest
// answer is 503 with the restart command, not a half-working spawn.
// Pair-authenticated like every Zola route.

import { NextResponse } from "next/server";
import { isPaired } from "../../../../../lib/pet/pairing";

export const dynamic = "force-dynamic";

const CONSOLE = "http://localhost:3002";

// the same task keys the trainer console serves — the single source of
// truth for what a training round CAN be
const TASKS = new Set([
  "balance", "walk", "hands", "flight", "hover", "takeoff", "sit",
  "picture", "thumbs", "dance", "talk", "touchdown",
]);

export async function POST(request: Request) {
  if (!(await isPaired(request))) {
    return NextResponse.json({ ok: false, reason: "unpaired" }, { status: 401 });
  }

  let task = "sit";
  try {
    const body = (await request.json()) as { task?: string };
    if (body?.task) task = body.task;
  } catch { /* an empty body defaults to sit */ }

  if (!TASKS.has(task)) {
    return NextResponse.json(
      { ok: false, reason: `unknown task "${task}"`, validTasks: [...TASKS] },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${CONSOLE}/start?task=${encodeURIComponent(task)}`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    return NextResponse.json({
      ok: res.ok,
      task,
      console: "trainer-console :3002 owns the run (live progress on :3002, TensorBoard on :6006)",
      detail: text,
    }, { status: res.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({
      ok: false,
      reason: "the trainer console (:3002) is not running",
      repair: "node Scripts/trainer-console.mjs",
    }, { status: 503 });
  }
}
