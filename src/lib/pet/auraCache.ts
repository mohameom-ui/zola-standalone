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

  if (encounters === 1) {
    return { id, known: false, encounters, verdict: pick(FIRST_CONTACT, id.length) };
  }
  const roast = pick(REPEAT_ROAST, id.length + encounters);
  const kb = store[id].bytes ? ` ${(Math.round(store[id].bytes! / 102.4) / 10).toFixed(1)} KB of` : "";
  const selfScan = id.startsWith("zola");
  const verdict = selfScan
    ? `Target locked: ${id}. That's literally me. Encounter #${encounters}. Aura: immaculate.`
    : roast(id, encounters) + (kb ? ` (${kb} pure aura.)` : "");
  return { id, known: true, encounters, verdict };
}

/** Full ledger dump (for HUD panels / debugging). */
export function dumpAura(): AuraEntry[] {
  return Object.values(load()).sort((a, b) => b.encounters - a.encounters);
}
