// @vitest-environment node
/** The real optimizer (fsrs-rs as WebAssembly) on a synthetic review history. */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { DEFAULT_FSRS_PARAMS, type TrainingSequence } from "@app/core";
import { type FsrsOptimizerModule, optimize } from "./optimize.js";

const require = createRequire(import.meta.url);
const mod = require("@open-spaced-repetition/binding-wasm32-wasip1") as FsrsOptimizerModule;

/** A learner who forgets more than the defaults expect: 400 cards, 8 answers each. */
function history(): TrainingSequence[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  const out: TrainingSequence[] = [];
  for (let c = 0; c < 400; c++) {
    const ratings = [3];
    const deltaDays = [0];
    let ivl = 1;
    for (let i = 1; i < 8; i++) {
      const recalled = rnd() < Math.pow(0.8, ivl / 6);
      ratings.push(recalled ? 3 : 1);
      deltaDays.push(ivl);
      ivl = recalled ? Math.round(ivl * 2.5) : 1;
    }
    out.push({ ratings, deltaDays });
  }
  return out;
}

describe("FSRS optimizer", () => {
  it("trains 21 FSRS-6 parameters that fit the history better than the defaults", async () => {
    const r = await optimize(mod, history(), DEFAULT_FSRS_PARAMS);
    expect(r.reviews).toBe(2800);
    expect(r.params).toHaveLength(21);
    expect(r.improved).toBe(true);
    expect(r.logLoss).toBeLessThan(r.previousLogLoss);
    expect(r.rmse).toBeLessThan(r.previousRmse);
  });

  it("refuses to train on a handful of reviews", async () => {
    await expect(
      optimize(mod, [{ ratings: [3, 3], deltaDays: [0, 1] }], DEFAULT_FSRS_PARAMS),
    ).rejects.toThrow(/Not enough reviews/);
  });
});
