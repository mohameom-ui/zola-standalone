// PAIRING — the companion relay's door key.
//
// The dev server binds 0.0.0.0 so a phone on the same Wi-Fi can watch her.
// That also means ANY device on the network could previously read her state
// or queue commands. Now every relay request must carry the pair token
// (header: x-zola-pair). The token is minted once, persisted to a gitignored
// file, and disclosed ONLY to this machine (the route checks the Host header
// — a phone connecting by LAN IP has a different Host than localhost).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

const PAIR_FILE = path.join(process.cwd(), ".zola-pair");
let cached: string | null = null;

/** The stable pair token: env override → persisted file → freshly minted. */
export async function getPairToken(): Promise<string> {
  if (cached) return cached;
  const fromEnv = process.env.ZOLA_PAIR_TOKEN;
  if (fromEnv) { cached = fromEnv; return cached; }
  try {
    const fromFile = (await readFile(PAIR_FILE, "utf8")).trim();
    if (fromFile) { cached = fromFile; return cached; }
  } catch { /* first boot — mint below */ }
  const minted = randomBytes(16).toString("hex");
  try { await writeFile(PAIR_FILE, minted, { mode: 0o600 }); } catch { /* read-only fs — memory-only then */ }
  cached = minted;
  return cached;
}

/** True only when the request reached us over loopback (desktop operator). */
export function isLocalOperator(req: Request): boolean {
  const host = req.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)(:\d+)?$/i.test(host)) return false;
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite.toLowerCase() !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Verify an incoming relay request carries the pair token. */
export async function isPaired(req: Request): Promise<boolean> {
  const presented = req.headers.get("x-zola-pair") ?? "";
  const expected = await getPairToken();
  const presentedBytes = Buffer.from(presented, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return presentedBytes.length === expectedBytes.length && timingSafeEqual(presentedBytes, expectedBytes);
}
