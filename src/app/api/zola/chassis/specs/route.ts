// ZOLA CHASSIS SPECS API — her parametric 3D-print body, served from the
// print package's dimensions manifest (Saved/print/zola-v12/), the same
// artifact Scripts/print_export_v12.py generates and the Ender 3 Max Neo
// builds from. Every part carries its real millimeter dims; the route
// adds the fit verdict (300 mm bed envelope) computed, not asserted.
// Pair-authenticated like every Zola route.

import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isPaired } from "../../../../../lib/pet/pairing";

export const dynamic = "force-dynamic";

const DIMS_PATH = path.resolve(process.cwd(), "Saved", "print", "zola-v12", "dimensions.json");

interface Part { file?: string; tris?: number; dims_mm?: number[]; [k: string]: unknown }
interface Dimensions {
  source?: string;
  full_height_mm?: number;
  printer?: string;
  parts?: Record<string, Part>;
  [k: string]: unknown;
}

export async function GET(request: Request) {
  if (!(await isPaired(request))) {
    return NextResponse.json({ ok: false, reason: "unpaired" }, { status: 401 });
  }
  try {
    const dims = JSON.parse(readFileSync(DIMS_PATH, "utf8")) as Dimensions;
    const parts = Object.entries(dims.parts ?? {}).map(([name, p]) => {
      const d = p.dims_mm ?? [];
      const fitsBed = d.every((mm) => mm <= 300);
      return {
        name,
        file: p.file ?? null,
        triangles: p.tris ?? null,
        dims_mm: d,
        fits_ender3_max_neo: d.length ? fitsBed : null,
      };
    });
    const oversize = parts.filter((p) => p.fits_ender3_max_neo === false);
    return NextResponse.json({
      ok: true,
      source: dims.source ?? null,
      printer: dims.printer ?? "Ender 3 Max Neo (300x300x300)",
      full_height_mm: dims.full_height_mm ?? null,
      partCount: parts.length,
      allPartsFitBed: oversize.length === 0,
      oversizeParts: oversize.map((p) => p.name),
      parts,
      guides: {
        print: "Saved/print/zola-v12/PRINT_GUIDE.md",
        hardwareFit: "Saved/print/zola-v12/HARDWARE_FIT.md",
      },
    });
  } catch {
    return NextResponse.json({
      ok: false,
      reason: "the print manifest is missing — regenerate it",
      repair: "python Scripts/print_export_v12.py",
    }, { status: 404 });
  }
}
