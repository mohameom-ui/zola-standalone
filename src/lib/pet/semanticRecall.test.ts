import { describe, expect, it } from "vitest";
import { cosine, fuseRecall, SemanticIndex } from "./semanticRecall";
import type { RecallHit } from "./recall";

const doc = (id: string, text: string) => ({ id, text });

describe("cosine", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 9);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 9);
  });

  it("refuses mismatched or empty vectors", () => {
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});

describe("SemanticIndex", () => {
  const docs = [
    { doc: doc("glasses", "my glasses are on the desk"), vector: [0.9, 0.1, 0.0] },
    { doc: doc("dentist", "dentist appointment tomorrow"), vector: [0.0, 0.9, 0.1] },
    { doc: doc("coffee", "coffee black no sugar"), vector: [0.1, 0.0, 0.9] },
  ];
  const index = new SemanticIndex(docs, 0.3);

  it("finds meaning without shared words", () => {
    const hits = index.search([0.88, 0.12, 0.02], 2);
    expect(hits[0].doc.id).toBe("glasses");
  });

  it("drops weak matches instead of padding the context", () => {
    expect(index.search([0.3, -0.9, 0.2], 5)).toEqual([]);
  });

  it("respects k and empty queries", () => {
    expect(index.search([1, 0, 0], 1)).toHaveLength(1);
    expect(index.search([], 3)).toEqual([]);
  });
});

describe("fuseRecall", () => {
  const lexical: RecallHit[] = [
    { doc: doc("a", "find the cup failure"), score: 4.2 },
    { doc: doc("b", "cupboard"), score: 1.1 },
  ];
  const semantic: RecallHit[] = [
    { doc: doc("c", "spectacles on desk"), score: 0.8 },
    { doc: doc("a", "find the cup failure"), score: 0.4 },
  ];

  it("merges both lists without duplicates", () => {
    const fused = fuseRecall(lexical, semantic, 10);
    const ids = fused.map((h) => h.doc.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lets meaning outrank words for a paraphrase", () => {
    const fused = fuseRecall(
      [{ doc: doc("lex", "unrelated exact word match"), score: 3 }],
      [{ doc: doc("sem", "spectacles on desk"), score: 0.9 }],
      2,
    );
    expect(fused[0].doc.id).toBe("sem");
  });

  it("keeps lexical when semantic is empty", () => {
    const fused = fuseRecall(lexical, [], 2);
    expect(fused.map((h) => h.doc.id)).toEqual(["a", "b"]);
  });

  it("caps at k", () => {
    expect(fuseRecall(lexical, semantic, 2)).toHaveLength(2);
  });
});
