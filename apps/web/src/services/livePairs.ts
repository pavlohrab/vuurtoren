/**
 * Side by side: each sentence's English and its word pairs, from the language server's
 * `/translate/pairs` (offline OPUS-MT attention). With the AI option the English comes from the
 * learner's provider and the server pairs that English (forced decoding). Both are optional:
 * without the server a sentence has no English; without the provider the offline English is
 * used.
 */
import type { AnalyzedToken, SentencePairs } from "@app/core";
import type { NlpClient, PairItem, PairedText } from "@app/nlp-client";
import { DEGRADED_MESSAGES, clearDegraded, reportDegraded } from "./degraded.js";
import { nlpOutage } from "./liveSettings.js";
import type { ReadingView } from "./types.js";

export interface LivePairsDeps {
  view: (textId: string) => Promise<ReadingView | null>;
  nlp: () => Promise<NlpClient>;
  /** Whether an AI provider is set up and unlocked. */
  aiReady: () => boolean;
  /** English from the AI provider, one per sentence ("" when it left one out). */
  aiTranslate: (sentences: string[]) => Promise<string[]>;
}

/** Words and punctuation of an English sentence (the server's tokenisation). */
const EN_TOKEN = /[\p{L}\p{N}]+|['’][\p{L}\p{N}]+|[^\p{L}\p{N}\s]/gu;

export function englishTokens(english: string): SentencePairs["englishTokens"] {
  return [...english.matchAll(EN_TOKEN)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    text: m[0],
  }));
}

interface Sentence {
  sent: number;
  /** Word tokens of the sentence, in order (the server's `spans`). */
  words: AnalyzedToken[];
  item: PairItem;
}

/** The sentence's text, word spans and separable-verb joins, as `/translate/pairs` takes them. */
function pairItem(content: string, tokens: readonly AnalyzedToken[]): Omit<Sentence, "sent"> {
  const start = tokens[0]?.start ?? 0;
  const end = tokens[tokens.length - 1]?.end ?? start;
  const words = tokens.filter((t) => t.is_word);
  const at = new Map(words.map((t, k) => [t.i, k]));
  const joins: [number, number][] = [];
  words.forEach((t, k) => {
    const verb = t.particle_of != null ? at.get(t.particle_of) : undefined;
    if (verb !== undefined) joins.push([k, verb]);
  });
  return {
    words,
    item: {
      text: content.slice(start, end),
      spans: words.map((t) => [t.start - start, t.end - start]),
      ...(joins.length ? { joins } : {}),
    },
  };
}

export function createLivePairs(deps: LivePairsDeps) {
  /** AI English per Dutch sentence, for this session (each costs a provider call). */
  const aiEnglish = new Map<string, string>();

  async function fromAI(texts: string[]): Promise<void> {
    const todo = [...new Set(texts.filter((t) => !aiEnglish.has(t)))];
    if (!todo.length) return;
    try {
      const out = await deps.aiTranslate(todo);
      todo.forEach((t, k) => {
        const en = out[k]?.trim();
        if (en) aiEnglish.set(t, en);
      });
    } catch (e) {
      // The provider failed (key, rate limit, network): the offline English is used instead.
      console.warn("AI translation failed; using the offline translation:", e);
    }
  }

  async function sentencePairs(
    textId: string,
    sentences: number[],
    opts: { ai?: boolean } = {},
  ): Promise<SentencePairs[]> {
    const v = await deps.view(textId);
    if (!v) return [];
    const bySent = new Map<number, AnalyzedToken[]>();
    for (const t of v.tokens) {
      const list = bySent.get(t.sent);
      if (list) list.push(t);
      else bySent.set(t.sent, [t]);
    }
    const asked: Sentence[] = sentences.map((sent) => ({
      sent,
      ...pairItem(v.text.content, bySent.get(sent) ?? []),
    }));
    const useAI = opts.ai === true && deps.aiReady();
    if (useAI) await fromAI(asked.map((s) => s.item.text));
    const items = asked.map((s) => {
      const en = useAI ? aiEnglish.get(s.item.text) : undefined;
      return en ? { ...s.item, translation: en } : s.item;
    });
    let paired: PairedText[] = [];
    try {
      paired = items.length ? await (await deps.nlp()).pairs(items) : [];
      clearDegraded("translate");
    } catch (e) {
      // optional: model not fetched (503) or server down
      if (!nlpOutage(e)) reportDegraded("translate", DEGRADED_MESSAGES.translate, e);
    }
    return asked.map((s, k): SentencePairs => {
      const r = paired[k];
      const given = items[k]?.translation;
      if (!r) {
        // No server: the AI English alone, without pairs.
        return {
          sent: s.sent,
          english: given ?? "",
          englishTokens: given ? englishTokens(given) : [],
          pairs: [],
          source: given ? "ai" : "offline",
        };
      }
      return {
        sent: s.sent,
        english: r.translation,
        englishTokens: r.english,
        pairs: r.pairs.map((p) => ({
          nl: p.nl.map((w) => s.words[w]?.i ?? -1).filter((i) => i >= 0),
          en: p.en,
          confidence: p.confidence,
        })),
        source: r.source === "given" ? "ai" : "offline",
      };
    });
  }

  return { sentencePairs };
}
