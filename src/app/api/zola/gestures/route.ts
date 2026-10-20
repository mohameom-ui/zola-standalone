import { readdirSync } from "fs";
import path from "path";

// ZOLA GESTURES — lists her retargeted gesture GLBs (public/assets/models/zola-anims).
// Local filesystem only — nothing remote.
export async function GET() {
  const dir = path.join(process.cwd(), "public", "assets", "models", "zola-anims");
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".glb"))
      .map((f) => f.replace(/\.glb$/, ""));
    // v2 rigged-body clips (the generated humanoid, retargeted)
    let v2: string[] = [];
    try {
      v2 = readdirSync(path.join(dir, "v2"))
        .filter((f) => f.endsWith(".glb"))
        .map((f) => "v2/" + f.replace(/\.glb$/, ""));
    } catch {
      // no v2 dir yet
    }
    const all = [...files, ...v2].sort();
    return Response.json({ gestures: all });
  } catch {
    return Response.json({ gestures: [] });
  }
}
