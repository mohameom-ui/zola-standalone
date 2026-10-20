// NEURAL_AURA_CACHE — v1 (manifest mode)
// Zola's local vector memory bank. v1: asset-manifest recognition +
// encounter-count roasting, persisted in her domain (localStorage).
// v2 (spec): real visual embeddings via the local transformers stack;
// low-confidence (< 0.65) gates the FALLBACK_RECON_SEARCH path.
//
// Provenance rule applies here too: every verdict is derived from real
// scan data (encounter counts, bytes) — never invented.

export interface AuraEntry {
  id: string;
  encounters: number;
  firstSeen: string;
  lastSeen: string;
  bytes?: number;
}

const KEY = "zola_aura_cache_v1";

type AuraStore = Record<string, AuraEntry>;

function load(): AuraStore {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as AuraStore;
  } catch {
    return {};
  }
}

function save(store: AuraStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // storage full/blocked — the cache is best-effort by design
  }
}

export interface ScanResult {
  id: string;
  known: boolean;
  encounters: number;
  verdict: string;
}

const FIRST_CONTACT = [
  "What in the Ohio is this polygon soup? First contact logged.",
  "Unindexed mesh detected. Adding you to the aura ledger, clanker.",
  "New target. Provenance unknown — I will remember this.",
];

const REPEAT_ROAST = [
  (id: string, n: number) => `Ah, ${id}. Encounter #${n}. Still ugly, still moving on.`,
  (id: string, n: number) => `${id}, again? Encounter #${n}. The aura ledger never forgets.`,
  (id: string, n: number) => `Target re-acquired: ${id}. Encounter #${n}. Consistency is a skill, I guess.`,
];

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

/** Scan an asset id: log the encounter, return the HUD verdict. */
export function scanAsset(id: string, meta?: { bytes?: number }): ScanResult {
  const store = load();
  const prev = store[id];
  const now = new Date().toISOString();
  const encounters = (prev?.encounters ?? 0) + 1;
  store[id] = {
    id,
    encounters,
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
    bytes: meta?.bytes ?? prev?.bytes,
  };
  save(store);

  const selfScan = id.startsWith("zola");
  if (encounters === 1 && !selfScan) {
    return { id, known: false, encounters, verdict: pick(FIRST_CONTACT, id.length) };
  }
  const roast = pick(REPEAT_ROAST, id.length + encounters);
  const kb = store[id].bytes ? ` ${(Math.round(store[id].bytes! / 102.4) / 10).toFixed(1)} KB of` : "";
  const verdict = selfScan
    ? `Target locked: ${id}. That's literally me. Encounter #${encounters}. Aura: immaculate.`
    : roast(id, encounters) + (kb ? ` (${kb} pure aura.)` : "");
  return { id, known: true, encounters, verdict };
}

/** Full ledger dump (for HUD panels / debugging). */
export function dumpAura(): AuraEntry[] {
  return Object.values(load()).sort((a, b) => b.encounters - a.encounters);
}

// ---- the world manifest: everything in Zola's domain, by asset id -------

export interface ManifestEntry {
  id: string;
  url: string;
}

export function worldManifest(): ManifestEntry[] {
  const district = [
    "lowrise-a", "lowrise-b", "lowrise-c", "lowrise-d",
    "midrise-a", "midrise-b", "midrise-c", "midrise-d",
    "midrise-e", "midrise-f", "midrise-g",
    "highrise-a", "highrise-b", "highrise-c",
    "skyscraper-a", "skyscraper-b", "skyscraper-c",
    "civic-dome-a", "civic-dome-b",
  ];
  const manifest: ManifestEntry[] = district.map((n) => ({
    id: `b2026-${n}`,
    url: `/assets/models/gen-b2026-${n}.glb`,
  }));
  manifest.push(
    { id: "zola-drone-body", url: "/assets/models/zola-drone-body.glb" },
    { id: "zola-body-v2", url: "/assets/models/zola-body-v2.glb" },
  );
  return manifest;
}

/**
 * WORLD SCAN — the Optic-Rizz Array audits every asset in her domain:
 * real HEAD requests, real byte counts, real ledger entries. Unknown
 * assets (never scanned) surface for the FALLBACK_RECON_SEARCH path.
 * Safe to run on every hangar load — the ledger dedupes.
 */
export async function scanWorldManifest(): Promise<{ scanned: ScanResult[]; fresh: number }> {
  const manifest = worldManifest();
  const before = dumpAura().filter((e) => e.encounters === 1).length;
  const scanned: ScanResult[] = [];
  const batch = 6;
  for (let i = 0; i < manifest.length; i += batch) {
    const slice = manifest.slice(i, i + batch);
    const results = await Promise.all(
      slice.map(async ({ id, url }) => {
        let bytes: number | undefined;
        try {
          const r = await fetch(url, { method: "HEAD" });
          const len = r.headers.get("content-length");
          if (len) bytes = parseInt(len, 10);
        } catch {
          // offline — scan without bytes
        }
        return scanAsset(id, { bytes });
      }),
    );
    scanned.push(...results);
  }
  const after = dumpAura().filter((e) => e.encounters === 1).length;
  return { scanned, fresh: after - before };
}
