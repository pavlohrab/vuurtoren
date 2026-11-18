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
import { applyCourseEvent } from "./course.js";
import { contentHash } from "./hash.js";
import { compareHlc } from "./ids.js";
import type { AnkiWordEntry, AppEvent, SqlDriver, SqlValue, WordInfo } from "./types.js";

/** An event plus the metadata the projections need. */
export interface EventContext {
  id: string;
  hlc: string;
  /** Wall-clock ms the event was appended (from the events table, so replays are stable). */
  createdAt: number;
  event: AppEvent;
}

export type Row = Record<string, SqlValue>;

/** pKnown assigned to words that were only looked up (state "seen"). */
export const SEEN_P_KNOWN = 0.1;
/** pKnown for a word whose Anki note was created by the app but not yet in a snapshot. */
export const NOTE_ADDED_P_KNOWN = 0.2;
/** Minimum pKnown for a word the user manually marked known. */
export const MARKED_KNOWN_P_KNOWN = 0.95;
/** pKnown for a manually "learning" word with no Anki learning evidence. */
export const MARKED_LEARNING_P_KNOWN = 0.3;

/** Word count = number of Unicode letter runs. */
export function countWords(content: string): number {
  return content.match(/\p{L}+/gu)?.length ?? 0;
}

const CHUNK = 100;

/** Multi-row INSERT in chunks (keeps worker round trips low for big Anki snapshots). */
async function insertMany(
  driver: SqlDriver,
  head: string,
  cols: number,
  rows: readonly SqlValue[][],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const ph = `(${Array(cols).fill("?").join(",")})`;
    await driver.exec(`${head} VALUES ${Array(chunk.length).fill(ph).join(",")}`, chunk.flat());
  }
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
 * Add one answer to a word's app evidence (ADR 0011). Sums and "newest answer" are combined in
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
      for (const t of ["text_tokens", "text_grammar"]) {
        await driver.exec(`DELETE FROM ${t} WHERE text_id = ? AND content_hash <> ?`, [
          e.textId,
          hash,
        ]);
      }
      return;
    }
    case "TextGrammarDetected": {
      const rows = await driver.exec("SELECT content_hash FROM texts WHERE id = ?", [e.textId]);
      if (rows[0]?.["content_hash"] !== e.contentHash) return;
      await driver.exec(
        "INSERT OR REPLACE INTO text_grammar (text_id, content_hash, version, hits) VALUES (?,?,?,?)",
        [e.textId, e.contentHash, e.version, JSON.stringify(e.hits)],
      );
      return;
    }
    case "TextAnalyzed": {
      const rows = await driver.exec("SELECT content_hash FROM texts WHERE id = ?", [e.textId]);
      // Ignore results for unknown texts or for content that has since changed.
      if (rows[0]?.["content_hash"] !== e.contentHash) return;
      await driver.exec(
        "INSERT OR REPLACE INTO text_tokens (text_id, content_hash, tokens) VALUES (?,?,?)",
        [e.textId, e.contentHash, JSON.stringify(e.tokens)],
      );
      return;
    }
    case "TextDeleted":
      for (const t of ["texts", "text_tokens", "text_grammar", "reading_progress"]) {
        await driver.exec(`DELETE FROM ${t} WHERE ${t === "texts" ? "id" : "text_id"} = ?`, [
          e.textId,
        ]);
      }
      return;
    case "AnkiSnapshotImported": {
      await driver.exec("DELETE FROM anki_words WHERE lang = ?", [e.lang]);
      await insertMany(
        driver,
        "INSERT OR REPLACE INTO anki_words (lang, key, state, p_known, note_ids, decks, gloss, article, sentence, sentence_translation)",
        10,
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
        `INSERT INTO word_lookups (lang, key, count) VALUES (?,?,1)
         ON CONFLICT(lang, key) DO UPDATE SET count = count + 1`,
        [e.lang, e.key],
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
    case "StaircaseUpdated":
      await driver.exec("INSERT OR REPLACE INTO staircase (lang, state) VALUES (?,?)", [
        e.lang,
        JSON.stringify(e.state satisfies StaircaseState),
      ]);
      return;
    case "SentencesGenerated":
    case "ExamAttempt":
    case "UnitExercisesGenerated":
      // Read straight from the event log (see generated.ts, exam.ts, course.ts): no table.
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
    default: {
      // An event written by a newer app version (or a future sync peer). It stays in the log
      // untouched and is skipped here, so an older app can still open the database instead of
      // failing the whole rebuild. Appends of unknown types are rejected earlier (rpc.ts).
      const unknown: never = e;
      console.warn(
        `[kenning-db] skipping unknown event type ${(unknown as { type?: unknown }).type}`,
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
  note?: { noteId: number; deck: string };
  /** Note whose card(s) "Learn next" moved to the front. */
  prioritizedNoteId?: number;
  /** The override was set by "Mark known" (written to Anki too). */
  markedKnownInAnki?: boolean;
  /** Answers given in Kenning (ADR 0011). */
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
 * App evidence (ADR 0011, `withAppEvidence`) is overlaid on everything below a manual override:
 * it can raise pKnown and turn an unknown / seen / absent word into "learning" ("Learning (in
 * Kenning)"), but never touches known or ignored words and never makes a word known.
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
