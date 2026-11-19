/**
 * Schema and versioned migrations (tracked with `PRAGMA user_version`).
 * `events` is the append-only source of truth; every other table is a rebuildable projection.
 */
import type { SqlDriver } from "./types.js";

/** Each migration is a list of single statements; index + 1 is the schema version it produces. */
export const MIGRATIONS: readonly (readonly string[])[] = [
  [
    `CREATE TABLE meta (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
    `CREATE TABLE events (
       id TEXT PRIMARY KEY,
       device_id TEXT NOT NULL,
       hlc TEXT NOT NULL,
       type TEXT NOT NULL,
       payload TEXT NOT NULL CHECK (json_valid(payload)),
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX events_hlc ON events (hlc)`,
    // Append-only: the log can never be edited in place.
    `CREATE TRIGGER events_no_update BEFORE UPDATE ON events
       BEGIN SELECT RAISE(ABORT, 'events is append-only'); END`,
    `CREATE TABLE texts (
       id TEXT PRIMARY KEY,
       title TEXT NOT NULL,
       lang TEXT NOT NULL,
       source_kind TEXT NOT NULL,
       source_ref TEXT,
       content TEXT NOT NULL,
       content_hash TEXT NOT NULL,
       word_count INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE text_tokens (
       text_id TEXT PRIMARY KEY,
       content_hash TEXT NOT NULL,
       tokens TEXT NOT NULL
     )`,
    `CREATE TABLE anki_words (
       lang TEXT NOT NULL,
       key TEXT NOT NULL,
       state TEXT NOT NULL,
       p_known REAL NOT NULL,
       note_ids TEXT NOT NULL,
       decks TEXT NOT NULL,
       gloss TEXT,
       article TEXT,
       PRIMARY KEY (lang, key)
     )`,
    `CREATE TABLE word_overrides (
       lang TEXT NOT NULL,
       key TEXT NOT NULL,
       state TEXT NOT NULL,
       updated_hlc TEXT NOT NULL,
       PRIMARY KEY (lang, key)
     )`,
    `CREATE TABLE word_lookups (
       lang TEXT NOT NULL,
       key TEXT NOT NULL,
       count INTEGER NOT NULL,
       PRIMARY KEY (lang, key)
     )`,
    `CREATE TABLE notes_added (
       lang TEXT NOT NULL,
       key TEXT NOT NULL,
       note_id INTEGER NOT NULL,
       deck TEXT NOT NULL,
       PRIMARY KEY (lang, key)
     )`,
    `CREATE TABLE reading_progress (
       text_id TEXT PRIMARY KEY,
       last_segment INTEGER NOT NULL,
       updated INTEGER NOT NULL
     )`,
    `CREATE TABLE staircase (
       lang TEXT PRIMARY KEY,
       state TEXT NOT NULL
     )`,
    `CREATE TABLE settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
  ],
  [
    `ALTER TABLE word_overrides ADD COLUMN marked_anki INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE prioritized (
       lang TEXT NOT NULL,
       key TEXT NOT NULL,
       note_id INTEGER NOT NULL,
       PRIMARY KEY (lang, key)
     )`,
  ],
  [
    `ALTER TABLE anki_words ADD COLUMN sentence TEXT`,
    `ALTER TABLE anki_words ADD COLUMN sentence_translation TEXT`,
    `CREATE TABLE practice_items (
       lang TEXT NOT NULL,
       key TEXT NOT NULL,
       skill TEXT NOT NULL,
       state TEXT NOT NULL,
       at INTEGER NOT NULL,
       PRIMARY KEY (lang, key, skill)
     )`,
  ],
  [
    `CREATE TABLE courses (
       id TEXT PRIMARY KEY,
       data TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE course_units (
       course_id TEXT NOT NULL,
       n INTEGER NOT NULL,
       data TEXT NOT NULL,
       PRIMARY KEY (course_id, n)
     )`,
    `CREATE TABLE course_blocks (
       course_id TEXT NOT NULL,
       idx INTEGER NOT NULL,
       page INTEGER NOT NULL,
       data TEXT NOT NULL,
       PRIMARY KEY (course_id, idx)
     )`,
    `CREATE TABLE book_exercises (
       course_id TEXT NOT NULL,
       unit_n INTEGER NOT NULL,
       number INTEGER NOT NULL,
       idx INTEGER NOT NULL,
       data TEXT NOT NULL,
       PRIMARY KEY (course_id, unit_n, number)
     )`,
    `CREATE TABLE unit_words (
       course_id TEXT NOT NULL,
       unit_n INTEGER NOT NULL,
       idx INTEGER NOT NULL,
       data TEXT NOT NULL,
       PRIMARY KEY (course_id, unit_n, idx)
     )`,
    `CREATE TABLE book_answers (
       course_id TEXT NOT NULL,
       unit_n INTEGER NOT NULL,
       number INTEGER NOT NULL,
       item INTEGER NOT NULL,
       answer TEXT NOT NULL,
       correct INTEGER NOT NULL,
       at INTEGER NOT NULL,
       PRIMARY KEY (course_id, unit_n, number, item)
     )`,
  ],
  [
    `CREATE TABLE text_grammar (
       text_id TEXT PRIMARY KEY,
       content_hash TEXT NOT NULL,
       version INTEGER NOT NULL,
       hits TEXT NOT NULL
     )`,
  ],
  [
    `CREATE TABLE language_profiles (
       lang TEXT PRIMARY KEY,
       profile TEXT NOT NULL,
       updated_hlc TEXT NOT NULL
     )`,
  ],
  [
    // App evidence per word: additive sums, so independent of event order.
    `CREATE TABLE word_evidence (
       lang TEXT NOT NULL,
       key TEXT NOT NULL,
       correct REAL NOT NULL,
       wrong REAL NOT NULL,
       last_at INTEGER NOT NULL,
       last_correct INTEGER NOT NULL,
       PRIMARY KEY (lang, key)
     )`,
  ],
  [
    // Learner-edited text details and cover (TextMetaUpdated / TextCoverSet), LWW per field.
    `CREATE TABLE text_meta (
       text_id TEXT PRIMARY KEY,
       title TEXT,
       author TEXT,
       note TEXT,
       level TEXT,
       cover TEXT,
       hlcs TEXT NOT NULL
     )`,
    // Cover images, content-addressed. Not a projection: rebuild keeps them; backups carry them.
    `CREATE TABLE blobs (
       id TEXT PRIMARY KEY,
       type TEXT NOT NULL,
       bytes BLOB NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  ],
  [
    // Analyzer version of the stored tokens: texts re-analyse when it changes.
    `ALTER TABLE text_tokens ADD COLUMN analyzer_version TEXT`,
  ],
];

/** Latest schema version. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/** Projection tables, cleared (in this order) by `rebuild()`. `meta` and `events` are kept. */
export const PROJECTION_TABLES = [
  "texts",
  "text_meta",
  "text_tokens",
  "text_grammar",
  "anki_words",
  "word_overrides",
  "word_lookups",
  "notes_added",
  "prioritized",
  "practice_items",
  "word_evidence",
  "reading_progress",
  "staircase",
  "settings",
  "language_profiles",
  "courses",
  "course_units",
  "course_blocks",
  "book_exercises",
  "unit_words",
  "book_answers",
] as const;

/** The database file was written by a newer app version than this one understands. */
export class SchemaTooNewError extends Error {
  override readonly name = "SchemaTooNewError";
  constructor(
    /** The file's `PRAGMA user_version`. */
    readonly found: number,
    /** The newest version this build supports. */
    readonly supported: number = SCHEMA_VERSION,
  ) {
    super(
      `Database schema v${found} is newer than supported v${supported}. Update Kenning to open it.`,
    );
  }
}

/** True for `SchemaTooNewError` (also across duplicated module copies). */
export function isSchemaTooNew(err: unknown): err is SchemaTooNewError {
  return err instanceof Error && err.name === "SchemaTooNewError";
}

/**
 * Bring the database to the latest schema. Idempotent: already-applied migrations are
 * skipped, so it is safe to call on every open. Throws if the DB is from a newer version.
 */
export async function migrate(driver: SqlDriver): Promise<void> {
  const rows = await driver.exec("PRAGMA user_version");
  const current = Number(rows[0]?.["user_version"] ?? 0);
  if (current > SCHEMA_VERSION) {
    throw new SchemaTooNewError(current);
  }
  for (let v = current; v < SCHEMA_VERSION; v++) {
    await driver.transaction(async () => {
      for (const stmt of MIGRATIONS[v] ?? []) await driver.exec(stmt);
      // PRAGMA cannot be parameterised; v is an integer we control.
      await driver.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
