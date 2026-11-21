// ============================================================================
// ZOLA — semantic recall (embeddings) + hybrid fusion
//
// Lexical BM25 finds words. Embeddings find meaning: "spectacles" reaches the
// "glasses" memory even though no token matches. Neither is enough alone —
// BM25 is precise and cheap, embeddings are fuzzy and slower — so the two
// ranked lists are fused.
//
// The embedder is injected. Tests use fixed vectors (deterministic, no
// downloads); the browser uses a local MiniLM through embedder.ts. When the
// embedder is absent, callers simply keep the lexical results.
// ============================================================================

import type { RecallDoc, RecallHit } from "./recall";

/** Cosine similarity of two equal-length vectors. Returns 0 if unusable. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface EmbeddedDoc {
  doc: RecallDoc;
  vector: number[];
}

export class SemanticIndex {
  constructor(
    private readonly docs: EmbeddedDoc[],
    /** below this cosine a memory is noise, not relevance */
    private readonly minScore = 0.25,
  ) {}

  get size(): number {
    return this.docs.length;
  }

  search(query: number[], k = 8): RecallHit[] {
    if (k <= 0 || query.length === 0) return [];
    const hits: RecallHit[] = [];
    for (const d of this.docs) {
      if (d.vector.length !== query.length) continue;
      const score = cosine(query, d.vector);
      if (score >= this.minScore) hits.push({ doc: d.doc, score });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

/** Min-max normalise a ranked list to 0..1 (a single item scores 1). */
function normalise(hits: RecallHit[]): Map<string, number> {
  if (hits.length === 0) return new Map();
  const scores = hits.map((h) => h.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min;
  return new Map(hits.map((h) => [h.doc.id, span > 0 ? (h.score - min) / span : 1]));
}

/**
 * Fuse lexical and semantic rankings. `alpha` weights meaning over words;
 * 0.55 is deliberately semantic-leaning because the lexical list is already
 * the fallback when embeddings are unavailable.
 */
export function fuseRecall(
  lexical: RecallHit[],
  semantic: RecallHit[],
  k = 8,
  alpha = 0.55,
): RecallHit[] {
  const lex = normalise(lexical);
  const sem = normalise(semantic);
  const docs = new Map<string, RecallDoc>();
  for (const hit of lexical) docs.set(hit.doc.id, hit.doc);
  for (const hit of semantic) docs.set(hit.doc.id, hit.doc);

  const ids = new Set([...lex.keys(), ...sem.keys()]);
  const fused: RecallHit[] = [];
  for (const id of ids) {
    const doc = docs.get(id);
    if (!doc) continue;
    fused.push({ doc, score: alpha * (sem.get(id) ?? 0) + (1 - alpha) * (lex.get(id) ?? 0) });
  }
  return fused.sort((a, b) => b.score - a.score).slice(0, k);
}
