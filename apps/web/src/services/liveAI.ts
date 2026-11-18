/**
 * AI services on top of the local database: provider settings and key (per device, never in
 * the event log), conversations (events ConversationStarted / MessageAdded), reader helpers.
 * No request leaves the browser except to the provider the user configured (ADR 0005).
 */
import {
  AIError,
  type AIProvider,
  type ChatMessage,
  type ConversationSetup,
  type KeyValueStorage,
  type ProviderConfig,
  PRESETS,
  WrongPassphraseError,
  assistantHistoryMessage,
  clearKey,
  createProvider,
  examFeedback,
  explainSentence,
  generateExamItem,
  generateSentences,
  generateStory,
  generateUnitExercises,
  type UnitExerciseKind,
  keyStatus,
  listModels,
  loadKey,
  modelOptions,
  presetFor,
  runTurn,
  saveKey,
  selectKnownLemmas,
  simplifyText,
} from "@app/ai";
import { DEGRADED_MESSAGES, clearDegraded, reportDegraded } from "./degraded.js";
import { AnkiConnectClient, addWordToAnki, highlightSentence } from "@app/anki";
import { grammarTopic } from "@app/content";
import {
  DEFAULT_PLANNER,
  type AnalyzedToken,
  type LanguageProfile,
  type LearnerModel,
  migratedProfile,
  normalizeKey,
} from "@app/core";
import {
  type GeneratedSentence,
  type KenningRepository,
  type TextSource,
  projectConversations,
} from "@app/db";
import { NlpClient } from "@app/nlp-client";
import type {
  AIServices,
  AISettings,
  AIStatus,
  AIUsage,
  ConversationView,
  ModelChoices,
  NewWord,
  StoryView,
} from "./aiTypes.js";
import { toConversationView } from "./conversationView.js";
import type { ExamServices } from "./examTypes.js";
import type { GenerateUnitResult, UnitGrammarTopic } from "./courseTypes.js";
import type { Settings } from "./types.js";

export interface LiveAIDeps {
  repo: KenningRepository;
  settings: () => Promise<Settings>;
  /** The language profile (deck routing); defaults to the old target deck for everything. */
  profile?: () => Promise<LanguageProfile>;
  model: () => Promise<LearnerModel>;
  vocabEstimate: () => Promise<number>;
  anki: () => Promise<AnkiConnectClient>;
  /** Dictionary / Anki glosses for lemmas (found ones only). */
  glossLemmas: (lemmas: string[]) => Promise<Record<string, string>>;
  /** Called after the learner model changed (e.g. a note was added). */
  changed: () => void;
  /**
   * Save a generated story as a Library text (and analyse it); returns its id. Defaults to a
   * plain TextImported append.
   */
  saveText?: (t: { title: string; content: string; source: TextSource }) => Promise<string>;
  /** Grammar topics a course unit's texts show (course services). */
  unitGrammar?: (courseId: string, n: number) => Promise<UnitGrammarTopic[]>;
  /** Injectable for tests; defaults to localStorage (or memory when unavailable). */
  storage?: KeyValueStorage;
  fetch?: typeof fetch;
}

const CONFIG_KEY = "kenning.ai.config";
const USAGE_KEY = "kenning.ai.usage";
/** Earlier messages sent to the model (older ones are dropped to bound the cost). */
const HISTORY_LIMIT = 16;

/** Target words sent with a story request. */
const MAX_STORY_TARGETS = 10;
/** Sentences asked for per word / topic. */
const SENTENCES_PER_REQUEST = 5;

const STORY_STEP: Record<"writing" | "checking" | "rewriting", string> = {
  writing: "Writing the story…",
  checking: "Checking it against your words…",
  rewriting: "Rewriting a few hard words…",
};

/** One word or grammar topic that needs AI example sentences. */
export interface SentenceNeed {
  /** Practice key ("" for a grammar topic without a target word). */
  key: string;
  /** Lemma to ask for (omit for a grammar topic). */
  lemma?: string;
  /** Grammar topic page id. */
  topicId?: string;
  /** Sentences already available (duplicates are dropped). */
  existing: string[];
}

/** Result of `fillSentences`: accepted sentences per need, in input order. */
export interface SentenceFill {
  sentences: GeneratedSentence[][];
  accepted: number;
  rejected: number;
  requested: number;
  error?: string;
}

