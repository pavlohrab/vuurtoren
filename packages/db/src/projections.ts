/**
 * Event -> projection logic. `applyEvent` is the only code that writes projection tables;
 * it is used both for live appends and for `rebuild()` replays, so the two cannot diverge.
 * `composeWord` is the pure rule for the effective state of a word.
 */
import {
  type AppEvidence,
  type StaircaseState,
  type WordState,
  answerEvidence,
  withAppEvidence,
} from "@app/core";
import { applyNativeEvent } from "./cards.js";
import { applyCourseEvent } from "./course.js";
import { insertMany } from "./driver-core.js";
import { contentHash } from "./hash.js";
import { compareHlc } from "./ids.js";
import { applyTextMeta, metaPatchFields } from "./library.js";
import type {
  AnkiWordEntry,
  AppEvent,
  SqlDriver,
  SqlValue,
  TextExtras,
  WordInfo,
} from "./types.js";
import { canApply } from "./types.js";

/** An event plus the metadata the projections need. */
export interface EventContext {
  id: string;
  hlc: string;
  /** Wall-clock ms the event was appended (from the events table, so replays are stable). */
  createdAt: number;
  /** Payload version (absent: 1). An event newer than this app understands is not applied. */
  v?: number;
  event: AppEvent;
}

export type Row = Record<string, SqlValue>;

/** pKnown assigned to words that were only looked up (state "seen"). */
const SEEN_P_KNOWN = 0.1;
/** pKnown for a word whose Anki note was created by the app but not yet in a snapshot. */
const NOTE_ADDED_P_KNOWN = 0.2;
/** Minimum pKnown for a word the user manually marked known. */
const MARKED_KNOWN_P_KNOWN = 0.95;
/** pKnown for a manually "learning" word with no Anki learning evidence. */
const MARKED_LEARNING_P_KNOWN = 0.3;

/** Word count = number of Unicode letter runs. */
export function countWords(content: string): number {
  return content.match(/\p{L}+/gu)?.length ?? 0;
}

/** A language-server analysis of one text version (see `VuurtorenRepository.saveTextAnalysis`). */
interface TextAnalysisInput {
  textId: string;
  contentHash: string;
  tokens: unknown[];
  analyzerVersion?: string | null | undefined;
}

/** Grammar hits found in one text version (see `VuurtorenRepository.saveTextGrammar`). */
interface TextGrammarInput {
  textId: string;
  contentHash: string;
  version: number;
  hits: unknown[];
}

async function currentHash(driver: SqlDriver, textId: string): Promise<SqlValue | undefined> {
  return (await driver.exec("SELECT content_hash FROM texts WHERE id = ?", [textId]))[0]?.[
    "content_hash"
  ];
}

/**
 * Write an analysis made at `at` into the analysis cache (one row per text). Ignored for unknown
 * texts, for content that has since changed, and, for an old TextAnalyzed event (`local`
 * false), when the cache holds a newer analysis of the same content. A `local` analysis (this
 * device's language server, just now) always wins and is stamped after the one it replaces, so
 * a replayed event can never overwrite it, whatever the other device's clock said.
 * @returns true when stored
 */
export async function writeTextAnalysis(
  driver: SqlDriver,
  a: TextAnalysisInput,
  at: number,
  local = false,
): Promise<boolean> {
  if ((await currentHash(driver, a.textId)) !== a.contentHash) return false;
  const version = a.analyzerVersion ?? null;
  const old = (
    await driver.exec(
      "SELECT content_hash, analyzer_version, analyzed_at FROM text_tokens WHERE text_id = ?",
      [a.textId],
    )
  )[0];
  const sameContent = old !== undefined && old["content_hash"] === a.contentHash;
  const before = sameContent ? Number(old["analyzed_at"]) : 0;
  if (!local && before > at) return false;
  const stamp = local ? Math.max(at, before + 1) : at;
  // Another analyzer may shift token indices: the grammar hits refer to the old tokens, so they
  // are dropped and recomputed (liveGrammar).
  if (old && (old["analyzer_version"] ?? null) !== version) {
    await driver.exec("DELETE FROM text_grammar WHERE text_id = ?", [a.textId]);
  }
  await driver.exec(
    "INSERT OR REPLACE INTO text_tokens (text_id, content_hash, tokens, analyzer_version, analyzed_at) VALUES (?,?,?,?,?)",
    [a.textId, a.contentHash, JSON.stringify(a.tokens), version, stamp],
  );
  return true;
}

