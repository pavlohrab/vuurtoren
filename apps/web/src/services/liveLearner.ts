/**
 * The learner model and reading staircase, cached per language and invalidated by a version
 * counter: every change that makes derived data stale calls `changed()`, which also makes
 * cached reading plans stale (they record the version they were computed with).
 */
import {
  DEFAULT_PLANNER,
  type LearnerModel,
  type StaircaseState,
  estimateVocabulary,
  profileMode,
  summarizeModel,
} from "@app/core";
import type { KenningRepository } from "@app/db";
import type { LearnerSummary } from "./types.js";

export const DEFAULT_STAIRCASE: StaircaseState = {
  targetCoverage: DEFAULT_PLANNER.targetCoverage,
  newWordBudget: DEFAULT_PLANNER.newWordBudget,
};

interface Cached<T> {
  version: number;
  lang: string;
  value: Promise<T>;
}

export function createLearnerCache(repo: KenningRepository, lang: () => Promise<string>) {
  // Bumped whenever the learner model changes, so cached plans are recomputed.
  let version = 0;
  let modelCache: Cached<LearnerModel> | null = null;
  let staircaseCache: Cached<StaircaseState | null> | null = null;

  async function model(): Promise<LearnerModel> {
    const l = await lang();
    if (!modelCache || modelCache.version !== version || modelCache.lang !== l) {
      // The promise is cached, so concurrent callers share one read.
      const entry = { version, lang: l, value: repo.learnerModel(l) };
      modelCache = entry;
      entry.value.catch(() => {
        if (modelCache === entry) modelCache = null;
      });
    }
    return modelCache.value;
  }

  /** The staircase changes only with `finishSegment` (which calls `changed`) or remotely. */
  function staircase(l: string): Promise<StaircaseState | null> {
    if (!staircaseCache || staircaseCache.version !== version || staircaseCache.lang !== l) {
      const entry = { version, lang: l, value: repo.staircase(l) };
      staircaseCache = entry;
      entry.value.catch(() => {
        if (staircaseCache === entry) staircaseCache = null;
      });
    }
    return staircaseCache.value;
  }

  async function summary(): Promise<LearnerSummary> {
    const l = await lang();
    const m = await model();
    const counts = summarizeModel(m);
    const snap = await repo.lastSnapshot(l);
    const native = profileMode(await repo.languageProfile(l)) === "native";
    return {
      ...(native ? { native } : {}),
      known: counts.known,
      learning: counts.learning,
      // "Seen" words have been met in a text, so they are not part of "not yet met".
      unknown: counts.unknown,
      vocabEstimate: estimateVocabulary(m),
      lastSync: snap?.at ?? null,
      sources: snap?.sources ?? [],
    };
  }

  return {
    model,
    staircase,
    summary,
    /** The current version; a plan computed with an older one is stale. */
    version: () => version,
    /** The learner model changed: cached models, staircases and plans are stale. */
    changed: () => {
      version++;
    },
    /** Re-read the model next time but keep plans (lookups, cloze answers: the page stays). */
    refreshModel: () => {
      modelCache = null;
    },
    /** Another device changed the data: drop everything cached. */
    invalidate: () => {
      modelCache = null;
      staircaseCache = null;
      version++;
    },
  };
}

export type LearnerCache = ReturnType<typeof createLearnerCache>;
