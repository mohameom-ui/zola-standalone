import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The forge's capability-pack endpoint. The forge location must be configured
// via ZOLA_FORGE_HOME — there is no hardcoded fallback path any more. The
// check lives inside the handler so Next.js can build the route without the
// env var present; a request without it returns 500 instead of crashing build.
const FORGE_HOME = process.env.ZOLA_FORGE_HOME;

export const dynamic = "force-dynamic";

export async function GET() {
  // the forge manifest when configured; otherwise the LOCAL pipeline-home
  // pack — the old behavior 500'd on every panel load (the env was never set
  // in the browser session) and pushed the client to a stale GitHub fallback
  // that 404s. The local pack is the same-origin source of truth now.
  const forgeFile = FORGE_HOME
    ? path.join(FORGE_HOME, "capabilities.json")
    : path.join(process.cwd(), "zola-pipeline-home", "capabilities.json");
  try {
    const raw = await readFile(forgeFile, "utf-8");
    const pack = JSON.parse(raw) as { version?: string };
    return NextResponse.json(pack, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, reason: FORGE_HOME
        ? "the forge's capability manifest is not reachable"
        : "the local pipeline-home capability pack is not reachable" },
      { status: 404 },
    );
  }
}