/**
 * Write grammar hits found at `at` into the analysis cache. They refer to the cached tokens, so
 * they are stored only when those tokens are of the same content and, for an old
 * TextGrammarDetected event (`local` false), not newer than the hits; never over hits of a newer
 * grammar version.
 * @returns true when stored
 */
export async function writeTextGrammar(
  driver: SqlDriver,
  g: TextGrammarInput,
  at: number,
  local = false,
): Promise<boolean> {
  if ((await currentHash(driver, g.textId)) !== g.contentHash) return false;
  const tokens = (
    await driver.exec("SELECT content_hash, analyzed_at FROM text_tokens WHERE text_id = ?", [
      g.textId,
    ])
  )[0];
  if (!tokens || tokens["content_hash"] !== g.contentHash) return false;
  if (!local && Number(tokens["analyzed_at"]) > at) return false;
  const old = (
    await driver.exec("SELECT content_hash, version FROM text_grammar WHERE text_id = ?", [
      g.textId,
    ])
  )[0];
  if (old && old["content_hash"] === g.contentHash && Number(old["version"]) > g.version) {
    return false;
  }
  await driver.exec(
    "INSERT OR REPLACE INTO text_grammar (text_id, content_hash, version, hits) VALUES (?,?,?,?)",
    [g.textId, g.contentHash, g.version, JSON.stringify(g.hits)],
  );
  return true;
}

/**
 * Write a text's extras. They index the cached tokens, so they are stored only for the text's
 * current content and the analyzer of its stored tokens, and never over newer extras.
 * @returns true when stored
 */
export async function writeTextExtras(driver: SqlDriver, x: TextExtras): Promise<boolean> {
  if ((await currentHash(driver, x.textId)) !== x.contentHash) return false;
  const tokens = (
    await driver.exec("SELECT content_hash, analyzer_version FROM text_tokens WHERE text_id = ?", [
      x.textId,
    ])
  )[0];
  if (!tokens || tokens["content_hash"] !== x.contentHash) return false;
  if ((tokens["analyzer_version"] ?? null) !== (x.analyzerVersion ?? null)) return false;
  const old = (
    await driver.exec("SELECT content_hash, made_at FROM text_extras WHERE text_id = ?", [x.textId])
  )[0];
  if (old && old["content_hash"] === x.contentHash && Number(old["made_at"]) > x.madeAt) {
    return false;
  }
  await driver.exec(
    "INSERT OR REPLACE INTO text_extras (text_id, content_hash, analyzer_version, made_at, data) VALUES (?,?,?,?,?)",
    [
      x.textId,
      x.contentHash,
      x.analyzerVersion ?? null,
      x.madeAt,
      JSON.stringify(
        x.mtModel || x.glosses
          ? {
              sentences: x.sentences,
              ...(x.mtModel ? { mtModel: x.mtModel } : {}),
              ...(x.glosses ? { glosses: x.glosses } : {}),
            }
          : x.sentences,
      ),
    ],
  );
  return true;
}

/** Last-write-wins (by HLC, independent of arrival order) write of a word's manual state. */
async function setOverride(
  driver: SqlDriver,
  hlc: string,
  lang: string,
  key: string,
  state: WordState | "",
  markedInAnki: boolean,
): Promise<void> {
  const rows = await driver.exec(
    "SELECT updated_hlc FROM word_overrides WHERE lang = ? AND key = ?",
    [lang, key],
  );
  const prev = rows[0]?.["updated_hlc"];
  if (typeof prev === "string" && compareHlc(prev, hlc) >= 0) return;
  await driver.exec(
    "INSERT OR REPLACE INTO word_overrides (lang, key, state, updated_hlc, marked_anki) VALUES (?,?,?,?,?)",
    [lang, key, state, hlc, markedInAnki ? 1 : 0],
  );
}

