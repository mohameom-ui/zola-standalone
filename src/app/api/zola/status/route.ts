// ZOLA STATUS API — the one honest system snapshot.
// Aggregates what is REAL right now: her version, the cognitive tier
// (Ollama), the four live services, the policy shelf count, and the
// pairing state. Nothing here is aspirational — a service that is down
// reads "down", not "ready". Pair-authenticated like every Zola route.

import { NextResponse } from "next/server";
import { readdirSync } from "node:fs";
import path from "node:path";
import { isPaired } from "../../../../lib/pet/pairing";

export const dynamic = "force-dynamic";

const POLICIES_DIR = path.resolve(process.cwd(), "isaac", "policies");

const SERVICES: { name: string; port: number; probe: string | null; self?: boolean }[] = [
  // the panel probes ITSELF — a request-handler fetch to its own dev server
  // deadlocks in Next dev, so the self entry is up by definition (this
  // response could not exist otherwise)
  { name: "panel", port: 3001, probe: null, self: true },
  { name: "trainer console", port: 3002, probe: "/status" },
  { name: "debug engine", port: 3003, probe: null },
  { name: "defense watch", port: 3004, probe: "/report" },
  { name: "tensorboard", port: 6006, probe: null },
];

async function probeService(port: number, probe: string | null): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}${probe ?? "/"}`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok || res.status < 500; // a served page answers; a dead port throws
  } catch {
    return false;
  }
}

async function probeOllama(): Promise<{ up: boolean; models: string[] }> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { up: false, models: [] };
    const body = (await res.json()) as { models?: { name: string }[] };
    return { up: true, models: (body.models ?? []).map((m) => m.name) };
  } catch {
    return { up: false, models: [] };
  }
}

export async function GET(request: Request) {
  if (!(await isPaired(request))) {
    return NextResponse.json({ ok: false, reason: "unpaired" }, { status: 401 });
  }
  const [ollama, ...serviceResults] = await Promise.all([
    probeOllama(),
    ...SERVICES.map((s) => (s.self ? Promise.resolve(true) : probeService(s.port, s.probe))),
  ]);

  let policyCount = 0;
  let skills = 0;
  try {
    const manifests = readdirSync(POLICIES_DIR).filter((f) => f.endsWith(".json"));
    policyCount = manifests.length;
    skills = new Set(manifests.map((f) => f.split("_model_")[0])).size;
  } catch { /* the shelf dir is missing — report zero honestly */ }

  return NextResponse.json({
    ok: true,
    version: process.env.npm_package_version ?? "unknown",
    timestamp: new Date().toISOString(),
    cognitiveTier: {
      engine: "ollama (local — her only external brain)",
      up: ollama.up,
      models: ollama.models,
    },
    services: SERVICES.map((s, i) => ({ name: s.name, port: s.port, up: serviceResults[i] })),
    shelf: { onnxArtifacts: policyCount, skills },
    pairing: "checked — this response only exists for a paired request",
  });
}
