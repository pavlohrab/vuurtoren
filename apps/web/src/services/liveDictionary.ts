/**
 * Meanings and translations: the learner's Anki gloss first, then the Wiktionary dictionary and
 * offline sentence translation of the language server, cached. Both server features are
 * optional: when they fail the app shows words without meanings and reports "translate".
 *
 * A word the dictionary does not know gets a meaning built from its parts or read off the
 * translation of its sentence. Order: derivation ("from woord + -loos"), a confident alignment
 * ("in this sentence"), compound, then a less confident alignment.
 */
import { PARTICLE_GLOSSES, formOfTarget, meaningSenses, shortGloss } from "@app/core";
import type { VuurtorenRepository, WordInfo } from "@app/db";
import type { EntryResult, NlpClient } from "@app/nlp-client";
import { DEGRADED_MESSAGES, clearDegraded, reportDegraded } from "./degraded.js";
import { nlpOutage } from "./liveSettings.js";
import { withoutArticle } from "./contextGloss.js";

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
  // A name is only a name: "Joost" is "a male given name", not also "Satan, the Devil".
  if (pos === "PROPN" && entries.some((e) => e.pos === "name"))
    return entries.filter((e) => e.pos === "name");
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

/** Note for a meaning built from the word's parts ("from woord + -loos"), else undefined. */
function partsNote(entry: Dictionary[string][number] | undefined): string | undefined {
  return entry?.origin && entry.formed ? `from ${entry.formed}` : undefined;
}

/** Note shown with a meaning read off the sentence translation. */
export const IN_SENTENCE = "in this sentence";

/** Below this an aligned word is not used as a meaning (see server/nlp align.py). */
const ALIGN_MIN_CONFIDENCE = 0.5;

/**
 * Meanings of a word: the card's gloss first, then dictionary senses (form-of noise removed).
 * `glossNote` says where the first meaning came from when it is a guess built from the word's
 * parts.
 */
export function composeGlosses(
  info: WordInfo | null,
  entries: Dictionary[string] | undefined,
  pos: string,
): {
  glosses: string[];
  article: string | undefined;
  glossNote?: string;
  guess?: "derivation" | "compound";
} {
  const glosses: string[] = [];
  if (info?.gloss) glosses.push(withoutArticle(info.gloss));
  const ordered = orderByPos(entries ?? [], pos);
  for (const e of ordered)
    for (const g of e.glosses)
      if (!FORM_OF.test(g) && !PLACE_SENSE.test(g) && !glosses.includes(g)) glosses.push(g);
  // An article only for a word used as a noun, and only from a noun sense: "haar" (her) must not
  // borrow "het haar" (hair), nor "ons" (us) "het ons" (an ounce).
  const asNoun = pos ? /^(NOUN|PROPN)$/i.test(pos) : ordered[0]?.pos === "noun";
  const article =
    info?.article ??
    (asNoun
      ? ordered.find((e) => e.pos === "noun" && (e.article === "de" || e.article === "het"))
          ?.article
      : undefined) ??
    undefined;
  const note = info?.gloss ? undefined : partsNote(ordered[0]);
  const guess = note ? ordered[0]?.origin : undefined;
  return {
    glosses: glosses.slice(0, 6),
    article,
    ...(note ? { glossNote: note } : {}),
    ...(guess ? { guess } : {}),
  };
}

/** Same meaning, ignoring case and punctuation ("Wordless." = "wordless"). */
export function sameMeaning(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N} ]+/gu, "")
      .trim();
  return norm(a) === norm(b);
}

/** A word in its sentence: [start, end) inside `sentence`. */
export interface WordInSentence {
  sentence: string;
  start: number;
  end: number;
}

/** A word's English in its sentence; `confident` alignments rank above compound guesses. */
export interface AlignedMeaning {
  text: string;
  confident: boolean;
  /** The aligner's confidence, 0–1 (confident: at least ALIGN_MIN_CONFIDENCE). */
  confidence: number;
}

const alignKey = (w: WordInSentence) => `${w.start}:${w.end}:${w.sentence}`;

/**
 * Dictionary or sentence translation failed. An outage is already reported as "nlp" by the
 * client watcher; a missing feature (503: dictionary not built, model not fetched) is
 * reported as "translate".
 */
function translationFailed(e: unknown): void {
  if (!nlpOutage(e)) reportDegraded("translate", DEGRADED_MESSAGES.translate, e);
}

