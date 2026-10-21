import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The forge is sovereign and its GitHub remote is PRIVATE — anonymous raw
// fetches cannot see it. This route serves the forge's capability-pack
// manifest straight from the local forge home (Rule 3: the engine answers
// to no consumer repo, but a read-only manifest pull is a consumer duty).
// Override the location with ZOLA_FORGE_HOME when the forge moves.
const FORGE_HOME = process.env.ZOLA_FORGE_HOME ?? "C:\\Users\\self_\\zola-pipeline-home";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const file = path.join(FORGE_HOME, "capabilities.json");
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
