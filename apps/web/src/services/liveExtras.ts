/**
 * A text's extras: what the language server says about each sentence (its English, the word
 * pairs of side by side, each word's English in that sentence), made once on a device that has
 * a language server and kept with the analysis (`repo.saveTextExtras`). Sync carries them, with
 * the analysis and the grammar hits, to the other devices as the text's bundle, so a phone
 * without a language server reads a text added on the computer with every help.
 *
 * Making them is background work: after a text is analysed, and for older texts now and then,
 * one text at a time, stopping when the language server is not there.
 */
import type { AnalyzedToken } from "@app/core";
import {
  type ExtrasGloss,
  type TextExtraSentence,
  type TextExtras,
  type VuurtorenRepository,
  contentHash,
} from "@app/db";
import type { NlpClient } from "@app/nlp-client";
import type { LiveDictionary } from "./liveDictionary.js";
import { pairItem } from "./livePairs.js";
import { type StorySentencePairs, storySlugOf } from "./stories.js";

/** The language server's offline translation model, the one that makes the extras' English. */
const MT_MODEL = "opus-mt-nl-en";

export interface LiveExtrasDeps {
  repo: VuurtorenRepository;
  nlp: () => Promise<NlpClient>;
  dictionary: Pick<LiveDictionary, "seedSentences"> & Partial<Pick<LiveDictionary, "seedGlosses">>;
  /** Wait between two texts of the background run (ms). */
  pauseMs?: number;
}

/** The tokens of each sentence, by sentence index, in order. */
function bySentence(tokens: readonly AnalyzedToken[]): Map<number, AnalyzedToken[]> {
  const out = new Map<number, AnalyzedToken[]>();
  for (const t of tokens) {
    const list = out.get(t.sent);
    if (list) list.push(t);
    else out.set(t.sent, [t]);
  }
  return out;
}

/** Ask the language server for the extras of analysed tokens. */
async function makeExtras(
  client: NlpClient,
  content: string,
  tokens: readonly AnalyzedToken[],
): Promise<TextExtraSentence[]> {
  const sentences = [...bySentence(tokens)]
    .map(([sent, toks]) => ({ sent, ...pairItem(content, toks) }))
    .filter((s) => s.words.length > 0);
  if (sentences.length === 0) return [];
  const paired = await client.pairs(sentences.map((s) => s.item));
  const aligned = await client.align(
    sentences.map((s) => ({ text: s.item.text, spans: s.item.spans })),
  );
  return sentences.map((s, k) => {
    const p = paired[k];
    const a = aligned[k];
    const tokenAt = new Map(s.item.spans.map(([b, e], j) => [`${b}:${e}`, s.words[j]!.i]));
    return {
      sent: s.sent,
      english: p?.translation ?? a?.translation ?? "",
      pairs: (p?.pairs ?? []).map((w) => ({ nl: w.nl, en: w.en, confidence: w.confidence })),
      // A word with no English is kept as [i, null, 0]: asked, nothing (format 2).
      align: (a?.words ?? []).flatMap((w): [number, string | null, number][] => {
        const i = tokenAt.get(`${w.start}:${w.end}`);
        if (i === undefined) return [];
        return [w.text ? [i, w.text, w.confidence] : [i, null, 0]];
      }),
    };
  });
}

/** Words per `/gloss` request when collecting a text's built meanings. */
const GLOSS_BATCH = 200;

/**
 * The meanings the language server builds from a word's parts (compounds, derivations) for the
 * text's words: a phone's dictionary pack has none of these, so the bundle carries them. Empty
 * when the dictionary isn't there.
 */
async function builtGlosses(
  client: NlpClient,
  tokens: readonly AnalyzedToken[],
): Promise<Record<string, ExtrasGloss[]>> {
  const lemmas = [...new Set(tokens.filter((t) => t.is_word && !t.is_propn).map((t) => t.lemma))];
  const out: Record<string, ExtrasGloss[]> = {};
  try {
    for (let i = 0; i < lemmas.length; i += GLOSS_BATCH) {
      const got = await client.gloss("nl", lemmas.slice(i, i + GLOSS_BATCH));
      for (const [lemma, entries] of Object.entries(got)) {
        const built = entries.filter((e) => e.origin || e.compound);
        if (built.length) out[lemma] = built;
      }
    }
  } catch {
    // No dictionary on the server: the extras go without built meanings.
  }
  return out;
}

