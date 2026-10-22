import { describe, it } from "vitest";
import { PetBrain } from "./brain";

describe("bisect: which stroll phrasing breaks", () => {
  it("probes phrasings", () => {
    const brain = new PetBrain();
    for (const t of ["stroll", "a stroll", "take a stroll", "take stroll", "stroll around", "take a walk"]) {
      const b2 = new PetBrain();
      const line = b2.command(t, 0.86);
      console.log(JSON.stringify(t), "->", JSON.stringify(line?.slice(0, 60)), "| activity:", b2.getActivity());
    }
  });
});
