import { describe, expect, it } from "vitest";
import { buildLearnerModel, summarizeModel } from "./learner.js";

describe("buildLearnerModel", () => {
  it("merges cards per lemma and skips empty keys", () => {
    const model = buildLearnerModel([
      { key: "fiets", memory: { intervalDays: 3 } },
      { key: "fiets", memory: { intervalDays: 40 } },
      { key: "huis", memory: { intervalDays: 0, isNew: true } },
      { key: "", memory: { intervalDays: 100 } },
    ]);
    expect(model.get("fiets")?.state).toBe("known");
    expect(model.get("huis")?.state).toBe("unknown");
    expect(model.size).toBe(2);
    expect(summarizeModel(model)).toMatchObject({ known: 1, unknown: 1 });
  });
});