/**
 * Add one answer to a word's app evidence. Sums and "newest answer" are combined in
 * SQL so the result is the same whatever order the events are applied in.
 */
async function addEvidence(
  driver: SqlDriver,
  lang: string,
  key: string,
  ev: AppEvidence,
): Promise<void> {
  if (!key) return;
  await driver.exec(
    `INSERT INTO word_evidence (lang, key, correct, wrong, last_at, last_correct) VALUES (?,?,?,?,?,?)
     ON CONFLICT(lang, key) DO UPDATE SET
       correct = correct + excluded.correct,
       wrong = wrong + excluded.wrong,
       last_correct = CASE
         WHEN excluded.last_at > last_at THEN excluded.last_correct
         WHEN excluded.last_at < last_at THEN last_correct
         ELSE min(last_correct, excluded.last_correct) END,
       last_at = max(last_at, excluded.last_at)`,
    [lang, key, ev.correct, ev.wrong, ev.lastAt, ev.lastCorrect ? 1 : 0],
  );
}

/** Apply one event to the projection tables. Must run inside a transaction. */
export async function applyEvent(driver: SqlDriver, ctx: EventContext): Promise<void> {
  const e = ctx.event;
  if (!canApply(e.type, ctx.v ?? 1)) return;
  switch (e.type) {
    case "TextImported": {
      const hash = contentHash(e.content);
      await driver.exec(
        `INSERT INTO texts (id, title, lang, source_kind, source_ref, content, content_hash, word_count, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, lang=excluded.lang,
           source_kind=excluded.source_kind, source_ref=excluded.source_ref,
           content=excluded.content, content_hash=excluded.content_hash,
           word_count=excluded.word_count`,
        [
          e.textId,
          e.title,
          e.lang,
          e.source.kind,
          e.source.ref ?? (e.source.kind === "ai" ? e.source.topic : null),
          e.content,
          hash,
          countWords(e.content),
          ctx.createdAt,
        ],
      );
      // Tokens and grammar hits computed for different content are stale.
      for (const t of ["text_tokens", "text_grammar", "text_extras"]) {
        await driver.exec(`DELETE FROM ${t} WHERE text_id = ? AND content_hash <> ?`, [
          e.textId,
          hash,
        ]);
      }
      return;
    }
    // Analyses held in the log fill the analysis cache. Vuurtoren writes analyses to the cache
    // directly, never as events (`saveTextAnalysis`).
    case "TextGrammarDetected":
      await writeTextGrammar(driver, e, ctx.createdAt);
      return;
    case "TextAnalyzed":
      await writeTextAnalysis(driver, e, ctx.createdAt);
      return;
    case "TextMetaUpdated":
      await applyTextMeta(driver, ctx.hlc, e.textId, metaPatchFields(e.patch ?? {}));
      return;
    case "TextCoverSet":
      await applyTextMeta(driver, ctx.hlc, e.textId, { cover: e.blobId ?? null });
      return;
    case "TextDeleted":
      for (const t of [
        "texts",
        "text_meta",
        "text_tokens",
        "text_grammar",
        "text_extras",
        "reading_progress",
        "reading_place",
      ]) {
        await driver.exec(`DELETE FROM ${t} WHERE ${t === "texts" ? "id" : "text_id"} = ?`, [
          e.textId,
        ]);
      }
      return;
    case "AnkiSnapshotImported": {
      await driver.exec("DELETE FROM anki_words WHERE lang = ?", [e.lang]);
      await insertMany(
        driver,
        "INSERT OR REPLACE INTO anki_words (lang, key, state, p_known, note_ids, decks, gloss, article, sentence, sentence_translation, last_review)",
        11,
        e.entries.map((a) => [
          e.lang,
          a.key,
          a.state,
          a.pKnown,
          JSON.stringify(a.noteIds),
          JSON.stringify(a.decks),
          a.gloss ?? null,
          a.article ?? null,
          a.sentence ?? null,
          a.sentenceTranslation ?? null,
          a.lastReviewMs ?? null,
        ]),
      );
      await driver.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)", [
        `snapshot:${e.lang}`,
        JSON.stringify({ at: ctx.createdAt, sources: e.sources }),
      ]);
      return;
    }
    case "ExerciseAnswered": {
      await addEvidence(driver, e.lang, e.key, answerEvidence("practice", e.correct, e.at));
      // Every answer, for the Elo replay (a hinted right answer counts half).
      await driver.exec(
        "INSERT OR IGNORE INTO practice_answers (id, lang, key, kind, result, at) VALUES (?,?,?,?,?,?)",
        [ctx.id, e.lang, e.key, e.kind, e.correct ? (e.grade === "hard" ? 0.5 : 1) : 0, e.at],
      );
      // Keep the newest answer per (key, skill), independent of arrival order.
      const rows = await driver.exec(
        "SELECT at FROM practice_items WHERE lang = ? AND key = ? AND skill = ?",
        [e.lang, e.key, e.skill],
      );
      if (rows[0] && Number(rows[0]["at"]) > e.at) return;
      await driver.exec(
        "INSERT OR REPLACE INTO practice_items (lang, key, skill, state, at) VALUES (?,?,?,?,?)",
        [e.lang, e.key, e.skill, JSON.stringify(e.state), e.at],
      );
      return;
    }
    case "WordStateSet":
      await setOverride(driver, ctx.hlc, e.lang, e.key, e.state, false);
      return;
    case "MarkedKnownInAnki":
      await setOverride(driver, ctx.hlc, e.lang, e.key, "known", true);
      return;
    case "WordStateCleared":
      // A tombstone (empty state) rather than a DELETE, so last-write-wins still holds when
      // events arrive out of order.
      await setOverride(driver, ctx.hlc, e.lang, e.key, "", false);
      return;
    case "CardsPrioritized":
      await driver.exec("INSERT OR REPLACE INTO prioritized (lang, key, note_id) VALUES (?,?,?)", [
        e.lang,
        e.key,
        e.noteId,
      ]);
      return;
    case "WordLookedUp":
      await driver.exec(
        `INSERT INTO word_lookups (lang, key, count, last_at) VALUES (?,?,1,?)
         ON CONFLICT(lang, key) DO UPDATE SET count = count + 1,
           last_at = max(last_at, excluded.last_at)`,
        [e.lang, e.key, ctx.createdAt],
      );
      return;
    case "ClozeAnswered":
      await addEvidence(driver, e.lang, e.key, answerEvidence("cloze", e.correct, e.at, e.hinted));
      return;
    case "NoteAddedToAnki":
      await driver.exec(
        "INSERT OR REPLACE INTO notes_added (lang, key, note_id, deck) VALUES (?,?,?,?)",
        [e.lang, e.key, e.noteId, e.deck],
      );
      return;
    case "ReadingProgress": {
      // Progress for a deleted/unknown text is dropped (keeps replays free of orphans).
      const rows = await driver.exec("SELECT 1 AS x FROM texts WHERE id = ?", [e.textId]);
      if (rows.length === 0) return;
      // The event records the segment that was just finished; the projection stores the NEXT
      // segment to read (finished + 1), so resuming never re-reads a finished segment. A text
      // is finished when last_segment >= its segment count (the UI clamps to the last one).
      await driver.exec(
        "INSERT OR REPLACE INTO reading_progress (text_id, last_segment, updated) VALUES (?,?,?)",
        [e.textId, e.segment + 1, ctx.createdAt],
      );
      return;
    }
    case "ReadingPlace": {
      const rows = await driver.exec("SELECT 1 AS x FROM texts WHERE id = ?", [e.textId]);
      if (rows.length === 0) return;
      await driver.exec(
        "INSERT OR REPLACE INTO reading_place (text_id, segment, char, updated) VALUES (?,?,?,?)",
        [e.textId, e.segment, e.char, ctx.createdAt],
      );
      return;
    }
    case "StaircaseUpdated":
      await driver.exec("INSERT OR REPLACE INTO staircase (lang, state) VALUES (?,?)", [
        e.lang,
        JSON.stringify(e.state satisfies StaircaseState),
      ]);
      return;
    case "SentencesGenerated":
    case "WordSuggested":
    case "WordSuggestionDismissed":
    case "ExamAttempt":
    case "ShelfCreated":
    case "ShelfRenamed":
    case "ShelfDeleted":
    case "ShelfTextAdded":
    case "ShelfTextRemoved":
    case "UnitExercisesGenerated":
      // Read straight from the event log (see generated.ts, suggested.ts, exam.ts, course.ts): no table.
      return;
    case "ConversationStarted":
    case "MessageAdded":
      // Conversations are read straight from the event log (see conversations.ts): no table.
      return;
    case "SettingChanged":
      await driver.exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)", [
        e.key,
        JSON.stringify(e.value ?? null),
      ]);
      return;
    case "LanguageProfileSet": {
      // Last write wins by HLC, independent of arrival order.
      const rows = await driver.exec("SELECT updated_hlc FROM language_profiles WHERE lang = ?", [
        e.profile.lang,
      ]);
      const prev = rows[0]?.["updated_hlc"];
      if (typeof prev === "string" && compareHlc(prev, ctx.hlc) >= 0) return;
      await driver.exec(
        "INSERT OR REPLACE INTO language_profiles (lang, profile, updated_hlc) VALUES (?,?,?)",
        [e.profile.lang, JSON.stringify(e.profile), ctx.hlc],
      );
      return;
    }
    case "CourseImported":
    case "CourseDeleted":
    case "UnitDefined":
    case "UnitEdited":
    case "BlocksExtracted":
    case "BookExerciseExtracted":
    case "BookExerciseEdited":
    case "UnitWordsSet":
      await applyCourseEvent(driver, ctx.createdAt, e);
      return;
    case "BookExerciseAnswered":
      await applyCourseEvent(driver, ctx.createdAt, e);
      if (e.lang) {
        for (const key of new Set(e.keys ?? [])) {
          await addEvidence(driver, e.lang, key, answerEvidence("book", e.correct, e.at));
        }
      }
      return;
    case "NativeNotesAdded":
    case "NativeNotesRemoved":
    case "NativeDeckOptionsSet":
    case "CardReviewed":
    case "CardReviewUndone":
    case "NativeCardsChanged":
    case "FsrsParamsSet":
      await applyNativeEvent(driver, ctx, e);
      return;
    default: {
      // An event written by a newer app version (or a future sync peer). It stays in the log
      // untouched and is skipped here, so an older app can still open the database instead of
      // failing the whole rebuild.
      const unknown: never = e;
      console.warn(
        `[vuurtoren-db] skipping unknown event type ${(unknown as { type?: unknown }).type}`,
      );
      return;
    }
  }
}

