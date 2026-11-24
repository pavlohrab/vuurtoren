/**
 * Real services: local database (@app/db), planner (@app/core), NLP service (@app/nlp-client)
 * and AnkiConnect (@app/anki). The UI only sees the AppServices interface.
 *
 * This is the composition root: each domain lives in its own module and gets what it needs
 * from here (settings and clients, the learner-model cache, the dictionary, texts).
 */
import type { VuurtorenRepository } from "@app/db";
import { createPracticeData } from "@app/nlp-client";
import { createLiveAI } from "./liveAI.js";
import { createLiveCourses } from "./liveCourses.js";
import { composeGlosses, createLiveDictionary } from "./liveDictionary.js";
import { createLiveExam } from "./liveExam.js";
import { createLiveExtras } from "./liveExtras.js";
import { createLiveGrammar } from "./liveGrammar.js";
import { createLiveLibrary } from "./liveLibrary.js";
import { createLiveNative } from "./liveNative.js";
import { createLivePairs } from "./livePairs.js";
import { workerOptimizer } from "../native/optimizer.js";
import { browserSqlite } from "../native/openSqlite.js";
import { createLearnerCache } from "./liveLearner.js";
import { createLivePractice } from "./livePractice.js";
import { createLiveStories } from "./liveStories.js";
import { createLiveProfile } from "./liveProfile.js";
import { createLiveSettings } from "./liveSettings.js";
import { chunkText, createLiveTexts } from "./liveTexts.js";
import { assumedFamiliarKeys } from "./assumedFamiliar.js";
import { loadStarterWords } from "./starterWords.js";
import { createLiveWords } from "./liveWords.js";
import { type ThisServer, createLiveSync } from "./liveSync.js";
import { currentDevice } from "../platform/index.js";
import type { DeviceAudio } from "../desktop/bridge.js";
import { DEGRADED_MESSAGES, clearDegraded, reportDegraded } from "./degraded.js";
import { type Platform, browserPlatform } from "./platform.js";
import type { AppServices } from "./types.js";

export interface LiveServicesOptions {
  /** Network and device storage; the browser's by default. */
  platform?: Platform;
  /** The page comes from a Vuurtoren server, which can be its sync place. */
  server?: ThisServer | undefined;
}

/** The phone's recordings as clips: an mp3 Blob, or null when the pack has none. */
function localClipOf(audio: DeviceAudio | undefined) {
  if (!audio) return undefined;
  return async (voice: string, id: string): Promise<Blob | null> => {
    const bytes = await audio.clip(voice, id);
    return bytes && bytes.byteLength > 0 ? new Blob([bytes], { type: "audio/mpeg" }) : null;
  };
}

export function createLiveServices(
  repo: VuurtorenRepository,
  options: LiveServicesOptions = {},
): AppServices {
  const platform = options.platform ?? browserPlatform();
  // Resolved at call time: the learner cache needs the language from the settings.
  const changed = () => learner.changed();
  // Resolved at call time: sync is created below.
  const config = createLiveSettings({
    repo,
    platform,
    changed,
    languageServer: () => sync.languageServer(),
    localClip: localClipOf(currentDevice().bridge?.audio),
    noOwnLanguageServer:
      currentDevice().languageServer !== "bundled" && currentDevice().kind === "android",
  });
  const { settings, lang, nlp, anki } = config;
  const learner = createLearnerCache(repo, lang);
  const dictionary = createLiveDictionary({
    repo,
    lang,
    nlp,
    localGloss: currentDevice().bridge?.dictionary?.gloss,
  });
  // Resolved at call time: the texts are created next.
  const { autoCover, ...library } = createLiveLibrary({
    repo,
    forget: (textId) => texts.forget(textId),
  });
  // A text's English and in-context meanings, made where there is a language server and
  // synced with the text's analysis (liveExtras.ts).
  const extras = createLiveExtras({ repo, nlp, dictionary });
  // Native evidence is bound late: native mode is created after texts and practice.
  const evidence = () => native.evidence;
  const texts = createLiveTexts({
    repo,
    settings,
    nlp,
    learner,
    dictionary,
    autoCover,
    evidence,
    extras,
    // The stored profile, read as it is: planning never migrates or saves one.
    assumedFamiliar: () =>
      assumedFamiliarKeys({
        starterFrom: async () => (await repo.languageProfile(await lang()))?.starterFrom,
        starterWords: loadStarterWords,
        wordsByKeys: async (keys) => repo.wordsByKeys(await lang(), keys),
      }),
  });
  const model = learner.model;

  const stories = createLiveStories({ repo, model, lang });

  const grammar = createLiveGrammar({
    repo,
    nlp,
    view: texts.view,
    model,
    chunkText,
    translate: dictionary.translateSentences,
    storyGrammar: (t) => stories.storyGrammar(t, t.tokens ?? []),
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
    nlp,
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

  // One cached practice-data source for practice and courses.
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
    evidence,
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

  const pairs = createLivePairs({
    view: texts.view,
    nlp,
    aiReady: ai.aiReady,
    aiTranslate: ai.translateSentences,
    storyLines: (v) => stories.storyLines(v.text, v.tokens),
    storyPairs: (v) => stories.storyPairs(v.text, v.tokens),
    textPairs: (v) => extras.pairs(v.text),
  });

  const exam = createLiveExam({ repo, lang, changed });

  const native = createLiveNative({
    repo,
    lang,
    profile: profile.current,
    saveProfile: profile.services.saveLanguageProfile,
    anki: () => anki(),
    nlp,
    changed: () => {
      changed();
      texts.clearPlans();
    },
    optimizer: workerOptimizer,
    sqlite: browserSqlite,
    reviewWeek: async () => (await settings()).reviewWeek ?? [],
    newPerDay: async () => (await settings()).newWordsPerDay ?? 10,
    audioClip: (id) => config.services.audioClip(id),
  });

  /** Another device changed the data: drop everything derived from it. */
  const dropCaches = () => {
    config.invalidate();
    learner.invalidate();
    texts.clearPlans();
    dictionary.clearGlosses();
    profile.invalidate();
    native.invalidate();
    invalidatePractice();
  };

  const device = currentDevice();
  const sync = createLiveSync({
    repo,
    storage: platform.storage,
    fetch: platform.fetch,
    desktop: device.bridge?.sync,
    places: device.syncPlaces,
    bundledLanguageServer: device.languageServer === "bundled",
    phone: device.kind === "android",
    scanQr: device.scanQr,
    cancelScan: device.cancelScan,
    links: device.links,
    server: options.server,
    changed: dropCaches,
  });

  const services: AppServices = {
    ...profile.services,
    ...library,
    ...practice,
    ...ai,
    ...courses,
    ...exam,
    ...stories.services,
    ...native.services,
    textGrammar: grammar.textGrammar,
    sentencePairs: pairs.sentencePairs,
    grammarOverview: grammar.grammarOverview,
    grammarExamples: grammar.grammarExamples,
    ...texts.services,
    ...words.services,
    ...config.services,

    ...sync.services,
    async packSource() {
      const server = await sync.languageServer();
      return server ? { nlp: server.url, token: server.token } : null;
    },
    async autoSync(why) {
      // Sync when it is due (the caches drop on new changes, also when it failed after them).
      const r = await sync.auto(why);
      // Texts analysed here (or arrived) may still need their English: made in the background.
      extras.fillLater();
      if (r.error) reportDegraded("sync", DEGRADED_MESSAGES.sync, r.error);
      else if (r.ran || !sync.configured()) clearDegraded("sync");
      return r.changed;
    },
  };
  return services;
}
