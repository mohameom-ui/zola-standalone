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
// SOVEREIGN DOMAIN ONLY (Rule 1): her world is her hangar — her bodies and
// her gesture clips. No district assets, no other repo's geometry. The old
// manifest audited Aetheria's 21 district buildings; that was cross-repo
// contamination from before the split and it 404'd 21 times per hangar load.

export interface ManifestEntry {
  id: string;
  url: string;
}

// her movement vocabulary — the single source of truth (the hangar card
// re-exports this for the CORTEX and the gesture stage)
export const GESTURE_REPERTOIRE: readonly string[] = [
  "bow_01", "bow_02", "curtsey_01", "dance_01", "dance_02", "march_01",
  "wave_01", "wave_02", "shrug_01", "spin_01", "stretch_01", "throw_01",
  "peekaboo_01", "pickup_01", "rollover_01", "crawl_01", "getup_01",
  "laydown_01", "mope_01",
];

export function worldManifest(): ManifestEntry[] {
  const manifest: ManifestEntry[] = [
    { id: "zola-body-v2", url: "/assets/models/zola-body-v2.glb" },
    { id: "zola-rigged-base", url: "/assets/models/zola-anims/v2/rigged_base.glb" },
  ];
  for (const g of GESTURE_REPERTOIRE) {
    manifest.push({
      id: `gesture:${g}`,
      url: `/assets/models/zola-anims/v2/v2_${g}.glb`,
    });
  }
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