/** Raw per-word facts gathered from the projection tables. */
export interface WordFacts {
  anki?: AnkiWordEntry;
  override?: WordState;
  lookups: number;
  /** When the word was last tapped (ms), 0 if never or before this was recorded. */
  lastLookupAt?: number;
  note?: { noteId: number; deck: string };
  /** Note whose card(s) "Learn next" moved to the front. */
  prioritizedNoteId?: number;
  /** The override was set by "Mark known" (written to Anki too). */
  markedKnownInAnki?: boolean;
  /** Answers given in Vuurtoren. */
  evidence?: AppEvidence;
}

/**
 * Effective word info, or null if nothing is known about the word.
 *
 * Precedence: manual override > Anki snapshot > app-created or prioritised note ("learning", 0.2) >
 * looked-up only ("seen", 0.1).
 * - known: pKnown = max(anki pKnown, 0.95); ignored: 1; unknown: 0; seen: 0.1
 * - learning: keep the Anki pKnown if Anki also says "learning", otherwise 0.3
 *
 * App evidence (`withAppEvidence`) is overlaid on everything below a manual override:
 * it can raise pKnown and turn an unknown / seen / absent word into "learning" ("Learning (in
 * Vuurtoren)"), but never touches known or ignored words and never makes a word known.
 * `nowMs` only affects how much old evidence has faded.
 */
