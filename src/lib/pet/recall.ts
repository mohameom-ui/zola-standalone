// ============================================================================
// ZOLA — recall (BM25 over her own memory)
//
// Her memory has always been bigger than her context: facts, items, episode
// summaries and diary entries were stored, then the language model was shown
// only the last six facts. This ranks every stored line against what was just
// said and returns the relevant ones instead of the recent ones.
//
// BM25 on purpose: no embeddings, no model download, no GPU, deterministic in
// tests. A small model with the right six facts beats a large one with the
// wrong six — this is the cheap half of that sentence.
// ============================================================================

export interface RecallDoc {
  id: string;
  text: string;
  /** "fact" | "item" | "episode" | "diary" | "lesson" — used for tie-breaks */
  kind?: string;
  /** optional recency stamp (ms); used when the query is empty */
  at?: number;
}

export interface RecallHit {
  doc: RecallDoc;
  score: number;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this",
  "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "of",
  "to", "in", "on", "at", "for", "with", "about", "from", "by", "as", "it",
  "my", "your", "our", "their", "his", "her", "its", "me", "you", "we", "they",
  "i", "he", "she", "them", "us", "what", "where", "when", "who", "why", "how",
  "can", "could", "would", "should", "will", "have", "has", "had", "not", "no",
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and one-letter tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const K1 = 1.5;
const B = 0.75;

interface IndexedDoc {
  doc: RecallDoc;
  tf: Map<string, number>;
  length: number;
}

export class RecallIndex {
  private readonly docs: IndexedDoc[] = [];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(docs: RecallDoc[]) {
    let total = 0;
    for (const doc of docs) {
      const tokens = tokenize(doc.text);
      if (tokens.length === 0) continue;
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const term of tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
      this.docs.push({ doc, tf, length: tokens.length });
      total += tokens.length;
    }
    this.avgLength = this.docs.length > 0 ? total / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  /**
   * Top-k documents for a query. An empty query returns the most recent docs
   * (by `at`), which preserves the old "last N" behaviour.
   */
  search(query: string, k = 6): RecallHit[] {
    if (k <= 0) return [];
    const terms = tokenize(query);
    if (terms.length === 0) {
      return [...this.docs]
        .sort((a, b) => (b.doc.at ?? 0) - (a.doc.at ?? 0))
        .slice(0, k)
        .map((d) => ({ doc: d.doc, score: 0 }));
    }

    const n = this.docs.length || 1;
    const scored: RecallHit[] = [];
    for (const d of this.docs) {
      let score = 0;
      for (const term of new Set(terms)) {
        const tf = d.tf.get(term);
        if (!tf) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (d.length / (this.avgLength || 1))));
        score += idf * norm;
      }
      if (score > 0) scored.push({ doc: d.doc, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
