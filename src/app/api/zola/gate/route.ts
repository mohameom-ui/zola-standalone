import { NextResponse } from "next/server";

// ZOLA GATE TELEMETRY — the district-gate sampler posts its real client-side
// metrics here; the operator reads them via GET. This closes the "I can't
// read your DevTools console" gap ARCHITECTURALLY: the app delivers its own
// telemetry to its own server. Real numbers from the real render pass.

interface GateSample {
  fps: number;
  drawCalls: number;
  triangles: number;
  at: string;
  userAgent?: string;
}

const samples: GateSample[] = [];
const MAX = 50;

export async function POST(req: Request) {
  try {
    const d = (await req.json()) as Partial<GateSample>;
    if (typeof d.fps !== "number" || typeof d.drawCalls !== "number" || typeof d.triangles !== "number") {
      return NextResponse.json({ error: "fps, drawCalls, triangles required" }, { status: 400 });
    }
    samples.push({
      fps: d.fps,
      drawCalls: d.drawCalls,
      triangles: d.triangles,
      at: new Date().toISOString(),
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    if (samples.length > MAX) samples.shift();
    return NextResponse.json({ ok: true, count: samples.length });
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ samples: samples.slice(-10), total: samples.length });
}
