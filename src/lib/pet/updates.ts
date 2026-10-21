// OTA UPDATES — the capability-pack channel (v3.2)
// The forge (zola-pipeline-home on GitHub) ships capability packs as JSON.
// Zola checks for updates, downloads new capabilities, and installs them
// into her CORTEX registry — she GROWS over the air. No app redeploy.

import type { Capability } from "./cortex";

// the forge's capability-pack endpoint (GitHub raw — swap for a release
// channel when the ecosystem scales)
const PACK_URLS = [
  // local-first: the forge is sovereign and its remote is PRIVATE — the
  // pack is served from the local forge home via her own API route.
  "/api/zola/pack",
  // the remote channel activates when the forge repo goes public
  "https://raw.githubusercontent.com/mohameom-ui/zola-pipeline-home/master/capabilities.json",
];

interface CapabilityPack {
  version: string;
  at: string;
  capabilities: {
    id: string;
    kind: "system" | "mode";
    label: string;
    description: string;
  }[];
  notes?: string;
}

const VERSION_KEY = "zola_pack_version_v1";

function currentVersion(): string {
  try {
    return localStorage.getItem(VERSION_KEY) ?? "none";
  } catch {
    return "none";
  }
}

/**
 * Check the forge for a capability pack newer than the installed version.
 * Returns the pack (for the consumer to install into its CORTEX), or null.
 */
export async function checkForUpdates(): Promise<{
  version: string;
  capabilities: { id: string; kind: string; label: string; description: string }[];
  notes?: string;
} | null> {
  const installed = currentVersion();
  for (const url of PACK_URLS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const pack = (await res.json()) as CapabilityPack;
      if (!pack.capabilities?.length) continue;
      if (pack.version === installed) return null; // already current
      return pack;
    } catch {
      continue; // offline or repo missing — silent, she tries again later
    }
  }
  return null;
}

/**
 * Install a capability pack into the consumer's CORTEX.
 * Each capability's run() is provided by the CONSUMER (the pack ships the
 * spec, the consumer supplies the execution — the same split as the
 * extension manifest/generator pattern in Modly itself).
 */
export function installPack(
  pack: { version: string; capabilities: { id: string; kind: string; label: string; description: string }[] },
  register: (cap: { id: string; kind: string; label: string; description: string }) => void,
): number {
  let n = 0;
  for (const cap of pack.capabilities) {
    try {
      register(cap);
      n++;
    } catch {
      // skip broken entries — a bad capability never breaks the batch
    }
  }
  try {
    localStorage.setItem(VERSION_KEY, pack.version);
  } catch { /* best-effort */ }
  return n;
}
