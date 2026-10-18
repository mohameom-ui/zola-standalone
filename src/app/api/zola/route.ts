// ============================================================================
// ZOLA COMPANION API — live state relay for remote viewing (phone/other room)
// The panel POSTs compact state; the /zola page GETs it. Text only —
// no camera pixels ever transit this API (privacy contract holds).
// ============================================================================

import { NextResponse } from "next/server";

interface ZolaState {
  at: number;
  mood: string;
  persona: string;
  activity: string;
  battery: number;
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<ZolaState> & { cmd?: string };
    if (typeof body.cmd === "string" && body.cmd.trim()) {
      pendingCmd = body.cmd.trim().slice(0, 120); // remote command — executed by her panel
      return NextResponse.json({ ok: true, queued: pendingCmd });
    }
    state = { ...(state ?? ({} as ZolaState)), ...body, at: Date.now() } as ZolaState;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

export async function GET() {
  if (!state || Date.now() - state.at > 15000) {
    return NextResponse.json({ ok: false, reason: state ? "stale" : "offline", pendingCmd: pendingCmd }, { status: 200 });
  }
  const cmd = pendingCmd;
  pendingCmd = null; // consumed by her brain
  return NextResponse.json({ ok: true, state, pendingCmd: cmd });
}
