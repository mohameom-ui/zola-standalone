// ZOLA POLICIES API — her training shelf, served LIVE from disk.
// Every export run drops a manifest into isaac/policies/; this route reads
// the directory at request time, so new background training rounds appear
// here without a rebuild — her brain's 24/7 loop upgrades this live.
// Pair-authenticated like every Zola route (text only, no pixels).

import { NextResponse } from "next/server";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isPaired } from "../../../../lib/pet/pairing";

export const dynamic = "force-dynamic";

const POLICIES_DIR = path.resolve(process.cwd(), "isaac", "policies");

const TASK_NAMES: Record<string, string> = {
  zola_balance: "standing balance",
  zola_walk: "flat-ground walking",
  zola_hands: "arm and hand pose control",
  zola_flight: "flight-posture discipline",
  zola_hover: "coupled hover flight",
  zola_takeoff: "the takeoff transition",
  zola_touchdown: "THE HALO TOUCHDOWN",
  zola_sit: "sitting",
  zola_picture: "posing for a picture",
  zola_thumbs: "thumbs up (finger dexterity)",
  zola_dance: "the halobeat (dancing on the beat)",
  zola_talk: "talking body expression (the conversational routine)",
};

export async function GET(request: Request) {
  if (!(await isPaired(request))) {
    return NextResponse.json({ ok: false, reason: "unpaired" }, { status: 401 });
  }
  try {
    const manifests = readdirSync(POLICIES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try { return JSON.parse(readFileSync(path.join(POLICIES_DIR, f), "utf8")); }
        catch { return null; }
      })
      .filter(Boolean) as Record<string, unknown>[];

    // one entry per SKILL, best run by the manifest's smoothed-peak selection
    const byTask = new Map<string, { best: Record<string, unknown>; runs: number }>();
    for (const m of manifests) {
      const task = String(m.task);
      const score = Number((m.selection as { peak_smoothed?: number })?.peak_smoothed ?? 0);
      const cur = byTask.get(task);
      if (!cur) byTask.set(task, { best: m, runs: 1 });
      else {
        cur.runs += 1;
        if (score > Number((cur.best.selection as { peak_smoothed?: number })?.peak_smoothed ?? 0)) cur.best = m;
      }
    }
    const skills = [...byTask.entries()].map(([task, { best, runs }]) => ({
      skill: TASK_NAMES[task] ?? task,
      runs,
      checkpoint: String(best.checkpoint),
      iterations: Number(best.iteration) + 1,
      onnx_sha256: String(best.onnx_sha256).slice(0, 16),
      hardware_calibrated: Boolean(best.hardware_calibrated),
    }));
    return NextResponse.json({ ok: true, skills, at: Date.now() });
  } catch {
    return NextResponse.json({ ok: false, reason: "policies directory unreadable" }, { status: 500 });
  }
}
