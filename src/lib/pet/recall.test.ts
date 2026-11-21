import { describe, expect, it } from "vitest";
import { RecallIndex, tokenize } from "./recall";

const docs = [
  { id: "1", text: "My glasses are usually on the desk next to the lamp", kind: "fact", at: 100 },
  { id: "2", text: "Dentist appointment tomorrow at 9am", kind: "fact", at: 200 },
  { id: "3", text: "The mug lives in the kitchen cupboard", kind: "item", at: 300 },
  { id: "4", text: "Task \"find my cup\" ended failed: I could not find the cup", kind: "lesson", at: 400 },
  { id: "5", text: "You like your coffee black, no sugar", kind: "fact", at: 500 },
];

describe("tokenize", () => {
  it("drops stopwords and punctuation", () => {
    expect(tokenize("Where are my glasses?")).toEqual(["glasses"]);
    expect(tokenize("the a an and")).toEqual([]);
  });
});

describe("RecallIndex", () => {
  const index = new RecallIndex(docs);

  it("ranks the relevant memory first", () => {
    const hits = index.search("where did I leave my glasses", 3);
    expect(hits[0].doc.id).toBe("1");
  });

  it("finds an appointment by its subject", () => {
    const hits = index.search("when is the dentist", 3);
    expect(hits[0].doc.id).toBe("2");
  });

  it("surfaces past failures when the same object comes up", () => {
    const hits = index.search("find the cup", 3);
    expect(hits[0].doc.id).toBe("4");
  });

  it("returns nothing when no term matches", () => {
    expect(index.search("quantum chromodynamics", 5)).toEqual([]);
  });

  it("falls back to recency for an empty query", () => {
    const hits = index.search("", 2);
    expect(hits.map((h) => h.doc.id)).toEqual(["5", "4"]);
  });

  it("respects k and ignores k <= 0", () => {
    // a stopword-only query tokenizes to nothing → recency fallback
    expect(index.search("the", 3)).toHaveLength(3);
    expect(index.search("", 2)).toHaveLength(2);
    expect(index.search("glasses", 0)).toEqual([]);
  });

  it("keeps working with an empty corpus", () => {
    const empty = new RecallIndex([]);
    expect(empty.size).toBe(0);
    expect(empty.search("anything", 3)).toEqual([]);
  });
});
