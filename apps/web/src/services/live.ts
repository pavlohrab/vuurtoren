/**
 * Real services: local database (@app/db), planner (@app/core), NLP service (@app/nlp-client)
 * and AnkiConnect (@app/anki). The UI only sees the AppServices interface.
 *
 * This is the composition root: each domain lives in its own module and gets what it needs
 * from here (settings and clients, the learner-model cache, the dictionary, texts).
 */
import type { KenningRepository } from "@app/db";
import { createPracticeData } from "@app/nlp-client";
import { createLiveAI } from "./liveAI.js";
import { createLiveCourses } from "./liveCourses.js";
import { composeGlosses, createLiveDictionary } from "./liveDictionary.js";
import { createLiveExam } from "./liveExam.js";
import { createLiveGrammar } from "./liveGrammar.js";
import { createLearnerCache } from "./liveLearner.js";
import { createLivePractice } from "./livePractice.js";
import { createLiveProfile } from "./liveProfile.js";
import { createLiveSettings } from "./liveSettings.js";
import { chunkText, createLiveTexts } from "./liveTexts.js";
import { createLiveWords } from "./liveWords.js";
import { type Platform, browserPlatform } from "./platform.js";
import type { AppServices } from "./types.js";

export interface LiveServicesOptions {
  /**
   * Server mode (review A7): true when another device changed the shared data since the last
   * call (`HttpRepository.remoteChanged`). Absent in browser mode (one tab owns the data).
   */
  remoteChanged?: () => Promise<boolean>;
  /** Network and device storage (review A20); the browser's by default. */
  platform?: Platform;
}

export function createLiveServices(
  repo: KenningRepository,
  options: LiveServicesOptions = {},
): AppServices {
  const platform = options.platform ?? browserPlatform();
  // Resolved at call time: the learner cache needs the language from the settings.
  const changed = () => learner.changed();
  const config = createLiveSettings({ repo, platform, changed });
  const { settings, lang, nlp, anki } = config;
  const learner = createLearnerCache(repo, lang);
  const dictionary = createLiveDictionary({ repo, lang, nlp });
  const texts = createLiveTexts({ repo, settings, nlp, learner, dictionary });
  const model = learner.model;

  const grammar = createLiveGrammar({
    repo,
    nlp,
    view: texts.view,
    model,
    chunkText,
    translate: dictionary.translateSentences,
  });

  const profile = createLiveProfile({ repo, settings, anki, nlp, changed });

  const words = createLiveWords({
    repo,
    lang,
    anki,
    learner,
    dictionary,
    texts,
    profile: profile.current,
    ankiSnapshot: profile.snapshot,
    synced: () => {
      changed();
      texts.clearPlans();
      dictionary.clearGlosses();
    },
  });

  const ai = createLiveAI({
    repo,
    settings,
    profile: profile.current,
    model,
    vocabEstimate: async () => (await learner.summary()).vocabEstimate,
    anki: () => anki(),
    glossLemmas: async (lemmas) =>
      Object.fromEntries(
        (await dictionary.lookupGlosses(lemmas.map((l) => ({ key: l, lemma: l })))).found,
      ),
    changed,
    // Resolved at call time: the course services are created below.
    unitGrammar: (courseId, n) => courses.unitGrammar(courseId, n),
    saveText: texts.saveText,
    storage: platform.storage,
    fetch: platform.fetch,
  });

  // One cached practice-data source for practice and courses (review item A9).
  const practiceData = createPracticeData(nlp);

  const {
    buildWordData,
    invalidate: invalidatePractice,
    ...practice
  } = createLivePractice({
    repo,
    lang,
    model,
    dictionary: dictionary.dictionaryFor,
    composeGlosses,
    data: practiceData,
    topicMaterial: grammar.topicMaterial,
    aiSentences: { ready: ai.aiReady, fill: ai.fillSentences },
  });

  const courses = createLiveCourses({
    repo,
    settings,
    profile: profile.current,
    nlp,
    anki,
    model,
    wordData: async (l, entries) => (await buildWordData(l, entries)).words,
    importText: (input) => services.importText(input),
    deckOptions: async () => (await services.deckChoices("course")).options.map((o) => o.deck),
    changed,
    storage: platform.storage,
  });

  const exam = createLiveExam({ repo, lang, changed });

  const services: AppServices = {
    ...profile.services,
    ...practice,
    ...ai,
    ...courses,
    ...exam,
    textGrammar: grammar.textGrammar,
    grammarOverview: grammar.grammarOverview,
    grammarExamples: grammar.grammarExamples,
    ...texts.services,
    ...words.services,
    ...config.services,

    ...(options.remoteChanged
      ? {
          async checkRemoteChanges(): Promise<boolean> {
            if (!(await options.remoteChanged!())) return false;
            // Another device wrote: drop everything derived from the shared data.
            config.invalidate();
            learner.invalidate();
            texts.clearPlans();
            dictionary.clearGlosses();
            profile.invalidate();
            invalidatePractice();
            return true;
          },
        }
      : {}),
  };
  return services;
}
