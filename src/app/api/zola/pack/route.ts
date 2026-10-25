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
  if (!FORGE_HOME) {
    return NextResponse.json(
      { ok: false, reason: "ZOLA_FORGE_HOME is not set — the forge location must be configured" },
      { status: 500 },
    );
  }
  try {
    const forgeHome: string = FORGE_HOME;
    const file = path.join(forgeHome, "capabilities.json");
    const raw = await readFile(file, "utf-8");
    const pack = JSON.parse(raw) as { version?: string };
    return NextResponse.json(pack, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, reason: "the forge's capability manifest is not reachable" },
      { status: 404 },
    );
  }
}
