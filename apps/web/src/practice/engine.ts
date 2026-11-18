/**
 * The practice engine as the app sees it: packages/core/src/practice/*.ts via @app/core.
 * Signatures are documented in packages/core/src/practice/types.ts ("Engine API").
 */
export {
  buildSession,
  checkAnswer,
  createRng,
  distractors,
  generate,
  gradeAttempt,
  practiceStats,
  review,
  shuffle,
} from "@app/core";