/** The key is encrypted and not unlocked yet. */
export class AILockedError extends Error {
  override readonly name = "AILockedError";
  constructor() {
    super("Enter your passphrase in Settings, AI to unlock the key.");
  }
}

function defaultStorage(): KeyValueStorage {
  try {
    const t = "kenning.ai.probe";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    // Expected in private windows / blocked storage: settings last for this session only.
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }
}

const DEFAULT_AI: AISettings = (() => {
  const p = presetFor("anthropic");
  return { provider: p.id, baseUrl: p.baseUrl, model: p.defaultModel, budgetNote: "" };
})();

const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

export function createLiveAI(deps: LiveAIDeps): AIServices &
  Pick<ExamServices, "generateExamItem" | "examFeedback"> & {
    /** Generate, validate and store AI example sentences (practice). */
    fillSentences: (lang: string, needs: SentenceNeed[], avoid: string[]) => Promise<SentenceFill>;
    aiReady: () => boolean;
  } {
  const { repo } = deps;
  const storage = deps.storage ?? defaultStorage();
  /** Decrypted keys of this session only. */
  const unlocked = new Map<string, string>();

  const readJson = <T>(key: string): T | undefined => {
    try {
      const raw = storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      // Unreadable or corrupt entry: fall back to the defaults (expected, nothing to report).
      return undefined;
    }
  };
  const getSettings = (): AISettings => ({
    ...DEFAULT_AI,
    ...readJson<Partial<AISettings>>(CONFIG_KEY),
  });

  const status = (): AIStatus => {
    const s = getSettings();
    const preset = presetFor(s.provider);
    const k = keyStatus(storage, s.provider);
    const locked = k.encrypted && !unlocked.has(s.provider);
    return {
      configured: (!preset.needsKey || (k.saved && !locked)) && !!s.model && !!s.baseUrl,
      locked,
      keySaved: k.saved,
      encrypted: k.encrypted,
      needsKey: preset.needsKey,
      label: preset.label,
    };
  };

  /** Count a call in this month's local tally. */
  const tally = (inTok: number, outTok: number) => {
    const month = monthOf();
    const u = readJson<AIUsage>(USAGE_KEY);
    const cur: AIUsage =
      u?.month === month ? u : { month, calls: 0, inputTokens: 0, outputTokens: 0 };
    cur.calls++;
    cur.inputTokens += inTok;
    cur.outputTokens += outTok;
    try {
      storage.setItem(USAGE_KEY, JSON.stringify(cur));
    } catch {
      /* tally is best effort */
    }
  };

  /** Model lists per provider and address, for this session (Settings → AI picker). */
  const modelCache = new Map<string, ModelChoices>();

  async function provider(): Promise<AIProvider> {
    const s = getSettings();
    const st = status();
    if (st.locked) throw new AILockedError();
    const apiKey = unlocked.get(s.provider) ?? (await loadKey(storage, s.provider));
    const config: ProviderConfig = {
      provider: s.provider,
      baseUrl: s.baseUrl,
      model: s.model,
      ...(apiKey ? { apiKey } : {}),
    };
    const inner = createProvider(config, deps.fetch);
    return {
      config,
      async chat(req) {
        const res = await inner.chat(req);
        if (res.usage) tally(res.usage.inputTokens, res.usage.outputTokens);
        else tally(0, 0);
        return res;
      },
    };
  }

  async function analyze(text: string): Promise<AnalyzedToken[]> {
    const client = new NlpClient({ url: (await deps.settings()).nlpUrl });
    return (await client.analyzeText("nl", [text]))[0]?.tokens ?? [];
  }

  async function detectGrammar(text: string) {
    const client = new NlpClient({ url: (await deps.settings()).nlpUrl });
    return (await client.grammar("nl", [text]))[0] ?? [];
  }

  const saveText =
    deps.saveText ??
    (async (t: { title: string; content: string; source: TextSource }) => {
      const textId = crypto.randomUUID();
      await repo.append({ type: "TextImported", textId, lang: (await deps.settings()).lang, ...t });
      return textId;
    });

  async function threshold(lang: string): Promise<number> {
    const stair = await repo.staircase(lang);
    return Math.max(0.9, (stair?.targetCoverage ?? DEFAULT_PLANNER.targetCoverage) - 0.03);
  }

  async function fillSentences(
    lang: string,
    needs: SentenceNeed[],
    avoid: string[],
  ): Promise<SentenceFill> {
    const out: SentenceFill = { sentences: [], accepted: 0, rejected: 0, requested: 0 };
    if (needs.length === 0) return out;
    let p: AIProvider;
    try {
      p = await provider();
    } catch (e) {
      return { ...out, sentences: needs.map(() => []), error: String((e as Error).message ?? e) };
    }
    const [model, vocab, words] = await Promise.all([
      deps.model(),
      deps.vocabEstimate(),
      repo.words(lang),
    ]);
    for (const need of needs) {
      if (out.error) {
        out.sentences.push([]);
        continue;
      }
      const topic = need.topicId ? grammarTopic(need.topicId) : undefined;
      try {
        out.requested++;
        const r = await generateSentences(
          {
            provider: p,
            analyze,
            model,
            detectGrammar,
            avoid,
            existing: need.existing,
          },
          {
            ...(need.lemma ? { lemma: need.lemma } : {}),
            ...(topic
              ? { grammar: { title: topic.title, summary: topic.summary, detects: topic.detects } }
              : {}),
            count: SENTENCES_PER_REQUEST,
            vocabEstimate: vocab,
            knownLemmas: selectKnownLemmas(words, need.lemma ?? topic?.title ?? "", 200),
          },
        );
        const sentences: GeneratedSentence[] = r.accepted.map((a) => ({ ...a }));
        out.accepted += sentences.length;
        out.rejected += r.rejected.length;
        out.sentences.push(sentences);
        clearDegraded("ai");
        await repo.append({
          type: "SentencesGenerated",
          lang,
          key: need.lemma ? normalizeKey(need.key) : "",
          ...(need.topicId ? { topic: need.topicId } : {}),
          sentences,
          rejected: r.rejected.length,
          provider: p.config.provider,
          model: p.config.model,
        });
      } catch (e) {
        // One provider failure (key, rate limit, network) stops the fill; practice goes on.
        out.error = e instanceof Error ? e.message : String(e);
        out.sentences.push([]);
        reportDegraded("ai", DEGRADED_MESSAGES.ai, e);
      }
    }
    return out;
  }

  async function loadConversation(id: string) {
    return projectConversations(await repo.conversationEvents()).find((c) => c.id === id);
  }

  async function view(id: string): Promise<ConversationView> {
    const c = await loadConversation(id);
    if (!c) throw new Error("Conversation not found");
    return toConversationView(c);
  }

  /** One turn: ask the model, record user + partner messages as events. */
  async function turn(id: string, userText: string): Promise<ConversationView> {
    const c = await loadConversation(id);
    if (!c) throw new Error("Conversation not found");
    const lang = c.lang;
    const [p, model, vocab, words, stair] = await Promise.all([
      provider(),
      deps.model(),
      deps.vocabEstimate(),
      repo.words(lang),
      repo.staircase(lang),
    ]);
    const setup: ConversationSetup = {
      topic: c.topic,
      vocabEstimate: vocab,
      knownLemmas: selectKnownLemmas(words, c.topic, 300),
      targetWords: c.targetWords,
    };
    const history: ChatMessage[] = c.messages.slice(-HISTORY_LIMIT).map((m) =>
      m.role === "user"
        ? { role: "user", content: m.text }
        : assistantHistoryMessage({
            reply: m.text,
            corrections: [],
            newWords: (m.meta?.["newWords"] as NewWord[] | undefined) ?? [],
          }),
    );
    const result = await runTurn(
      {
        provider: p,
        analyze,
        model,
        threshold: Math.max(0.9, (stair?.targetCoverage ?? DEFAULT_PLANNER.targetCoverage) - 0.03),
        glossFor: deps.glossLemmas,
      },
      setup,
      history,
      userText,
    );
    if (userText.trim()) {
      await repo.append({
        type: "MessageAdded",
        conversationId: id,
        messageId: crypto.randomUUID(),
        role: "user",
        text: userText.trim(),
      });
    }
    await repo.append({
      type: "MessageAdded",
      conversationId: id,
      messageId: crypto.randomUUID(),
      role: "assistant",
      text: result.turn.reply,
      meta: {
        coverage: result.coverage,
        rewritten: result.rewritten,
        unknown: result.unknown,
        glosses: result.glosses,
        corrections: result.turn.corrections,
        newWords: result.turn.newWords,
        parseFailed: result.parseFailed,
      },
    });
    return view(id);
  }

  /** Book exercise types -> the generated kinds that imitate them. */
  const KIND_FOR: Partial<Record<string, UnitExerciseKind>> = {
    gapfill: "gapfill",
    "conjugation-table": "gapfill",
    "sentence-building": "sentence-building",
    choice: "questions",
    matching: "matching",
  };

  async function makeUnitExercises(
    courseId: string,
    unitN: number,
    onProgress?: (msg: string) => void,
  ): Promise<GenerateUnitResult> {
    const course = (await repo.courses()).find((c) => c.id === courseId);
    const unit = course?.units.find((u) => u.n === unitN);
    if (!course || !unit) throw new Error("This unit no longer exists.");
    const [p, model, vocab, words, unitWords, own, earlier, thr] = await Promise.all([
      provider(),
      deps.model(),
      deps.vocabEstimate(),
      repo.words(course.lang),
      repo.unitWords(courseId, unitN),
      repo.unitExercises(courseId, unitN),
      repo.generatedUnitExercises(courseId, unitN),
      threshold(course.lang),
    ]);
    if (unitWords.length === 0) throw new Error("This unit has no words yet.");
    onProgress?.("Looking at the unit's grammar…");
    // Grammar focus is optional; a language-server outage shows in the degraded indicator.
    const topics = deps.unitGrammar ? await deps.unitGrammar(courseId, unitN).catch(() => []) : [];
    const topic = topics[0] ? grammarTopic(topics[0].topicId, course.lang) : undefined;
    // The kinds the book uses in this unit; gap fill and matching at least.
    const kinds = new Set<UnitExerciseKind>(["gapfill", "matching"]);
    for (const e of own) {
      const k = KIND_FOR[e.type];
      if (k) kinds.add(k);
    }
    if (own.some((e) => e.type === "open-task" || e.type === "unknown")) kinds.add("questions");
    // Glosses for matching: the word list's, else the dictionary's (optional: missing ones are
    // generated without a gloss; an outage shows in the degraded indicator).
    const glosses = await deps
      .glossLemmas(unitWords.filter((w) => !w.gloss).map((w) => w.lemma))
      .catch(() => ({}) as Record<string, string>);
    // Words not known yet first, in book order.
    const state = (lemma: string) => model.get(normalizeKey(lemma))?.state;
    const targets = [
      ...unitWords.filter((w) => state(w.lemma) !== "known"),
      ...unitWords.filter((w) => state(w.lemma) === "known"),
    ].map((w) => ({
      lemma: w.lemma,
      ...(w.article ? { article: w.article } : {}),
      ...((w.gloss ?? glosses[w.lemma]) ? { gloss: w.gloss ?? glosses[w.lemma] } : {}),
    }));
    onProgress?.("Writing exercises…");
    const r = await generateUnitExercises(
      { provider: p, analyze, model, detectGrammar, minCoverage: thr },
      {
        unitTitle: unit.title,
        words: targets,
        kinds: [...kinds],
        vocabEstimate: vocab,
        knownLemmas: selectKnownLemmas(
          words,
          `${unit.title} ${targets.map((t) => t.lemma).join(" ")}`,
          300,
        ),
        ...(topic
          ? {
              grammar: {
                id: topic.id,
                title: topic.title,
                summary: topic.summary,
                detects: topic.detects,
              },
            }
          : {}),
      },
    );
    if (r.parseFailed)
      throw new AIError("The provider did not return exercises in the expected form.", "server");
    onProgress?.("Saving…");
    const start = Math.max(1000, ...earlier.map((e) => e.number)) + 1;
    const exercises = r.exercises.map((e, i) => ({ ...e, number: start + i, page: unit.pages[0] }));
    if (exercises.length > 0 || r.rejected.length > 0) {
      await repo.append({
        type: "UnitExercisesGenerated",
        courseId,
        unitN,
        exercises,
        rejected: r.rejected.length,
        ...(topic ? { grammarTopic: topic.id } : {}),
        provider: p.config.provider,
        model: p.config.model,
      });
    }
    return {
      added: exercises.reduce((n, e) => n + e.items.length, 0),
      rejected: r.rejected.length,
      ...(topic ? { grammarTopic: topic.title } : {}),
    };
  }

  return {
    fillSentences,
    aiReady: () => status().configured,
    generateUnitExercises: makeUnitExercises,
    async storyTargets(source) {
      const { lang } = await deps.settings();
      if (source.kind === "grammar") return [];
      if (source.kind === "unit") {
        const model = await deps.model();
        const words = await repo.unitWords(source.courseId, source.unitN);
        return words
          .map((w) => normalizeKey(w.lemma))
          .filter((k) => {
            const st = model.get(k)?.state;
            return st !== "known" && st !== "ignored";
          })
          .slice(0, MAX_STORY_TARGETS);
      }
      // "Words to learn now": words put first with Learn next, words looked up while reading,
      // then the shakiest words being learned.
      const all = (await repo.words(lang)).filter((w) => !/\s/.test(w.key));
      const prioritized = all.filter((w) => w.prioritized && w.state === "learning");
      const seen = all.filter((w) => w.state === "seen").sort((a, b) => b.lookups - a.lookups);
      const learning = all
        .filter((w) => w.state === "learning" && !w.prioritized)
        .sort((a, b) => a.pKnown - b.pKnown);
      return [...new Set([...prioritized, ...seen, ...learning].map((w) => w.key))].slice(0, 6);
    },
    async createStory(input, onProgress) {
      const { lang } = await deps.settings();
      const [p, model, vocab, words, thr] = await Promise.all([
        provider(),
        deps.model(),
        deps.vocabEstimate(),
        repo.words(lang),
        threshold(lang),
      ]);
      const topic = input.topic.trim() || "everyday life";
      const targets = [...new Set(input.targetWords.map((w) => w.trim()).filter(Boolean))].slice(
        0,
        MAX_STORY_TARGETS,
      );
      const grammar = input.grammarTopic ? grammarTopic(input.grammarTopic) : undefined;
      const result = await generateStory(
        {
          provider: p,
          analyze,
          model,
          threshold: thr,
          onProgress: (step) => onProgress?.(STORY_STEP[step]),
        },
        {
          topic,
          length: input.length,
          ...(input.style ? { style: input.style } : {}),
          vocabEstimate: vocab,
          knownLemmas: selectKnownLemmas(words, `${topic} ${targets.join(" ")}`, 300),
          targetWords: targets,
          ...(grammar ? { grammar: { title: grammar.title, summary: grammar.summary } } : {}),
        },
      );
      if (!result.text.trim()) throw new AIError("The provider returned an empty text.", "server");
      onProgress?.("Saving it to your library…");
      const textId = await saveText({
        title: result.title,
        content: result.text,
        source: {
          kind: "ai",
          provider: p.config.provider,
          model: p.config.model,
          targets,
          topic,
          ...(grammar ? { grammarTopic: grammar.id } : {}),
        },
      });
      const view: StoryView = {
        textId,
        title: result.title,
        coverage: result.coverage,
        rewritten: result.rewritten,
        missingTargets: result.missingTargets,
        parseFailed: result.parseFailed,
      };
      return view;
    },
    async generateExamItem(part, topic) {
      const { lang } = await deps.settings();
      const [p, model, vocab, words, thr] = await Promise.all([
        provider(),
        deps.model(),
        deps.vocabEstimate(),
        repo.words(lang),
        threshold(lang),
      ]);
      const r = await generateExamItem(
        { provider: p, analyze, model, threshold: thr },
        {
          part,
          ...(topic ? { topic } : {}),
          vocabEstimate: vocab,
          knownLemmas: selectKnownLemmas(words, topic ?? "", 300),
        },
      );
      if (!r.item) {
        throw new AIError(
          "The provider did not return a usable practice item. Try again.",
          "server",
        );
      }
      return { item: r.item, coverage: r.coverage, rewritten: r.rewritten };
    },
    async examFeedback(input) {
      return examFeedback(await provider(), input);
    },
    async getAISettings() {
      return getSettings();
    },
    async saveAISettings(patch) {
      const cur = getSettings();
      const next = { ...cur, ...patch };
      // Switching provider without an explicit address/model takes the new preset's defaults.
      if (patch.provider && patch.provider !== cur.provider) {
        const preset = PRESETS.find((x) => x.id === patch.provider);
        if (preset) {
          if (patch.baseUrl === undefined) next.baseUrl = preset.baseUrl;
          if (patch.model === undefined) next.model = preset.defaultModel;
        }
      }
      storage.setItem(CONFIG_KEY, JSON.stringify(next));
    },
    async aiStatus() {
      return status();
    },
    async saveAIKey(key, passphrase) {
      const { provider: id } = getSettings();
      await saveKey(storage, id, key.trim(), passphrase || undefined);
      unlocked.set(id, key.trim());
    },
    async clearAIKey() {
      const { provider: id } = getSettings();
      clearKey(storage, id);
      unlocked.delete(id);
    },
    async unlockAI(passphrase) {
      const { provider: id } = getSettings();
      const k = await loadKey(storage, id, passphrase);
      if (k === undefined) throw new WrongPassphraseError();
      unlocked.set(id, k);
    },
    async listAIModels(input, key) {
      const id = `${input.provider}\u0000${input.baseUrl}`;
      const hit = modelCache.get(id);
      if (hit && !key) return hit;
      let apiKey = key?.trim() || unlocked.get(input.provider);
      if (!apiKey) {
        try {
          apiKey = await loadKey(storage, input.provider);
        } catch {
          // encrypted and locked: list without a key (curated fallback)
        }
      }
      let out: ModelChoices;
      try {
        const listed = await listModels({ ...input, apiKey }, deps.fetch);
        out = { options: modelOptions(input.provider, listed.length ? listed : null), live: listed.length > 0 };
      } catch {
        out = { options: modelOptions(input.provider, null), live: false };
      }
      if (out.live || !modelCache.has(id)) modelCache.set(id, out);
      return out;
    },
    async testAI() {
      const p = await provider();
      const t0 = Date.now();
      const res = await p.chat({
        system: "You are a connection test. Answer with the single word OK.",
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 256,
      });
      return { text: res.text.trim().slice(0, 80), ms: Date.now() - t0 };
    },
    async aiUsage() {
      const u = readJson<AIUsage>(USAGE_KEY);
      const month = monthOf();
      return u?.month === month ? u : { month, calls: 0, inputTokens: 0, outputTokens: 0 };
    },

    async listConversations() {
      return projectConversations(await repo.conversationEvents())
        .reverse()
        .map((c) => ({
          id: c.id,
          topic: c.topic,
          messages: c.messages.length,
          preview: c.messages.at(-1)?.text.slice(0, 80) ?? "",
        }));
    },
    async getConversation(id) {
      const c = await loadConversation(id);
      return c ? toConversationView(c) : null;
    },
    async startConversation({ topic, targetWords = [] }) {
      const id = crypto.randomUUID();
      // Fail early (no key, locked) before anything is stored.
      await provider();
      await repo.append({
        type: "ConversationStarted",
        conversationId: id,
        lang: (await deps.settings()).lang,
        topic: topic.trim() || "everyday life",
        targetWords: targetWords.map((w) => w.trim()).filter(Boolean),
      });
      try {
        return await turn(id, "");
      } catch (e) {
        // The conversation exists but is empty; the screen can retry the opening via sendMessage.
        if (e instanceof Error) throw e;
        throw new AIError(String(e), "server");
      }
    },
    sendConversationMessage: (id, text) => turn(id, text),
    async suggestTargetWords() {
      const { lang } = await deps.settings();
      const learning = await repo.words(lang, { state: "learning" });
      return learning
        .filter((w) => !/\s/.test(w.key))
        .sort((a, b) => a.pKnown - b.pKnown)
        .slice(0, 5)
        .map((w) => w.key);
    },
    async addConversationWord(word, opts) {
      const s = await deps.settings();
      const example = word.example.trim();
      const at = example.toLowerCase().indexOf(word.lemma.toLowerCase());
      const { deck } = await addWordToAnki(await deps.anki(), (e) => repo.append(e), {
        profile: deps.profile ? await deps.profile() : migratedProfile(s.lang, s.targetDeck, []),
        context: { source: "converse", ...(opts?.deck ? { deck: opts.deck } : {}) },
        word: word.lemma,
        ...(word.gloss ? { gloss: word.gloss } : {}),
        ...(example
          ? {
              sentence: at >= 0 ? highlightSentence(example, at, at + word.lemma.length) : example,
            }
          : {}),
        source: "Kenning conversation",
      });
      deps.changed();
      return { deck };
    },
    async aiExplainSentence(sentence, grammar) {
      return explainSentence(await provider(), sentence, {
        vocabEstimate: await deps.vocabEstimate(),
        ...(grammar?.length ? { grammar } : {}),
      });
    },
    async aiSimplify(text) {
      const { lang } = await deps.settings();
      const stair = await repo.staircase(lang);
      return simplifyText(
        {
          provider: await provider(),
          analyze,
          model: await deps.model(),
          vocabEstimate: await deps.vocabEstimate(),
          targetCoverage: stair?.targetCoverage ?? DEFAULT_PLANNER.targetCoverage,
        },
        text,
      );
    },
  };
}