export function composeWord(
  key: string,
  f: WordFacts,
  nowMs: number = Date.now(),
): WordInfo | null {
  const { anki, override, note, lookups } = f;
  const prioritized = f.prioritizedNoteId !== undefined;
  // Anki changes the app caused (added note, moved card) that its snapshot cannot show yet.
  const pending = note !== undefined || prioritized;
  let state: WordState;
  let pKnown: number;
  let source: "anki" | "app";
  if (override) {
    source = "app";
    state = override;
    switch (override) {
      case "known":
        pKnown = Math.max(anki?.pKnown ?? 0, MARKED_KNOWN_P_KNOWN);
        break;
      case "ignored":
        pKnown = 1;
        break;
      case "learning":
        pKnown = anki?.state === "learning" ? anki.pKnown : MARKED_LEARNING_P_KNOWN;
        break;
      case "seen":
        pKnown = SEEN_P_KNOWN;
        break;
      default:
        pKnown = 0;
    }
  } else if (anki && !(pending && anki.state === "unknown")) {
    // (A note added or prioritised from the app stays "learning" until Anki has real evidence:
    // the next snapshot still lists the card as new, which must not demote the word.)
    source = "anki";
    state = anki.state;
    pKnown = anki.pKnown;
  } else if (pending) {
    source = "app";
    state = "learning";
    pKnown = NOTE_ADDED_P_KNOWN;
  } else if (lookups > 0) {
    source = "app";
    state = "seen";
    pKnown = SEEN_P_KNOWN;
  } else if (f.evidence) {
    source = "app";
    state = "unknown";
    pKnown = 0;
  } else {
    return null;
  }
  let appLearning = false;
  if (f.evidence && !override) {
    // A word that only has evidence starts from "nothing known" (withAppEvidence makes it seen).
    const base = source === "app" && state === "unknown" ? undefined : { state, pKnown };
    const r = withAppEvidence(base, f.evidence, nowMs);
    state = r.state;
    pKnown = r.pKnown;
    appLearning = r.appLearning;
  }
  const decks = [...(anki?.decks ?? [])];
  if (note && !decks.includes(note.deck)) decks.push(note.deck);
  const info: WordInfo = { key, state, pKnown, source, decks, lookups, noteIds: [] };
  if (f.lastLookupAt) info.lastLookupAt = f.lastLookupAt;
  if (anki?.lastReviewMs) info.ankiLastReview = anki.lastReviewMs;
  if (anki?.gloss) info.gloss = anki.gloss;
  if (anki?.article) info.article = anki.article;
  if (anki?.sentence) info.sentence = anki.sentence;
  if (anki?.sentenceTranslation) info.sentenceTranslation = anki.sentenceTranslation;
  if (note) info.addedNoteId = note.noteId;
  const noteIds = [...(anki?.noteIds ?? [])];
  for (const id of [note?.noteId, f.prioritizedNoteId]) {
    if (id !== undefined && !noteIds.includes(id)) noteIds.push(id);
  }
  info.noteIds = noteIds;
  if (prioritized) info.prioritized = true;
  if (override) {
    info.overridden = true;
    if (override === "known" && f.markedKnownInAnki) info.markedKnownInAnki = true;
  }
  if (f.evidence) {
    const { correct, wrong, lastAt } = f.evidence;
    info.evidence = { correct, wrong, lastAt };
  }
  if (appLearning) info.appLearning = true;
  return info;
}