/** The extras of `text` if they index these tokens (same content and analyzer), else null. */
async function extrasFor(
  repo: VuurtorenRepository,
  text: { id: string; content: string; analyzerVersion?: string | null | undefined },
): Promise<TextExtras | null> {
  const x = await repo.textExtras(text.id);
  if (!x || x.contentHash !== contentHash(text.content)) return null;
  return (x.analyzerVersion ?? null) === (text.analyzerVersion ?? null) ? x : null;
}

export function createLiveExtras({ repo, nlp, dictionary, pauseMs = 1500 }: LiveExtrasDeps) {
  /** Make and store a text's extras; false when it has no analysis or the server is not there. */
  async function make(textId: string): Promise<boolean> {
    const text = await repo.getText(textId);
    if (!text?.tokens) return false;
    const client = await nlp();
    const sentences = await makeExtras(client, text.content, text.tokens);
    const glosses = await builtGlosses(client, text.tokens);
    return repo.saveTextExtras({
      textId,
      contentHash: contentHash(text.content),
      analyzerVersion: text.analyzerVersion ?? null,
      madeAt: Date.now(),
      sentences,
      mtModel: MT_MODEL,
      ...(Object.keys(glosses).length ? { glosses } : {}),
    });
  }

  /** Texts that never need extras made: bundled stories bring their own English and pairs. */
  const notNeeded = new Set<string>();
  /** The next analysed text without extras that needs them, or null. */
  async function nextToMake(): Promise<string | null> {
    for (const s of await repo.analysisStates()) {
      if (s.extrasAt !== null || notNeeded.has(s.textId)) continue;
      const text = await repo.getText(s.textId);
      if (text && storySlugOf(text.sourceRef)) {
        notNeeded.add(s.textId);
        continue;
      }
      return s.textId;
    }
    return null;
  }

  let running: Promise<void> | null = null;
  /** Make the extras of every analysed text that lacks them, in the background. */
  function fillLater(): void {
    running ??= (async () => {
      try {
        for (;;) {
          const next = await nextToMake();
          if (!next) return;
          await make(next);
          await new Promise((r) => setTimeout(r, pauseMs));
        }
      } catch {
        // No language server (a phone on its own, or it is starting): another time.
      } finally {
        running = null;
      }
    })();
  }

  /**
   * Put a text's stored English and in-context meanings where the word sheet looks first, so
   * they need no language server.
   */
  async function seed(
    text: { id: string; content: string; analyzerVersion?: string | null | undefined },
    tokens: readonly AnalyzedToken[],
  ): Promise<void> {
    const x = await extrasFor(repo, text);
    if (!x) return;
    if (x.glosses) dictionary.seedGlosses?.(x.glosses);
    const sents = bySentence(tokens);
    dictionary.seedSentences(
      x.sentences.flatMap((s) => {
        const toks = sents.get(s.sent);
        if (!toks?.length) return [];
        const start = toks[0]!.start;
        const sentence = text.content.slice(start, toks[toks.length - 1]!.end);
        const at = new Map(toks.map((t) => [t.i, t]));
        return [
          {
            sentence,
            english: s.english,
            words: s.align.flatMap(([i, en, confidence]) => {
              const t = at.get(i);
              return t
                ? [{ start: t.start - start, end: t.end - start, text: en, confidence }]
                : [];
            }),
          },
        ];
      }),
    );
  }

  /** Side by side's English and pairs per sentence, from the stored extras (empty if none). */
  async function pairs(text: {
    id: string;
    content: string;
    analyzerVersion?: string | null | undefined;
  }): Promise<Map<number, StorySentencePairs>> {
    const x = await extrasFor(repo, text);
    const out = new Map<number, StorySentencePairs>();
    for (const s of x?.sentences ?? []) {
      if (s.english) out.set(s.sent, { english: s.english, pairs: s.pairs });
    }
    return out;
  }

  return { make, fillLater, seed, pairs };
}
