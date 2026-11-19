/**
 * Training FSRS parameters on the learner's reviews with the FSRS optimizer (fsrs-rs compiled to
 * WebAssembly). Pure apart from the optimizer module it is given, so the same code runs in the
 * browser worker and in tests.
 */
import { type TrainingSequence, trainingReviewCount } from "@app/core";

/** The part of `@open-spaced-repetition/binding` used here. */
export interface FsrsOptimizerModule {
  FSRSBindingReview: new (rating: number, deltaT: number) => unknown;
  FSRSBindingItem: new (reviews: unknown[]) => unknown;
  FSRSBinding: new (params?: number[]) => {
    evaluate(items: unknown[]): { logLoss: number; rmseBins: number };
  };
  computeParameters(
    items: unknown[],
    options: {
      enableShortTerm: boolean;
      modelVersion?: "FSRS-6" | "FSRS-7";
      progress?: (current: number, total: number) => boolean | undefined | void;
    },
  ): Promise<number[]>;
}

/** Fewest reviews worth training on. */
export const MIN_TRAINING_REVIEWS = 50;

export interface OptimizeResult {
  /** The parameters to use: the trained ones, or the current ones when those fit better. */
  params: number[];
  /** Reviews trained on. */
  reviews: number;
  logLoss: number;
  rmse: number;
  previousLogLoss: number;
  previousRmse: number;
  /** False when the trained parameters fit no better than the current ones. */
  improved: boolean;
}

/** One training item per answer after the first: the answer with everything before it. */
function items(mod: FsrsOptimizerModule, seqs: readonly TrainingSequence[]): unknown[] {
  const out: unknown[] = [];
  for (const s of seqs) {
    const reviews = s.ratings.map((r, i) => new mod.FSRSBindingReview(r, s.deltaDays[i] ?? 0));
    for (let i = 2; i <= reviews.length; i++)
      out.push(new mod.FSRSBindingItem(reviews.slice(0, i)));
  }
  return out;
}

/**
 * Train FSRS-6 parameters and compare them with `current` on the same reviews (log loss and
 * RMSE, lower is better).
 * @throws when there are fewer than MIN_TRAINING_REVIEWS reviews
 */
export async function optimize(
  mod: FsrsOptimizerModule,
  seqs: readonly TrainingSequence[],
  current: readonly number[],
  onProgress?: (done: number, total: number) => void,
): Promise<OptimizeResult> {
  const reviews = trainingReviewCount(seqs);
  if (reviews < MIN_TRAINING_REVIEWS) {
    throw new Error(
      `Not enough reviews to tune yet: ${reviews} of ${MIN_TRAINING_REVIEWS} needed.`,
    );
  }
  const train = items(mod, seqs);
  const trained = await mod.computeParameters(train, {
    enableShortTerm: true,
    modelVersion: "FSRS-6",
    progress: (done, total) => {
      onProgress?.(done, total);
    },
  });
  const before = new mod.FSRSBinding([...current]).evaluate(train);
  const after = new mod.FSRSBinding([...trained]).evaluate(train);
  const improved = after.logLoss < before.logLoss;
  return {
    params: improved ? [...trained] : [...current],
    reviews,
    logLoss: improved ? after.logLoss : before.logLoss,
    rmse: improved ? after.rmseBins : before.rmseBins,
    previousLogLoss: before.logLoss,
    previousRmse: before.rmseBins,
    improved,
  };
}
