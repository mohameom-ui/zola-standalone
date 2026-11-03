// ZOLA PHYSICS VERIFY API — the independent MuJoCo twin, on demand.
// POST runs Scripts/pose_physics_check.py: her URDF loaded into MuJoCo
// (the twin generated from the SAME canon profile as Isaac's URDF/USD),
// answering for every canon pose the real question — is it PHYSICALLY
// HOLDABLE by her actuator limits, or does she topple? This is the check
// that caught the knee-1.0 sit before training ever saw it.
// Pair-authenticated like every Zola route.

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import path from "node:path";
import { isPaired } from "../../../../../lib/pet/pairing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SCRIPT = path.resolve(process.cwd(), "Scripts", "pose_physics_check.py");

function pythonExe(): string {
  return process.platform === "win32" ? "python" : "python3";
}

export async function POST(request: Request) {
  if (!(await isPaired(request))) {
    return NextResponse.json({ ok: false, reason: "unpaired" }, { status: 401 });
  }

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(pythonExe(), [SCRIPT], { timeout: 110_000, maxBuffer: 4_000_000 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    // the script prints a human-readable table, then a JSON verdict map
    // as its last output — take the trailing balanced JSON object
    const start = stdout.lastIndexOf("{");
    const verdicts = JSON.parse(stdout.slice(start)) as Record<string, string>;
    const holds = Object.values(verdicts).filter((v) => v === "HOLDS").length;
    return NextResponse.json({
      ok: true,
      engine: "mujoco (system python — independent of the Isaac venv)",
      summary: `${holds}/${Object.keys(verdicts).length} canon poses hold by physics`,
      verdicts,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: err instanceof Error ? err.message.slice(0, 400) : "mujoco verify failed",
      repair: "pip install mujoco (the system python), then retry",
    }, { status: 500 });
  }
}
