/**
 * Meanings and translations: the learner's Anki gloss first, then the Wiktionary dictionary and
 * offline sentence translation of the language server, cached. Both server features are
 * optional: when they fail the app shows words without meanings and reports "translate".
 */
import type { KenningRepository, WordInfo } from "@app/db";
import type { NlpClient } from "@app/nlp-client";
import { DEGRADED_MESSAGES, clearDegraded, reportDegraded } from "./degraded.js";
import { nlpOutage } from "./liveSettings.js";

export type Dictionary = Awaited<ReturnType<NlpClient["gloss"]>>;

// spaCy universal POS -> Wiktionary (kaikki) part of speech, to pick the sense that fits.
const KAIKKI_POS: Record<string, string[]> = {
  NOUN: ["noun"],
  PROPN: ["name", "noun"],
  VERB: ["verb"],
  AUX: ["verb"],
  ADJ: ["adj"],
  ADV: ["adv"],
  PRON: ["pron"],
  DET: ["det", "article", "pron"],
  ADP: ["prep", "postp"],
  NUM: ["num"],
  CCONJ: ["conj"],
  SCONJ: ["conj"],
  INTJ: ["intj"],
};

/** Max words per /gloss request (server limit 2000). */
const GLOSS_BATCH = 500;

/** Dictionary entries with senses of the token's part of speech first. */
function orderByPos<T extends { pos: string }>(entries: T[], pos?: string): T[] {
  const wanted = pos ? (KAIKKI_POS[pos] ?? []) : [];
  return [
    ...entries.filter((e) => wanted.includes(e.pos)),
    ...entries.filter((e) => !wanted.includes(e.pos)),
  ];
}

// Wiktionary form-of senses ("inflection of fietsen: …", "plural of …") are noise as glosses.
const FORM_OF =
  /^(inflection|plural|diminutive|singular|past|present|feminine|comparative|superlative)[^:]* of /i;

/**
 * Wiktionary place-name senses ("a hamlet in Weststellingwerf, Friesland, Netherlands") are
 * noise for a learner looking up a common noun; proper nouns are not glossed this way anyway.
 */
const PLACE_SENSE =
  /^an? (hamlet|village|town|city|neighbourhood|neighborhood|municipality|river|surname|placename|place)\b.*\b(in|of)\b/i;

/** Meanings of a word: the card's gloss first, then dictionary senses (form-of noise removed). */
export function composeGlosses(
  info: WordInfo | null,
  entries: Dictionary[string] | undefined,
  pos: string,
): { glosses: string[]; article: string | undefined } {
  const glosses: string[] = [];
  if (info?.gloss) glosses.push(info.gloss);
  const ordered = orderByPos(entries ?? [], pos);
  for (const e of ordered)
    for (const g of e.glosses)
      if (!FORM_OF.test(g) && !PLACE_SENSE.test(g) && !glosses.includes(g)) glosses.push(g);
  const article =
    info?.article ??
    ordered.find((e) => e.article === "de" || e.article === "het")?.article ??
    undefined;
  return { glosses: glosses.slice(0, 6), article };
}

/**
 * Dictionary or sentence translation failed. An outage is already reported as "nlp" by the
 * client watcher; a missing feature (503: dictionary not built, model not fetched) is
 * reported as "translate".
 */
function translationFailed(e: unknown): void {
  if (!nlpOutage(e)) reportDegraded("translate", DEGRADED_MESSAGES.translate, e);
}

export interface LiveDictionaryDeps {
  repo: KenningRepository;
  lang: () => Promise<string>;
  nlp: () => Promise<NlpClient>;
}

export function createLiveDictionary({ repo, lang, nlp }: LiveDictionaryDeps) {
  // Translation per lemma key: Anki gloss first, then the Wiktionary dictionary; null = none.
  const glossCache = new Map<string, string | null>();
  const translationCache = new Map<string, string>();

  /**
   * Translations for (key, lemma, pos) items: the Anki card's gloss first, then the Wiktionary
   * dictionary (sense matching the part of speech preferred), batched: one dictionary request
   * for all misses. `complete` is false when the dictionary could not be reached — callers
   * must not treat missing entries as "no translation".
   */
  async function lookupGlosses(
    items: { key: string; lemma: string; pos?: string }[],
  ): Promise<{ found: Map<string, string>; complete: boolean }> {
    const l = await lang();
    const cacheKey = (it: { key: string; pos?: string }) => `${it.key}|${it.pos ?? ""}`;
    const seen = new Set<string>();
    const missing = items.filter((it) => {
      const k = cacheKey(it);
      if (glossCache.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const needDict: { key: string; lemma: string; pos?: string }[] = [];
    // One repository call for all card glosses (review A8), not one per word.
    const infos = new Map(
      (await repo.wordsByKeys(l, [...new Set(missing.map((it) => it.key))])).map((w) => [w.key, w]),
    );
    for (const it of missing) {
      const gloss = infos.get(it.key)?.gloss;
      if (gloss) glossCache.set(cacheKey(it), gloss);
      else needDict.push(it);
    }
    let complete = true;
    if (needDict.length) {
      try {
        const lemmas = [...new Set(needDict.map((it) => it.lemma))];
        const dict: Dictionary = {};
        for (let i = 0; i < lemmas.length; i += GLOSS_BATCH) {
          Object.assign(dict, await (await nlp()).gloss("nl", lemmas.slice(i, i + GLOSS_BATCH)));
        }
        clearDegraded("translate");
        for (const it of needDict) {
          const g = orderByPos(dict[it.lemma] ?? [], it.pos)
            .flatMap((e) => e.glosses)
            .find((x) => !FORM_OF.test(x));
          glossCache.set(cacheKey(it), g ?? null);
        }
      } catch (e) {
        // dictionary unavailable (503 when not built, or the server is down): retry next time
        complete = false;
        translationFailed(e);
      }
    }
    const found = new Map<string, string>();
    for (const it of items) {
      const g = glossCache.get(cacheKey(it));
      if (g) found.set(it.key, g);
    }
    return { found, complete };
  }

  /** Sentence translations (offline MT), cached; missing entries when the model is unavailable. */
  async function translateSentences(sentences: string[]): Promise<Map<string, string>> {
    const todo = [...new Set(sentences.filter((s) => s.trim() && !translationCache.has(s)))];
    if (todo.length) {
      try {
        const res = await (await nlp()).translate(todo, { source: "nl", target: "en" });
        for (const r of res) translationCache.set(r.text, r.translation);
        clearDegraded("translate");
      } catch (e) {
        // optional: model not fetched (503) or server down
        translationFailed(e);
      }
    }
    const out = new Map<string, string>();
    for (const s of sentences) {
      const t = translationCache.get(s);
      if (t) out.set(s, t);
    }
    return out;
  }

  /** Dictionary entries for lemmas in one request; empty when the dictionary is unavailable. */
  async function dictionaryFor(lemmas: string[]): Promise<Dictionary> {
    if (lemmas.length === 0) return {};
    try {
      const dict = await (await nlp()).gloss("nl", lemmas);
      clearDegraded("translate");
      return dict;
    } catch (e) {
      // The dictionary is optional (503 when not built): words show without meanings.
      translationFailed(e);
      return {};
    }
  }

  return {
    lookupGlosses,
    translateSentences,
    dictionaryFor,
    /** Card glosses changed (Anki sync, another device): look them up again. */
    clearGlosses: () => glossCache.clear(),
  };
}

export type LiveDictionary = ReturnType<typeof createLiveDictionary>;
