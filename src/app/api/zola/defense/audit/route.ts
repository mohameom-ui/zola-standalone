// ZOLA DEFENSE AUDIT API — her defensive watch, read from its ledger.
// The watch (Scripts/defense-watch.mjs, :3004) sweeps DEFENSIVE facts
// only: Defender status, firewall profiles, listening ports, new
// processes, disk. No offensive capability lives here or anywhere in her
// — an audit answers "am I safe", never "attack someone". This route
// reads the watch's Saved/defense-watch-state.json ledger directly, so it
// answers even when the watch's server is down — and it reports the
// ledger's AGE honestly, because a stale audit is not an audit.
// Pair-authenticated like every Zola route.

import { NextResponse } from "next/server";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { isPaired } from "../../../../../lib/pet/pairing";

export const dynamic = "force-dynamic";

const STATE_PATH = path.resolve(process.cwd(), "Saved", "defense-watch-state.json");

interface Sweep { verdict?: string; [k: string]: unknown }
interface DefenseState { lastSweep?: Record<string, Sweep>; [k: string]: unknown }

export async function GET(request: Request) {
  if (!(await isPaired(request))) {
    return NextResponse.json({ ok: false, reason: "unpaired" }, { status: 401 });
  }
  try {
    const stat = statSync(STATE_PATH);
    const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as DefenseState;
    const sweep = state.lastSweep ?? {};
    const ageSeconds = Math.round((Date.now() - stat.mtimeMs) / 1000);
    const verdicts = Object.entries(sweep)
      .filter(([, v]) => v && typeof v === "object" && "verdict" in v)
      .map(([name, v]) => ({ check: name, verdict: String((v as Sweep).verdict) }));
    const attention = verdicts.filter((v) => v.verdict !== "OK");
    return NextResponse.json({
      ok: true,
      ledger: "Saved/defense-watch-state.json (written by Scripts/defense-watch.mjs)",
      ledgerAgeSeconds: ageSeconds,
      stale: ageSeconds > 30 * 60, // a 30-minute-old audit is labeled honestly
      liveServer: "http://localhost:3004/report (when the watch is serving)",
      summary: attention.length === 0
        ? "all checks OK"
        : `${attention.length} check(s) need attention`,
      checks: verdicts,
      scope: "defensive only — firewall, ports, processes, disk, Defender",
    });
  } catch {
    return NextResponse.json({
      ok: false,
      reason: "the defense ledger does not exist yet — run the watch once",
      repair: "node Scripts/defense-watch.mjs",
    }, { status: 404 });
  }
}
