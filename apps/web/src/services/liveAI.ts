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
  explainSentence,
  keyStatus,
  loadKey,
  presetFor,
  runTurn,
  saveKey,
  selectKnownLemmas,
  simplifyText,
} from "@app/ai";
import { AnkiConnectClient, addWordNote, highlightSentence } from "@app/anki";
import { DEFAULT_PLANNER, type AnalyzedToken, type LearnerModel } from "@app/core";
import { type KenningRepository, projectConversations } from "@app/db";
import { NlpClient } from "@app/nlp-client";
import type {
  AIServices,
  AISettings,
  AIStatus,
  AIUsage,
  ConversationView,
  NewWord,
} from "./aiTypes.js";
import { toConversationView } from "./conversationView.js";
import type { Settings } from "./types.js";

export interface LiveAIDeps {
  repo: KenningRepository;
  settings: () => Promise<Settings>;
  model: () => Promise<LearnerModel>;
  vocabEstimate: () => Promise<number>;
  anki: () => Promise<AnkiConnectClient>;
  /** Dictionary / Anki glosses for lemmas (found ones only). */
  glossLemmas: (lemmas: string[]) => Promise<Record<string, string>>;
  /** Called after the learner model changed (e.g. a note was added). */
  changed: () => void;
  /** Injectable for tests; defaults to localStorage (or memory when unavailable). */
  storage?: KeyValueStorage;
  fetch?: typeof fetch;
}

const CONFIG_KEY = "kenning.ai.config";
const USAGE_KEY = "kenning.ai.usage";
/** Earlier messages sent to the model (older ones are dropped to bound the cost). */
const HISTORY_LIMIT = 16;

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

export function createLiveAI(deps: LiveAIDeps): AIServices {
  const { repo } = deps;
  const storage = deps.storage ?? defaultStorage();
  /** Decrypted keys of this session only. */
  const unlocked = new Map<string, string>();

  const readJson = <T>(key: string): T | undefined => {
    try {
      const raw = storage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
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

  return {
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
    async addConversationWord(word) {
      const s = await deps.settings();
      const example = word.example.trim();
      const at = example.toLowerCase().indexOf(word.lemma.toLowerCase());
      const noteId = await addWordNote(await deps.anki(), {
        deck: s.targetDeck,
        word: word.lemma,
        ...(word.gloss ? { gloss: word.gloss } : {}),
        ...(example
          ? {
              sentence: at >= 0 ? highlightSentence(example, at, at + word.lemma.length) : example,
            }
          : {}),
        tags: ["nl", "converse"],
        source: "Kenning conversation",
      });
      await repo.append({
        type: "NoteAddedToAnki",
        lang: s.lang,
        key: word.lemma.toLowerCase(),
        noteId,
        deck: s.targetDeck,
      });
      deps.changed();
      return { deck: s.targetDeck };
    },
    async aiExplainSentence(sentence) {
      return explainSentence(await provider(), sentence, {
        vocabEstimate: await deps.vocabEstimate(),
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
