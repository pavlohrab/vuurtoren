/**
 * Words: the inspector entry of a word (with its live Anki state), the words of a text, the
 * Words list, word actions (Add to Anki, study first, mark known, word state), the Anki sync
 * and Claude's suggested words.
 */
import {
  type AnkiConnectClient,
  type NoteCardStatus,
  addWordToAnki,
  cardStatus,
  highlightSentence,
  markWordKnown,
  resetToAnkiState,
  setAppWordState,
  studyWordFirst,
} from "@app/anki";
import {
  type AnalyzedToken,
  type TokenLabel,
  type WordState,
  matchToken,
  normalizeKey,
} from "@app/core";
import type { KenningRepository, WordInfo } from "@app/db";
import { activitySince, groupActivity } from "./activity.js";
import { absentAnki, ankiFromStatus, unavailableAnki } from "./ankiState.js";
import { DEGRADED_MESSAGES, clearDegraded, reportDegraded } from "./degraded.js";
import {
  type Dictionary,
  IN_SENTENCE,
  type LiveDictionary,
  composeGlosses,
  sameMeaning,
} from "./liveDictionary.js";
import type { LearnerCache } from "./liveLearner.js";
import type { LiveProfile } from "./liveProfile.js";
import type { LiveTexts } from "./liveTexts.js";
import type { AddOptions } from "./profileTypes.js";
import { suggestionEntry } from "./suggestions.js";
import type {
  AppServices,
  InspectorEntry,
  LearnerSummary,
  ReadingView,
  TextWordItem,
} from "./types.js";

/** How long opening a word waits for Anki before showing "Anki not reachable". */
const INSPECT_TIMEOUT_MS = 3000;
/** The review asks for many notes at once, so it waits a little longer than one word does. */
const REVIEW_TIMEOUT_MS = 5000;

/** Where a word may enter the review, strongest reason first. */
const SOURCE_RANK = { introduce: 0, lookup: 1, gloss: 2 } as const;

/** Character range [start, end) of every sentence, by sentence number. */
function sentenceSpans(tokens: AnalyzedToken[]): Map<number, [number, number]> {
  const spans = new Map<number, [number, number]>();
  for (const t of tokens) {
    const s = spans.get(t.sent);
    if (s) s[1] = t.end;
    else spans.set(t.sent, [t.start, t.end]);
  }
  return spans;
}

/** The inspector entry of one word occurrence; shared by `inspect` and `textWords`. */
function describeWord(
  v: ReadingView,
  t: AnalyzedToken,
  spans: Map<number, [number, number]>,
  w: {
    key: string;
    info: WordInfo | null;
    label: InspectorEntry["label"];
    dict: Dictionary;
    anki: InspectorEntry["anki"];
  },
): InspectorEntry {
  const [s0, s1] = spans.get(t.sent) ?? [t.start, t.end];
  const { glosses, article, glossNote } = composeGlosses(w.info, w.dict[t.lemma], t.pos);
  const entry: InspectorEntry = {
    textId: v.text.id,
    tokenIndex: t.i,
    surface: t.text,
    lemma: t.lemma,
    key: w.key,
    label: w.label,
    state: w.info?.state ?? "unknown",
    pKnown: w.info?.pKnown ?? 0,
    pos: t.pos,
    glosses,
    decks: w.info?.decks ?? [],
    inAnki: w.info?.source === "anki" || w.info?.addedNoteId !== undefined,
    anki: w.anki,
    sentence: v.text.content.slice(s0, s1),
    sentenceHighlight: [t.start - s0, t.end - s0],
  };
  if (article) entry.article = article;
  if (glossNote) entry.glossNote = glossNote;
  if (w.info?.appLearning) entry.appLearning = true;
  return entry;
}

export interface LiveWordsDeps {
  repo: KenningRepository;
  lang: () => Promise<string>;
  anki: (timeoutMs?: number) => Promise<AnkiConnectClient>;
  learner: LearnerCache;
  dictionary: LiveDictionary;
  texts: LiveTexts;
  profile: LiveProfile["current"];
  /** The confirmed Anki sources of the language profile, read from Anki. */
  ankiSnapshot: LiveProfile["snapshot"];
  /** A new Anki snapshot was imported: card glosses and plans are stale. */
  synced: () => void;
}

