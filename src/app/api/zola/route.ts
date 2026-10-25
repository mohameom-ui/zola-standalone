// ============================================================================
// ZOLA COMPANION API — live state relay for remote viewing (phone/other room)
// The panel POSTs compact state; the /zola page GETs it. Text only —
// no camera pixels ever transit this API (privacy contract holds).
//
// PAIRED ACCESS — every request must carry the pair token (x-zola-pair
// header). Unpaired devices get 401; the token is disclosed only to the
// desktop operator via /api/zola/pair. POST REPLACES the whole state —
// a partial payload can no longer keep stale fields alive under a fresh
// timestamp.
// ============================================================================

import { NextResponse } from "next/server";
import { getPairToken, isPaired } from "../../../lib/pet/pairing";

interface ZolaState {
  at: number;
  mood: string;
  persona: string;
  activity: string;
  battery: number | null;
  alt: number;
  task: string | null;
  bond: number;
  trust: number;
  owner: string | null;
  items: number;
  lastSay: string;
  log: { who: string; text: string }[];
}

let state: ZolaState | null = null;
let pendingCmd: string | null = null;

async function guard(req: Request): Promise<NextResponse | null> {
  if (!(await isPaired(req))) {
    return NextResponse.json({ ok: false, reason: "unpaired" }, { status: 401 });
  }
  return null;
}

export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Partial<ZolaState> & { cmd?: string };
    if (typeof body.cmd === "string" && body.cmd.trim()) {
      pendingCmd = body.cmd.trim().slice(0, 120); // remote command — executed by her panel
      return NextResponse.json({ ok: true, queued: pendingCmd });
    }
    // a state post must carry the full snapshot — no stale-field blending
    if (
      typeof body.mood !== "string" || typeof body.persona !== "string" ||
      typeof body.activity !== "string" ||
      !(body.battery === null || (typeof body.battery === "number" && Number.isFinite(body.battery) && body.battery >= 0 && body.battery <= 1)) ||
      typeof body.alt !== "number" || !Number.isFinite(body.alt)
    ) {
      return NextResponse.json({ ok: false, reason: "state posts must be complete snapshots" }, { status: 400 });
    }
    state = {
      at: Date.now(),
      mood: body.mood,
      persona: body.persona,
      activity: body.activity,
      battery: body.battery,
      alt: body.alt,
      task: body.task ?? null,
      bond: typeof body.bond === "number" ? body.bond : 0,
      trust: typeof body.trust === "number" ? body.trust : 0,
      owner: body.owner ?? null,
      items: typeof body.items === "number" ? body.items : 0,
      lastSay: body.lastSay ?? "",
      log: Array.isArray(body.log) ? body.log : [],
    };
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  if (!state || Date.now() - state.at > 15000) {
    return NextResponse.json({ ok: false, reason: state ? "stale" : "offline", pendingCmd: pendingCmd }, { status: 200 });
  }
  const cmd = pendingCmd;
  pendingCmd = null; // consumed by her brain
  return NextResponse.json({ ok: true, state, pendingCmd: cmd });
}
