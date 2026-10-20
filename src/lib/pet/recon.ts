// FALLBACK_RECON_SEARCH — v1 (Wikipedia recon, zero keys, nothing leaves
// except the query itself). When Zola's local confidence is low, she queries
// the live web, LEARNS the result into her memory ledger, and cites it after.
//
// Growth contract: every successful recon becomes a persisted fact — she is
// literally larger after every unknown than she was before it.

export interface ReconResult {
  term: string;
  title: string;
  extract: string;
  url: string;
  learned: boolean; // true when the fact was persisted to her memory
  factLine: string;
}

const RECON_CACHE_KEY = "zola_recon_cache_v1";

type ReconStore = Record<string, { title: string; extract: string; url: string; at: string }>;

function reconStore(): ReconStore {
  try {
    return JSON.parse(localStorage.getItem(RECON_CACHE_KEY) ?? "{}") as ReconStore;
  } catch {
    return {};
  }
}

function saveReconStore(s: ReconStore): void {
  try {
    localStorage.setItem(RECON_CACHE_KEY, JSON.stringify(s));
  } catch {
    // best-effort
  }
}

/** Has she already learned this term? (Repeat recon = no web round-trip.) */
export function knowsTerm(term: string): boolean {
  const norm = term.trim().toLowerCase();
  return !!reconStore()[norm];
}

/** Live web recon via the Wikipedia REST summary API (free, CORS-enabled). */
export async function webRecon(term: string): Promise<ReconResult | null> {
  const clean = term.trim();
  if (!clean) return null;
  const norm = clean.toLowerCase();

  // she remembers her own recon — repeat queries cost nothing
  const cached = reconStore()[norm];
  if (cached) {
    return { term: clean, ...cached, learned: false, factLine: `Already in my ledger: ${cached.title}.` };
  }

  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(clean)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const d = (await res.json()) as { title?: string; extract?: string; content_urls?: { page?: { href?: string } } };
    if (!d.extract) return null;
    const entry = {
      title: d.title ?? clean,
      extract: d.extract.slice(0, 400),
      url: d.content_urls?.page?.href ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(clean)}`,
      at: new Date().toISOString(),
    };
    const store = reconStore();
    store[norm] = entry;
    saveReconStore(store);
    return {
      term: clean,
      title: entry.title,
      extract: entry.extract,
      url: entry.url,
      learned: true,
      factLine: `${entry.title}: ${entry.extract}`,
    };
  } catch {
    return null; // offline — the Uncertainty-Gaze stays open, she says so
  }
}

/** The ledger-shaped fact the consumer (PetMemory) should persist. */
export function asMemoryFact(r: ReconResult): string {
  return `recon[${r.term}] ${r.extract}`;
}