export function createLiveWords(deps: LiveWordsDeps) {
  const { repo, lang, anki, learner, dictionary, texts } = deps;
  const record = (e: Parameters<typeof repo.append>[0]) => repo.append(e);

  /** The add request for a reader word (used by Add to Anki and Mark known). */
  const addRequest = async (entry: InspectorEntry, opts?: AddOptions) => {
    const v = await texts.view(entry.textId);
    const word =
      entry.article && entry.pos === "NOUN" ? `${entry.article} ${entry.lemma}` : entry.lemma;
    return {
      profile: await deps.profile(),
      // Words from an AI story go to the profile's AI deck, other texts to the reading deck.
      context: {
        source: v?.text.sourceKind === "ai" ? ("ai" as const) : ("reading" as const),
        ...(opts?.deck ? { deck: opts.deck } : {}),
      },
      word,
      key: entry.key,
      sentence: highlightSentence(entry.sentence, ...entry.sentenceHighlight),
      ...(entry.glosses[0] ? { gloss: entry.glosses[0] } : {}),
      ...(entry.sentenceTranslation ? { sentenceTranslation: entry.sentenceTranslation } : {}),
      ...(v ? { source: v.text.title } : {}),
    };
  };

  /** Live Anki state of a word; "unavailable" (with the reason) if Anki cannot answer in time. */
  async function liveAnki(info: WordInfo | null): Promise<InspectorEntry["anki"]> {
    if (!info || info.noteIds.length === 0) return absentAnki(info);
    try {
      const { notes } = await cardStatus(await anki(INSPECT_TIMEOUT_MS), info.noteIds);
      clearDegraded("anki");
      return ankiFromStatus(info, notes);
    } catch (e) {
      reportDegraded("anki", DEGRADED_MESSAGES.anki, e);
      return unavailableAnki(info, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Live Anki state for many words with ONE request; if Anki cannot answer in time every word is
   * "unavailable" (with the reason), so no action is offered that would fail.
   */
  async function liveAnkiBatch(infos: (WordInfo | null)[]): Promise<InspectorEntry["anki"][]> {
    const ids = [...new Set(infos.flatMap((i) => i?.noteIds ?? []))];
    let notes: NoteCardStatus[] = [];
    try {
      const client = await anki(REVIEW_TIMEOUT_MS);
      // With no notes to ask about, a version call still tells whether Anki is reachable.
      if (ids.length) notes = (await cardStatus(client, ids)).notes;
      else if (infos.length) await client.version();
      if (infos.length) clearDegraded("anki");
    } catch (e) {
      reportDegraded("anki", DEGRADED_MESSAGES.anki, e);
      const reason = e instanceof Error ? e.message : String(e);
      return infos.map((i) => unavailableAnki(i, reason));
    }
    const byId = new Map(notes.map((n) => [n.noteId, n]));
    return infos.map((info) =>
      info && info.noteIds.length
        ? ankiFromStatus(
            info,
            info.noteIds.flatMap((id) => byId.get(id) ?? []),
          )
        : absentAnki(info),
    );
  }

  async function inspectWord(key: string): Promise<InspectorEntry> {
    const info = await repo.word(await lang(), key);
    const [dict, ankiState] = await Promise.all([dictionary.dictionaryFor([key]), liveAnki(info)]);
    const pos = info?.article ? "NOUN" : (dict[key]?.[0]?.pos ?? "");
    const { glosses, article } = composeGlosses(info, dict[key], pos);
    const sentence = info?.sentence ?? "";
    const at = sentence.toLocaleLowerCase().indexOf(key.toLocaleLowerCase());
    const entry: InspectorEntry = {
      textId: "",
      tokenIndex: -1,
      surface: key,
      lemma: key,
      key,
      label: "new",
      state: info?.state ?? "unknown",
      pKnown: info?.pKnown ?? 0,
      pos,
      glosses,
      decks: info?.decks ?? [],
      inAnki: info?.source === "anki" || info?.addedNoteId !== undefined,
      anki: ankiState,
      sentence,
      sentenceHighlight: at >= 0 ? [at, at + key.length] : [0, 0],
    };
    if (article) entry.article = article;
    if (info?.appLearning) entry.appLearning = true;
    if (info?.sentenceTranslation) entry.sentenceTranslation = info.sentenceTranslation;
    return entry;
  }

  /**
   * A word without a dictionary meaning (none, or only a guess from its parts) also gets the
   * English it became in the translation of its sentence, when the alignment is confident.
   */
  async function addSentenceMeaning(entry: InspectorEntry): Promise<void> {
    const guessOnly = entry.glosses.length === 0 || entry.glossNote !== undefined;
    if (!guessOnly || !entry.sentence) return;
    const [start, end] = entry.sentenceHighlight;
    const word = { sentence: entry.sentence, start, end };
    const english = (await dictionary.alignWords([word])).get(dictionary.alignKey(word));
    if (!english) return;
    if (entry.glosses.length === 0) {
      entry.glosses = [english];
      entry.glossNote = IN_SENTENCE;
    } else if (!sameMeaning(english, entry.glosses[0]!)) {
      entry.sentenceGloss = english;
    }
  }

  async function addToAnki(entry: InspectorEntry, opts?: AddOptions) {
    const { noteId, deck } = await addWordToAnki(
      await anki(),
      record,
      await addRequest(entry, opts),
    );
    learner.changed();
    return { noteId, deck };
  }

  const services: Pick<
    AppServices,
    | "inspect"
    | "inspectWord"
    | "textWords"
    | "addToAnki"
    | "learnNext"
    | "markKnown"
    | "resetWordState"
    | "setWordState"
    | "syncAnki"
    | "learnerSummary"
    | "words"
    | "activity"
    | "suggestedWords"
    | "addSuggestedToAnki"
    | "dismissSuggestion"
  > = {
    async inspect(textId: string, tokenIndex: number): Promise<InspectorEntry> {
      const v = await texts.view(textId);
      if (!v) throw new Error("Text not found");
      const clicked = v.tokens[tokenIndex];
      if (!clicked) throw new Error("Token not found");
      // A detached particle ("op" in "Ik bel je op") stands for its verb.
      const t = clicked.particle_of !== null ? (v.tokens[clicked.particle_of] ?? clicked) : clicked;
      const l = await lang();
      const m = await learner.model();
      const key = matchToken(t, m) ?? normalizeKey(t.lemma);
      const info = await repo.word(l, key);
      const planned = v.plans.flatMap((p) => p.tokens).find((p) => p.i === t.i);
      const [dict, ankiState] = await Promise.all([
        dictionary.dictionaryFor([t.lemma]),
        liveAnki(info),
      ]);
      const entry = describeWord(v, t, sentenceSpans(v.tokens), {
        key,
        info,
        label: planned?.label ?? "new",
        dict,
        anki: ankiState,
      });
      await addSentenceMeaning(entry);
      const tr = (await dictionary.translateSentences([entry.sentence])).get(entry.sentence);
      if (tr) entry.sentenceTranslation = tr;
      return entry;
    },

    inspectWord,

    async textWords(textId, opts = {}): Promise<TextWordItem[]> {
      const v = await texts.view(textId);
      if (!v) throw new Error("Text not found");
      const l = await lang();
      const looked = new Set(await repo.lookedUpKeys(l, textId));
      // Union in text order: first qualifying occurrence of each key, strongest source wins.
      const picked = new Map<
        string,
        { t: AnalyzedToken; label: TokenLabel; source: TextWordItem["source"] }
      >();
      for (const p of v.plans.flatMap((plan) => plan.tokens)) {
        const t = v.tokens[p.i];
        if (!t || !p.key || p.label === "nonword" || p.label === "ignored") continue;
        // A detached particle stands for its verb, which has its own token.
        if (t.particle_of !== null) continue;
        const source: TextWordItem["source"] | null =
          p.label === "introduce"
            ? "introduce"
            : p.label === "gloss" && opts.includeGlossed
              ? "gloss"
              : looked.has(p.key) && p.label !== "known"
                ? "lookup"
                : null;
        if (!source) continue;
        const have = picked.get(p.key);
        if (!have) picked.set(p.key, { t, label: p.label, source });
        else if (SOURCE_RANK[source] < SOURCE_RANK[have.source]) have.source = source;
      }
      if (picked.size === 0) return [];
      // One read of the learner's words, one dictionary request, one Anki request.
      const infoByKey = new Map((await repo.words(l)).map((w) => [w.key, w]));
      const chosen = [...picked.entries()].filter(([key]) => {
        const state = infoByKey.get(key)?.state;
        return state !== "known" && state !== "ignored";
      });
      const infos = chosen.map(([key]) => infoByKey.get(key) ?? null);
      const dict = await dictionary.dictionaryFor([...new Set(chosen.map(([, c]) => c.t.lemma))]);
      const ankis = await liveAnkiBatch(infos);
      const spans = sentenceSpans(v.tokens);
      const rows = chosen.map(([key, c], n) => {
        const entry = describeWord(v, c.t, spans, {
          key,
          info: infos[n] ?? null,
          label: c.label,
          dict,
          anki: ankis[n]!,
        });
        return {
          key,
          lemma: entry.lemma,
          ...(entry.article ? { article: entry.article } : {}),
          pos: entry.pos,
          glosses: entry.glosses,
          sentence: entry.sentence,
          sentenceHighlight: entry.sentenceHighlight,
          tokenIndex: entry.tokenIndex,
          source: c.source,
          entry,
        };
      });
      // One translation request for all row sentences.
      const translations = await dictionary.translateSentences(rows.map((r) => r.sentence));
      for (const r of rows) {
        const tr = translations.get(r.sentence);
        if (tr) r.entry.sentenceTranslation = tr;
      }
      return rows;
    },

    addToAnki,

    async learnNext(entry: InspectorEntry): Promise<{ deck: string }> {
      const noteId = entry.anki.noteIds[0];
      if (noteId === undefined) throw new Error("This word has no card in Anki");
      await studyWordFirst(await anki(), record, {
        lang: await lang(),
        key: entry.key,
        noteId,
        cardIds: entry.anki.cardIds,
      });
      learner.changed();
      return { deck: entry.anki.deck ?? "" };
    },

    async markKnown(entry: InspectorEntry, opts?: AddOptions): Promise<{ addedToDeck?: string }> {
      if (entry.anki.status === "unavailable") {
        throw new Error(entry.anki.detail ?? "Anki is not reachable");
      }
      const { addedToDeck } = await markWordKnown(await anki(), record, {
        lang: await lang(),
        key: entry.key,
        noteIds: entry.anki.noteIds,
        cardIds: entry.anki.cardIds,
        add: await addRequest(entry, opts),
      });
      learner.changed();
      return addedToDeck ? { addedToDeck } : {};
    },

    async resetWordState(key: string): Promise<void> {
      await resetToAnkiState(record, await lang(), key);
      learner.changed();
    },

    async setWordState(key: string, state: WordState): Promise<void> {
      await setAppWordState(record, await lang(), key, state);
      learner.changed();
    },

    async syncAnki(onProgress?: (msg: string) => void): Promise<LearnerSummary> {
      const l = await lang();
      // The confirmed sources of the language profile, plus destination and course decks.
      const snap = await deps.ankiSnapshot(onProgress);
      await repo.append({
        type: "AnkiSnapshotImported",
        lang: l,
        entries: snap.entries,
        sources: snap.sources.map((s) => s.deck),
      });
      deps.synced();
      return learner.summary();
    },

    learnerSummary: learner.summary,

    async words(opts = {}) {
      const l = await lang();
      if (!opts.keys) return repo.words(l, opts);
      const { keys, limit, offset = 0, ...rest } = opts;
      const wanted = new Set(keys);
      const rows = (await repo.words(l, rest)).filter((w) => wanted.has(w.key));
      return rows.slice(offset, limit === undefined ? undefined : offset + limit);
    },

    async activity(days = 7) {
      const now = Date.now();
      return groupActivity(await repo.activity(activitySince(now, days)), now, days);
    },

    async suggestedWords() {
      return repo.suggestedWords(await lang());
    },

    async addSuggestedToAnki(key, opts) {
      const l = await lang();
      const s = (await repo.suggestedWords(l)).find((x) => x.key === key);
      if (!s) throw new Error("That suggestion is gone.");
      const entry = suggestionEntry(await inspectWord(key), s);
      const added = await addToAnki(entry, opts);
      await repo.append({ type: "WordSuggestionDismissed", lang: l, key });
      return added;
    },

    async dismissSuggestion(key) {
      await repo.append({ type: "WordSuggestionDismissed", lang: await lang(), key });
    },
  };

  return { services };
}