export interface LiveDictionaryDeps {
  repo: VuurtorenRepository;
  lang: () => Promise<string>;
  nlp: () => Promise<NlpClient>;
  /**
   * The dictionary pack on the device (phones): entries per word, or null when it is not
   * there. Asked before the language server, which then only adds what the pack lacks.
   */
  localGloss?: ((words: string[]) => Promise<Dictionary | null>) | undefined;
  /** The same pack's full entry of one word for the word card (dictionary v2), or null. */
  localEntry?: ((word: string, pos?: string) => Promise<EntryResult | null>) | undefined;
}

/** An inline meaning; `note` marks a guess ("from woord + -loos", "in this sentence"). */
export interface FoundGloss {
  text: string;
  note?: string;
  /** Set when the meaning is a guess built from the word's parts. */
  guess?: "derivation" | "compound";
}

export function createLiveDictionary({
  repo,
  lang,
  nlp,
  localGloss,
  localEntry,
}: LiveDictionaryDeps) {
  /**
   * Everything the word card shows about one word: from the pack on the device when it is
   * there, else from the language server; null when neither can answer.
   */
  async function entry(word: string, pos?: string): Promise<EntryResult | null> {
    const local = localEntry ? await localEntry(word, pos).catch(() => null) : null;
    if (local?.entries.length) return local;
    try {
      return await (await nlp()).entry("nl", word, pos);
    } catch {
      return local;
    }
  }

  /**
   * Dictionary entries: from the pack on the device when it is there (words it does not know,
   * such as compounds, from the server when it can be reached), else from the server.
   */
  async function gloss(words: string[]): Promise<Dictionary> {
    const local = localGloss ? await localGloss(words).catch(() => null) : null;
    if (!local) return (await nlp()).gloss("nl", words);
    const unknown = words.filter((w) => !local[w]?.length);
    if (unknown.length) {
      try {
        Object.assign(local, await (await nlp()).gloss("nl", unknown));
      } catch {
        // The pack answered; the server would only have added the words it does not know.
      }
    }
    return local;
  }

  // Translation per lemma key: Anki gloss first, then the Wiktionary dictionary; null = none.
  const glossCache = new Map<string, FoundGloss | null>();
  const translationCache = new Map<string, string>();
  // English of a word in its sentence (confident alignments only); null = none.
  const alignCache = new Map<string, AlignedMeaning | null>();

  /**
   * Translations for (key, lemma, pos) items: the Anki card's gloss first, then the Wiktionary
   * dictionary (sense matching the part of speech preferred), batched: one dictionary request
   * for all misses. `complete` is false when the dictionary could not be reached — callers
   * must not treat missing entries as "no translation".
   */
  async function lookupGlosses(items: { key: string; lemma: string; pos?: string }[]): Promise<{
    found: Map<string, string>;
    notes: Map<string, string>;
    guesses: Map<string, "derivation" | "compound">;
    complete: boolean;
  }> {
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
    // One repository call for all card glosses, not one per word.
    const infos = new Map(
      (await repo.wordsByKeys(l, [...new Set(missing.map((it) => it.key))])).map((w) => [w.key, w]),
    );
    for (const it of missing) {
      const gloss = infos.get(it.key)?.gloss;
      if (gloss) glossCache.set(cacheKey(it), { text: withoutArticle(gloss) });
      else needDict.push(it);
    }
    let complete = true;
    if (needDict.length) {
      try {
        const lemmas = [...new Set(needDict.map((it) => it.lemma))];
        const dict: Dictionary = {};
        for (let i = 0; i < lemmas.length; i += GLOSS_BATCH) {
          Object.assign(dict, await gloss(lemmas.slice(i, i + GLOSS_BATCH)));
        }
        clearDegraded("translate");
        // A word whose senses only say "form of X" ("ze": unstressed form of zij) borrows X's
        // meaning: one more batched lookup for those targets.
        const senses = (it: { lemma: string; pos?: string }) =>
          orderByPos(dict[it.lemma] ?? [], it.pos).flatMap((e) => e.glosses);
        const targets = new Map<string, string>();
        for (const it of needDict) {
          const all = senses(it);
          if (meaningSenses(all).length) continue;
          const target = all.map(formOfTarget).find((t): t is string => t !== null);
          if (target) targets.set(it.lemma, target);
        }
        const missingTargets = [...new Set(targets.values())].filter((t) => !(t in dict));
        for (let i = 0; i < missingTargets.length; i += GLOSS_BATCH) {
          Object.assign(dict, await gloss(missingTargets.slice(i, i + GLOSS_BATCH)));
        }
        for (const it of needDict) {
          const ordered = orderByPos(dict[it.lemma] ?? [], it.pos);
          const fixed = PARTICLE_GLOSSES[it.lemma];
          if (fixed) {
            glossCache.set(cacheKey(it), { text: fixed });
            continue;
          }
          const target = targets.get(it.lemma);
          const own = meaningSenses(senses(it).filter((x) => !FORM_OF.test(x)));
          const short = shortGloss(
            own.length || !target ? own : meaningSenses(senses({ lemma: target })),
          );
          // "a sweet" → "sweet"; a person's name gets no gloss over it ("a male given name").
          const g =
            it.pos === "PROPN" && /\b(given name|surname|family name)\b/i.test(short)
              ? ""
              : withoutArticle(short);
          const note = partsNote(ordered[0]);
          const guess = note ? ordered[0]?.origin : undefined;
          glossCache.set(
            cacheKey(it),
            g ? { text: g, ...(note ? { note } : {}), ...(guess ? { guess } : {}) } : null,
          );
        }
      } catch (e) {
        // dictionary unavailable (503 when not built, or the server is down): retry next time
        complete = false;
        translationFailed(e);
      }
    }
    const found = new Map<string, string>();
    const notes = new Map<string, string>();
    const guesses = new Map<string, "derivation" | "compound">();
    for (const it of items) {
      const g = glossCache.get(cacheKey(it));
      if (g) found.set(it.key, g.text);
      if (g?.note) notes.set(it.key, g.note);
      if (g?.guess) guesses.set(it.key, g.guess);
    }
    return { found, notes, guesses, complete };
  }

  /**
   * The English each word became in the translation of its sentence (keyed by `alignKey`), with
   * whether the alignment is confident. Also fills the sentence-translation cache. Empty when
   * the translation model is unavailable.
   */
  async function alignWords(words: WordInSentence[]): Promise<Map<string, AlignedMeaning>> {
    const todo = words.filter((w) => !alignCache.has(alignKey(w)));
    if (todo.length) {
      const bySentence = new Map<string, [number, number][]>();
      for (const w of todo) {
        const spans = bySentence.get(w.sentence) ?? [];
        if (!spans.some(([a, b]) => a === w.start && b === w.end)) spans.push([w.start, w.end]);
        bySentence.set(w.sentence, spans);
      }
      try {
        const res = await (
          await nlp()
        ).align([...bySentence].map(([text, spans]) => ({ text, spans })));
        clearDegraded("translate");
        for (const r of res) {
          translationCache.set(r.text, r.translation);
          for (const word of r.words) {
            alignCache.set(
              alignKey({ sentence: r.text, start: word.start, end: word.end }),
              word.text
                ? {
                    text: word.text,
                    confident: word.confidence >= ALIGN_MIN_CONFIDENCE,
                    confidence: word.confidence,
                  }
                : null,
            );
          }
        }
      } catch (e) {
        // optional: model not fetched (503) or server down
        translationFailed(e);
      }
    }
    const out = new Map<string, AlignedMeaning>();
    for (const w of words) {
      const a = alignCache.get(alignKey(w));
      if (a) out.set(alignKey(w), a);
    }
    return out;
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
      const dict = await gloss(lemmas);
      clearDegraded("translate");
      return dict;
    } catch (e) {
      // The dictionary is optional (503 when not built): words show without meanings.
      translationFailed(e);
      return {};
    }
  }

  /**
   * Sentence translations and in-context meanings already known (a text's stored extras): the
   * word sheet then needs no language server for them.
   */
  function seedSentences(
    items: {
      sentence: string;
      english: string;
      words: { start: number; end: number; text: string; confidence: number }[];
    }[],
  ): void {
    for (const it of items) {
      if (it.english && !translationCache.has(it.sentence)) {
        translationCache.set(it.sentence, it.english);
      }
      for (const w of it.words) {
        const k = alignKey({ sentence: it.sentence, start: w.start, end: w.end });
        if (!alignCache.has(k)) {
          alignCache.set(k, {
            text: w.text,
            confident: w.confidence >= ALIGN_MIN_CONFIDENCE,
            confidence: w.confidence,
          });
        }
      }
    }
  }

  return {
    entry,
    seedSentences,
    lookupGlosses,
    translateSentences,
    alignWords,
    alignKey,
    dictionaryFor,
    /** Card glosses changed (Anki sync, another device): look them up again. */
    clearGlosses: () => glossCache.clear(),
  };
}

export type LiveDictionary = ReturnType<typeof createLiveDictionary>;
