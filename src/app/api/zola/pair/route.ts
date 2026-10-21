import { NextResponse } from "next/server";
import { networkInterfaces } from "node:os";
import { getPairToken, isLocalOperator } from "../../../../lib/pet/pairing";

// PAIR DISCLOSURE — hands the pair token to the DESKTOP OPERATOR only.
// A phone (or any other LAN device) reaches this server by IP, so its Host
// header is an IP — not localhost — and it gets a 404 instead of the key.
// The response includes a ready-made companion URL for the phone.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isLocalOperator(req)) {
    // don't reveal that this endpoint exists to non-local callers
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const token = await getPairToken();
  const port = process.env.PORT ?? "3001";
  // first private LAN address we can find, for the ready-made phone link
  let lanIp: string | null = null;
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === "IPv4" && !net.internal) { lanIp = net.address; break; }
    }
    if (lanIp) break;
  }
  const companionUrl = lanIp ? `http://${lanIp}:${port}/zola?pair=${token}` : null;
  return NextResponse.json({ ok: true, token, companionUrl }, { headers: { "Cache-Control": "no-store" } });
}
