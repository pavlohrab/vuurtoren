/**
 * Words: the inspector entry of a word (with its live Anki state), the words of a text, the
 * Words list, word actions (Add to Anki, study first, mark known, word state), the Anki sync
 * and Claude's suggested words.
 */
import {
  type AnkiConnectClient,
  type NoteCardStatus,
  addWord,
  cardStatus,
  highlightSentence,
  markKnown,
  resetToAnkiState,
  setAppWordState,
  studyFirst,
} from "@app/anki";
import {
  type AnalyzedToken,
  type WordState,
  matchToken,
  normalizeKey,
  profileMode,
} from "@app/core";
import type { KenningRepository, WordInfo } from "@app/db";
import { activitySince, firstCard, groupActivity, knownByWeek } from "./activity.js";
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
import { pickTextWords } from "./textWordSet.js";
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

  /** Native mode: Kenning holds the cards (read from the database, never from Anki). */
  const native = async (): Promise<boolean> => profileMode(await deps.profile()) === "native";

  /** The state of words' cards in native mode, shaped like the live Anki state. */
  async function nativeCards(infos: (WordInfo | null)[]): Promise<InspectorEntry["anki"][]> {
    const ids = [...new Set(infos.flatMap((i) => i?.noteIds ?? []))];
    const notes = await repo.nativeNoteStatus(await lang(), ids, Date.now());
    const byId = new Map(notes.map((n) => [n.noteId, n]));
    return infos.map((info) => ({
      ...(info && info.noteIds.length
        ? ankiFromStatus(
            info,
            info.noteIds.flatMap((id) => byId.get(id) ?? []),
          )
        : absentAnki(info)),
      native: true,
    }));
  }

  /** Live Anki state of a word; "unavailable" (with the reason) if Anki cannot answer in time. */
  async function liveAnki(info: WordInfo | null): Promise<InspectorEntry["anki"]> {
    if (await native()) return (await nativeCards([info]))[0]!;
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
    if (await native()) return nativeCards(infos);
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
   * English it became in the translation of its sentence. A confident alignment ranks above a
   * compound guess (it becomes the first meaning); below a derivation it is a second line. A
   * less confident one is used only when there is nothing else.
   */
  async function addSentenceMeaning(
    entry: InspectorEntry,
    guess: "derivation" | "compound" | undefined,
  ): Promise<void> {
    if ((entry.glosses.length > 0 && !guess) || !entry.sentence) return;
    const [start, end] = entry.sentenceHighlight;
    const word = { sentence: entry.sentence, start, end };
    const aligned = (await dictionary.alignWords([word])).get(dictionary.alignKey(word));
    if (!aligned) return;
    const first = entry.glosses[0];
    if (first === undefined) {
      entry.glosses = [aligned.text];
      entry.glossNote = IN_SENTENCE;
    } else if (aligned.confident && !sameMeaning(aligned.text, first)) {
      if (guess === "compound") {
        entry.glosses = [aligned.text, ...entry.glosses];
        entry.glossNote = IN_SENTENCE;
      } else {
        entry.sentenceGloss = aligned.text;
      }
    }
  }

  async function addToAnki(entry: InspectorEntry, opts?: AddOptions) {
    const { noteId, deck } = await addWord(anki, record, await addRequest(entry, opts));
    learner.changed();
    return { noteId, deck };
  }

  const services: Pick<
    AppServices,
    | "inspect"
    | "inspectWord"
    | "textWords"
    | "wordsToDecide"
    | "addToAnki"
    | "learnNext"
    | "markKnown"
    | "resetWordState"
    | "setWordState"
    | "syncAnki"
    | "learnerSummary"
    | "words"
    | "activity"
    | "knownOverTime"
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
      await addSentenceMeaning(entry, composeGlosses(info, dict[t.lemma], t.pos).guess);
      const tr = (await dictionary.translateSentences([entry.sentence])).get(entry.sentence);
      if (tr) entry.sentenceTranslation = tr;
      return entry;
    },

    inspectWord,

    async textWords(textId): Promise<TextWordItem[]> {
      const v = await texts.view(textId);
      if (!v) throw new Error("Text not found");
      const l = await lang();
      const picked = pickTextWords(v, new Set(await repo.lookedUpKeys(l, textId)));
      if (picked.length === 0) return [];
      // One read of the learner's words, one dictionary request, one Anki request.
      const infoByKey = new Map((await repo.words(l)).map((w) => [w.key, w]));
      const labelAt = new Map(v.plans.flatMap((p) => p.tokens).map((p) => [p.i, p.label]));
      const chosen = picked.map((c) => ({ ...c, t: v.tokens[c.tokenIndex]! }));
      const infos = chosen.map((c) => infoByKey.get(c.key) ?? null);
      const dict = await dictionary.dictionaryFor([...new Set(chosen.map((c) => c.t.lemma))]);
      const ankis = await liveAnkiBatch(infos);
      const spans = sentenceSpans(v.tokens);
      const rows = chosen.map((c, n) => {
        const key = c.key;
        const entry = describeWord(v, c.t, spans, {
          key,
          info: infos[n] ?? null,
          label: labelAt.get(c.tokenIndex) ?? "new",
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

    async wordsToDecide({ limit } = {}) {
      const l = await lang();
      const list = (await repo.listTexts())
        .filter((t) => t.analyzed)
        .sort((a, b) => b.createdAt - a.createdAt);
      const keys = new Set<string>();
      for (const t of list) {
        const v = await texts.view(t.id);
        if (v) for (const w of pickTextWords(v, new Set())) keys.add(w.key);
      }
      const infos = new Map((await repo.wordsByKeys(l, [...keys])).map((w) => [w.key, w]));
      const open = [...keys]
        .filter((k) => {
          const i = infos.get(k);
          return !i || (i.noteIds.length === 0 && i.state !== "ignored" && i.state !== "known");
        })
        .slice(0, limit);
      const dict = await dictionary.dictionaryFor(open);
      return open.map((key): WordInfo => {
        const info = infos.get(key) ?? null;
        const { glosses, article } = composeGlosses(info, dict[key], "");
        return {
          ...(info ?? {
            key,
            state: "unknown",
            pKnown: 0,
            source: "app",
            decks: [],
            lookups: 0,
            noteIds: [],
          }),
          ...(glosses[0] ? { gloss: glosses[0] } : {}),
          ...(article ? { article } : {}),
        };
      });
    },

    addToAnki,

    async learnNext(entry: InspectorEntry): Promise<{ deck: string }> {
      const noteId = entry.anki.noteIds[0];
      if (noteId === undefined) throw new Error("This word has no card in Anki");
      await studyFirst(await native(), anki, record, {
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
      const { addedToDeck } = await markKnown(await native(), anki, record, {
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

    async knownOverTime(weeks = 12) {
      const known = await repo.words(await lang(), { state: "known" });
      return knownByWeek(
        known.map((w) => firstCard(w.noteIds)),
        Date.now(),
        weeks,
      );
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
