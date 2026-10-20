import { readdirSync } from "fs";
import path from "path";

// ZOLA GESTURES — lists her retargeted gesture GLBs (public/assets/models/zola-anims).
// Local filesystem only — nothing remote.
export async function GET() {
  const dir = path.join(process.cwd(), "public", "assets", "models", "zola-anims");
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".glb"))
      .map((f) => f.replace(/\.glb$/, ""))
      .sort();
    return Response.json({ gestures: files });
  } catch {
    return Response.json({ gestures: [] });
  }
}
