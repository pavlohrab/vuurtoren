/**
 * Event -> projection logic. `applyEvent` is the only code that writes projection tables;
 * it is used both for live appends and for `rebuild()` replays, so the two cannot diverge.
 * `composeWord` is the pure rule for the effective state of a word.
 */
import type { StaircaseState, WordState } from "@app/core";
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
          e.source.ref ?? null,
          e.content,
          hash,
          countWords(e.content),
          ctx.createdAt,
        ],
      );
      // Tokens computed for different content are stale.
      await driver.exec("DELETE FROM text_tokens WHERE text_id = ? AND content_hash <> ?", [
        e.textId,
        hash,
      ]);
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
      for (const t of ["texts", "text_tokens", "reading_progress"]) {
        await driver.exec(`DELETE FROM ${t} WHERE ${t === "texts" ? "id" : "text_id"} = ?`, [
          e.textId,
        ]);
      }
      return;
    case "AnkiSnapshotImported": {
      await driver.exec("DELETE FROM anki_words WHERE lang = ?", [e.lang]);
      await insertMany(
        driver,
        "INSERT OR REPLACE INTO anki_words (lang, key, state, p_known, note_ids, decks, gloss, article)",
        8,
        e.entries.map((a) => [
          e.lang,
          a.key,
          a.state,
          a.pKnown,
          JSON.stringify(a.noteIds),
          JSON.stringify(a.decks),
          a.gloss ?? null,
          a.article ?? null,
        ]),
      );
      await driver.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)", [
        `snapshot:${e.lang}`,
        JSON.stringify({ at: ctx.createdAt, sources: e.sources }),
      ]);
      return;
    }
    case "WordStateSet": {
      // Last-write-wins by HLC, independent of arrival order (sync-safe).
      const rows = await driver.exec(
        "SELECT updated_hlc FROM word_overrides WHERE lang = ? AND key = ?",
        [e.lang, e.key],
      );
      const prev = rows[0]?.["updated_hlc"];
      if (typeof prev === "string" && compareHlc(prev, ctx.hlc) >= 0) return;
      await driver.exec(
        "INSERT OR REPLACE INTO word_overrides (lang, key, state, updated_hlc) VALUES (?,?,?,?)",
        [e.lang, e.key, e.state, ctx.hlc],
      );
      return;
    }
    case "WordLookedUp":
      await driver.exec(
        `INSERT INTO word_lookups (lang, key, count) VALUES (?,?,1)
         ON CONFLICT(lang, key) DO UPDATE SET count = count + 1`,
        [e.lang, e.key],
      );
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
      await driver.exec(
        "INSERT OR REPLACE INTO reading_progress (text_id, last_segment, updated) VALUES (?,?,?)",
        [e.textId, e.segment, ctx.createdAt],
      );
      return;
    }
    case "StaircaseUpdated":
      await driver.exec("INSERT OR REPLACE INTO staircase (lang, state) VALUES (?,?)", [
        e.lang,
        JSON.stringify(e.state satisfies StaircaseState),
      ]);
      return;
    case "SettingChanged":
      await driver.exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)", [
        e.key,
        JSON.stringify(e.value ?? null),
      ]);
      return;
    default: {
      const never: never = e;
      throw new Error(`Unknown event type: ${JSON.stringify(never)}`);
    }
  }
}

/** Raw per-word facts gathered from the projection tables. */
export interface WordFacts {
  anki?: AnkiWordEntry;
  override?: WordState;
  lookups: number;
  note?: { noteId: number; deck: string };
}

/**
 * Effective word info, or null if nothing is known about the word.
 *
 * Precedence: manual override > Anki snapshot > app-created note ("learning", 0.2) >
 * looked-up only ("seen", 0.1).
 * - known: pKnown = max(anki pKnown, 0.95); ignored: 1; unknown: 0; seen: 0.1
 * - learning: keep the Anki pKnown if Anki also says "learning", otherwise 0.3
 */
export function composeWord(key: string, f: WordFacts): WordInfo | null {
  const { anki, override, note, lookups } = f;
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
  } else if (anki) {
    source = "anki";
    state = anki.state;
    pKnown = anki.pKnown;
  } else if (note) {
    source = "app";
    state = "learning";
    pKnown = NOTE_ADDED_P_KNOWN;
  } else if (lookups > 0) {
    source = "app";
    state = "seen";
    pKnown = SEEN_P_KNOWN;
  } else {
    return null;
  }
  const decks = [...(anki?.decks ?? [])];
  if (note && !decks.includes(note.deck)) decks.push(note.deck);
  const info: WordInfo = { key, state, pKnown, source, decks, lookups };
  if (anki?.gloss) info.gloss = anki.gloss;
  if (anki?.article) info.article = anki.article;
  if (note) info.addedNoteId = note.noteId;
  return info;
}
