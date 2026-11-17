/**
 * The practice engine as the app sees it. The real implementation lives in
 * packages/core/src/practice/*.ts (re-exported by @app/core); until that is merged this adapter
 * serves the temporary `engineShim.ts`.
 *
 * To switch to the real engine, replace the export below with
 *
 *   export {
 *     buildSession, checkAnswer, createRng, distractors, generate,
 *     gradeAttempt, practiceStats, review,
 *   } from "@app/core";
 *
 * and delete `engineShim.ts`. Signatures are the ones documented in
 * packages/core/src/practice/types.ts ("Engine API").
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
} from "./engineShim.js";
