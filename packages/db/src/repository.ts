/**
 * Repository over any `SqlDriver`: appends events and keeps projections in sync, answers queries.
 */
import {
  type AnalyzedToken,
  type GrammarHit,
  type ItemState,
  type LanguageProfile,
  type LearnerModel,
  type StaircaseState,
  type WordState,
  profileMode,
} from "@app/core";
import {
  compareHlc,
  createHlc,
  createUlidGenerator,
  isHlc,
  isUlid,
  parseHlc,
  randomDeviceId,
  ulidTime,
} from "./ids.js";
import {
  type EventContext,
  type Row,
  type WordFacts,
  applyEvent,
  composeWord,
  writeTextAnalysis,
  writeTextExtras,
  writeTextGrammar,
} from "./projections.js";
import { courseQueries } from "./course.js";
import { nativeQueries, nativeWordEntries } from "./cards.js";
import { projectGeneratedSentences } from "./generated.js";
import { projectSuggestedWords } from "./suggested.js";
import { projectExamAttempts } from "./exam.js";
import { SHELF_EVENT_TYPES, blobId, blobProblem, isBlobId, projectShelves } from "./library.js";
import { PROJECTION_TABLES, migrate } from "./schema.js";
import { EVENT_VERSIONS, canApply } from "./types.js";
import type {
  AnkiWordEntry,
  AppEvent,
  ExamAttemptRecord,
  GeneratedSentenceSet,
  SuggestedWord,
  PracticeLogEntry,
  ActivityEntry,
  Repository,
  SqlDriver,
  SqlValue,
  StoredEvent,
  StoredText,
  SyncEvent,
  TextExtraSentence,
  TextExtras,
  TextGrammar,
  TextSummary,
  WordInfo,
} from "./types.js";

/** How far ahead of this device's clock another device's event may be (one day). */
const MAX_AHEAD_MS = 86_400_000;

/**
 * A well-formed event of another device: an id and a clock as this app makes them, of that
 * device, not from the far future (a clock that far ahead would hold every device's clock
 * there), and a payload with a type. Events that claim to be this device's are refused: only
 * this device writes them.
 */
function isSyncEvent(x: unknown, self: string, now: number): x is SyncEvent {
  if (!x || typeof x !== "object") return false;
  const e = x as Partial<SyncEvent>;
  if (!isUlid(e.id) || ulidTime(e.id) > now + MAX_AHEAD_MS) return false;
  if (typeof e.deviceId !== "string" || e.deviceId === self) return false;
  if (!isHlc(e.hlc, e.deviceId) || parseHlc(e.hlc).ms > now + MAX_AHEAD_MS) return false;
  return (
    typeof e.createdAt === "number" &&
    Number.isFinite(e.createdAt) &&
    typeof e.v === "number" &&
    Number.isInteger(e.v) &&
    e.v >= 1 &&
    !!e.event &&
    typeof e.event === "object" &&
    typeof (e.event as { type?: unknown }).type === "string"
  );
}

export interface RepositoryOptions {
  /** Override the persisted device id (mainly for tests). */
  deviceId?: string;
  /** Clock in ms since epoch; injectable for tests. */
  now?: () => number;
}

/** `Repository` plus lifecycle, log access and snapshot metadata. */
export interface VuurtorenRepository extends Repository {
  /** Close the underlying driver. */
  close(): Promise<void>;
  /** Events with id > `sinceId` (all if omitted), in id order. */
  events(sinceId?: string): Promise<StoredEvent[]>;
  /**
   * Distinct keys the user looked up (clicked) while reading `textId`, in order of first
   * lookup. Reads only WordLookedUp events of that text, not the whole log.
   */
  lookedUpKeys(lang: string, textId: string): Promise<string[]>;
  /** When (ms) and from which sources the current Anki snapshot of `lang` was imported. */
  lastSnapshot(lang: string): Promise<{ at: number; sources: string[] } | null>;
  /** Number of events in the log. */
  eventCount(): Promise<number>;
  /**
   * Cheap change marker: the device id of the database plus the rowid of the newest
   * event. Every append raises `seq` by exactly one; an import (new device id) changes `deviceId`.
   */
  head(): Promise<{ deviceId: string; seq: number }>;
  /** `word` for many keys in one call; unknown keys are left out, key order. */
  wordsByKeys(lang: string, keys: string[]): Promise<WordInfo[]>;
  /** `getText` for many ids in one call; missing ids are left out, request order. */
  getTexts(ids: string[]): Promise<StoredText[]>;
  /** ConversationStarted / MessageAdded events in id order (fold with `projectConversations`). */
  conversationEvents(): Promise<StoredEvent[]>;
  /** Accepted AI example sentences of a language, one set per (key, topic) (see generated.ts). */
  generatedSentences(lang: string): Promise<GeneratedSentenceSet[]>;
  /** Open word suggestions of a language (from an assistant over MCP), newest first. */
  suggestedWords(lang: string): Promise<SuggestedWord[]>;
  /** Finished exam-preparation sessions of a language, oldest first (see exam.ts). */
  examAttempts(lang: string): Promise<ExamAttemptRecord[]>;
  /**
   * Run `fn` while no other repository call is in flight or can start (the repository's own
   * mutex). Used for operations on the raw file: export while no transaction is open.
   * `fn` must not call this repository's methods (it would wait for itself).
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** This device's id. */
  readonly deviceId: string;
  /** Sync: this device's events after `afterId` (all when absent), oldest first, at most `limit`. */
  exportEvents(afterId?: string, limit?: number): Promise<SyncEvent[]>;
  /**
   * Sync: store events of other devices (ids already held are skipped) and apply them in clock
   * order: at the end when all are newer than the log, else by replaying the whole log.
   * Events newer than this app understands are kept, and applied once the app is updated.
   * An event a projection cannot apply stays in the log and is reported in `failed`.
   *
   * With `deferReplay`, an import that needs a replay only notes it: the next import without
   * it (an empty one is enough) replays once for all of them. A sync brings in many files and
   * replays at most once. A noted replay survives a restart: opening the repository does it.
   */
  importEvents(events: SyncEvent[], opts?: { deferReplay?: boolean }): Promise<ImportResult>;
  /**
   * Drop what later events made useless: Anki snapshots older than the newest of their
   * language, and the contents and analyses of deleted texts. The projections do not change.
   */
  compact(): Promise<{ removed: number; emptied: number }>;
  /** This device's sync bookkeeping (cursors), never synced; null before the first sync. */
  syncState(): Promise<unknown>;
  setSyncState(state: unknown): Promise<void>;
}

/** What `importEvents` did. */
export interface ImportResult {
  /** New events stored. */
  added: number;
  /** Events that were not well formed and were left out. */
  invalid: number;
  /** True when the whole log was replayed (some events were older than the log's end). */
  rebuilt: boolean;
  /** Events kept in the log that a projection could not apply, with the reason. */
  failed: { id: string; error: string }[];
}

/**
 * Bump when a projection's meaning changes. 2: reading_progress.last_segment = next segment to read. 3: write-action events. 4: anki_words sentences, practice_items. 5: course tables. 6: text_grammar. 7: language_profiles. 8: word_evidence. 9: text_meta (edited details, covers). 10: native cards. 11: text analyses are a per-device cache (text_tokens.analyzed_at), kept by rebuilds. 12: word_lookups.last_at, practice_answers.
 */
export const PROJECTION_VERSION = 12;

/** Wrap every query function in the repository's mutex. */
function serialised<T extends Record<string, (...a: never[]) => Promise<unknown>>>(
  fns: T,
  serial: <R>(fn: () => Promise<R>) => Promise<R>,
): T {
  return Object.fromEntries(
    Object.entries(fns).map(([k, f]) => [k, (...args: never[]) => serial(() => f(...args))]),
  ) as T;
}

const json = <T>(v: SqlValue | undefined): T => JSON.parse(String(v)) as T;

function textSummary(r: Row): TextSummary {
  const opt = (col: string, field: string): Record<string, string> =>
    typeof r[col] === "string" && r[col] ? { [field]: r[col] } : {};
  const edited = typeof r["m_title"] === "string" && r["m_title"] ? r["m_title"] : null;
  return {
    id: String(r["id"]),
    title: edited ?? String(r["title"]),
    ...(edited ? { importedTitle: String(r["title"]) } : {}),
    ...opt("m_author", "author"),
    ...opt("m_note", "note"),
    ...opt("m_level", "level"),
    ...opt("m_cover", "coverId"),
    lang: String(r["lang"]),
    sourceKind: String(r["source_kind"]) as TextSummary["sourceKind"],
    ...(r["source_ref"] != null ? { sourceRef: String(r["source_ref"]) } : {}),
    createdAt: Number(r["created_at"]),
    wordCount: Number(r["word_count"]),
    analyzed: r["analyzed"] !== null,
    lastSegment: Number(r["last_segment"] ?? 0),
  };
}

const TEXT_COLS = `t.id, t.title, t.lang, t.source_kind, t.source_ref, t.created_at, t.word_count,
    tt.text_id AS analyzed, rp.last_segment,
    m.title AS m_title, m.author AS m_author, m.note AS m_note, m.level AS m_level, m.cover AS m_cover`;
const TEXT_FROM = `FROM texts t
  LEFT JOIN text_meta m ON m.text_id = t.id
  LEFT JOIN text_tokens tt ON tt.text_id = t.id
  LEFT JOIN reading_progress rp ON rp.text_id = t.id`;

function textExtrasOf(r: Row): TextExtras {
  // `data` is the sentence list (older rows) or { sentences, mtModel }.
  const data = json<
    | TextExtraSentence[]
    | { sentences: TextExtraSentence[]; mtModel?: string; glosses?: TextExtras["glosses"] }
  >(r["data"]);
  const sentences = Array.isArray(data) ? data : data.sentences;
  const mtModel = Array.isArray(data) ? undefined : data.mtModel;
  const glosses = Array.isArray(data) ? undefined : data.glosses;
  return {
    textId: String(r["text_id"]),
    contentHash: String(r["content_hash"]),
    analyzerVersion: r["analyzer_version"] == null ? null : String(r["analyzer_version"]),
    madeAt: Number(r["made_at"]),
    sentences,
    ...(mtModel ? { mtModel } : {}),
    ...(glosses ? { glosses } : {}),
  };
}

function textGrammar(r: Row): TextGrammar {
  return {
    textId: String(r["text_id"]),
    version: Number(r["version"]),
    hits: json<GrammarHit[]>(r["hits"]),
  };
}

function ankiEntry(r: Row): AnkiWordEntry {
  const a: AnkiWordEntry = {
    key: String(r["key"]),
    state: String(r["state"]) as WordState,
    pKnown: Number(r["p_known"]),
    noteIds: json<number[]>(r["note_ids"]),
    decks: json<string[]>(r["decks"]),
  };
  if (r["gloss"] !== null && r["gloss"] !== undefined) a.gloss = String(r["gloss"]);
  if (r["article"] !== null && r["article"] !== undefined) a.article = String(r["article"]);
  if (r["sentence"] !== null && r["sentence"] !== undefined) a.sentence = String(r["sentence"]);
  if (r["sentence_translation"] !== null && r["sentence_translation"] !== undefined) {
    a.sentenceTranslation = String(r["sentence_translation"]);
  }
  return a;
}

/**
 * Open (migrating if needed) a repository on `driver`.
 *
 * All public calls are serialised internally, because a driver is a single connection and
 * transactions must not interleave.
 *
 * @example
 * const repo = await createRepository(await createNodeDriver(":memory:"));
 * await repo.append({ type: "SettingChanged", key: "theme", value: "dark" });
 */
export async function createRepository(
  driver: SqlDriver,
  opts: RepositoryOptions = {},
): Promise<VuurtorenRepository> {
  const now = opts.now ?? Date.now;

  // Simple promise-chain mutex.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };

  await migrate(driver);

  const stored = await driver.exec("SELECT value FROM meta WHERE key = 'device_id'");
  let deviceId: string;
  if (stored[0]) {
    deviceId = opts.deviceId ?? json<string>(stored[0]["value"]);
  } else {
    deviceId = opts.deviceId ?? randomDeviceId();
    await driver.exec("INSERT INTO meta (key, value) VALUES ('device_id', ?)", [
      JSON.stringify(deviceId),
    ]);
  }

  // Resume clocks past this device's newest event so ids and clocks stay monotonic across
  // restarts. Ids follow this device's own events only: another device's id never decides
  // what this one writes. The clock also moves past the newest event of any device, unless
  // that one is beyond what an import would accept.
  const own = (
    await driver.exec("SELECT id, hlc FROM events WHERE device_id = ? ORDER BY id DESC LIMIT 1", [
      deviceId,
    ])
  )[0];
  const lastHlc = (await driver.exec("SELECT hlc FROM events ORDER BY hlc DESC LIMIT 1"))[0]?.[
    "hlc"
  ];
  const hlc = createHlc(deviceId, now, isHlc(own?.["hlc"]) ? own["hlc"] : undefined);
  if (isHlc(lastHlc) && parseHlc(lastHlc).ms <= now() + MAX_AHEAD_MS) hlc.receive(lastHlc);
  const nextId = createUlidGenerator(
    now,
    undefined,
    typeof own?.["id"] === "string" ? own["id"] : undefined,
  );

  const toSync = (r: Row): SyncEvent => ({
    id: String(r["id"]),
    deviceId: String(r["device_id"]),
    hlc: String(r["hlc"]),
    createdAt: Number(r["created_at"]),
    v: Number(r["v"] ?? 1),
    event: json<AppEvent>(r["payload"]),
  });

  const contextOf = (e: SyncEvent): EventContext => ({
    id: e.id,
    hlc: e.hlc,
    createdAt: e.createdAt,
    v: e.v,
    event: e.event,
  });

  /**
   * Apply one event inside a savepoint: when a projection throws, what it wrote so far is
   * undone and the reason returned. The event itself stays in the log.
   */
  async function applyGuarded(e: SyncEvent): Promise<string | null> {
    await driver.exec("SAVEPOINT apply_event");
    try {
      await applyEvent(driver, contextOf(e));
      await driver.exec("RELEASE apply_event");
      return null;
    } catch (err) {
      await driver.exec("ROLLBACK TO apply_event");
      await driver.exec("RELEASE apply_event");
      return err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * Clear the projections and apply the whole log again, in clock order across devices. Run
   * inside a transaction. The fast way first; when an event throws, once more with each event
   * guarded, so one event a projection cannot apply does not stop the others.
   */
  async function replayAll(): Promise<ImportResult["failed"]> {
    const pass = async (guarded: boolean) => {
      const failed: ImportResult["failed"] = [];
      for (const t of PROJECTION_TABLES) await driver.exec(`DELETE FROM ${t}`);
      await driver.exec("DELETE FROM meta WHERE key LIKE 'snapshot:%'");
      await driver.exec("DELETE FROM meta WHERE key = 'replay_pending'");
      const rows = await driver.exec("SELECT * FROM events ORDER BY hlc, id");
      for (const r of rows) {
        const e = toSync(r);
        if (!guarded) await applyEvent(driver, contextOf(e));
        else {
          const error = await applyGuarded(e);
          if (error !== null) failed.push({ id: e.id, error });
        }
      }
      return failed;
    };
    await driver.exec("SAVEPOINT replay");
    try {
      await pass(false);
      await driver.exec("RELEASE replay");
      return [];
    } catch {
      await driver.exec("ROLLBACK TO replay");
      const failed = await pass(true);
      await driver.exec("RELEASE replay");
      return failed;
    }
  }

  const toStored = (r: Row): StoredEvent => ({
    id: String(r["id"]),
    deviceId: String(r["device_id"]),
    hlc: String(r["hlc"]),
    event: json<AppEvent>(r["payload"]),
  });

  /** Gather facts for all words (or only `keys`) of a language and compose them. */
  /** Anki was synced or written to for `lang`. */
  async function usedAnki(lang: string): Promise<boolean> {
    const rows = await driver.exec(
      `SELECT 1 FROM meta WHERE key = ? UNION ALL SELECT 1 FROM notes_added WHERE lang = ? LIMIT 1`,
      [`snapshot:${lang}`, lang],
    );
    return rows.length > 0;
  }

  async function loadWords(lang: string, keys?: string[]): Promise<Map<string, WordInfo>> {
    // One JSON parameter instead of one per key: no SQLite variable limit for large batches.
    const k = keys === undefined ? "" : " AND key IN (SELECT value FROM json_each(?))";
    const p = keys === undefined ? [lang] : [lang, JSON.stringify(keys)];
    const facts = new Map<string, WordFacts>();
    const get = (key: string): WordFacts => {
      let f = facts.get(key);
      if (!f) facts.set(key, (f = { lookups: 0 }));
      return f;
    };
    const profileRow = (
      await driver.exec("SELECT profile FROM language_profiles WHERE lang = ?", [lang])
    )[0];
    // No profile yet: Vuurtoren's own cards, like profileMode, unless Anki was used before
    // profiles existed (synced or written to; that learner stays connected).
    const native = profileRow
      ? profileMode(json<LanguageProfile>(profileRow["profile"])) === "native"
      : !(await usedAnki(lang));
    if (native) {
      // Native mode: Vuurtoren's own cards are the record; Anki snapshots and notes added to Anki
      // from connected days are left aside.
      const n = await nativeWordEntries(driver, lang, now(), keys ? new Set(keys) : undefined);
      for (const [key, entry] of n.entries) get(key).anki = entry;
      for (const [key, note] of n.pending) get(key).note = note;
    } else {
      for (const r of await driver.exec(`SELECT * FROM anki_words WHERE lang = ?${k}`, p)) {
        get(String(r["key"])).anki = ankiEntry(r);
      }
    }
    for (const r of await driver.exec(`SELECT * FROM word_overrides WHERE lang = ?${k}`, p)) {
      // An empty state is the tombstone left by WordStateCleared.
      if (r["state"] === "") continue;
      const f = get(String(r["key"]));
      f.override = String(r["state"]) as WordState;
      f.markedKnownInAnki = r["marked_anki"] === 1;
    }
    for (const r of await driver.exec(`SELECT * FROM word_lookups WHERE lang = ?${k}`, p)) {
      const f = get(String(r["key"]));
      f.lookups = Number(r["count"]);
      if (Number(r["last_at"] ?? 0) > 0) f.lastLookupAt = Number(r["last_at"]);
    }
    if (!native) {
      for (const r of await driver.exec(`SELECT * FROM notes_added WHERE lang = ?${k}`, p)) {
        get(String(r["key"])).note = { noteId: Number(r["note_id"]), deck: String(r["deck"]) };
      }
      for (const r of await driver.exec(`SELECT * FROM prioritized WHERE lang = ?${k}`, p)) {
        get(String(r["key"])).prioritizedNoteId = Number(r["note_id"]);
      }
    }
    for (const r of await driver.exec(`SELECT * FROM word_evidence WHERE lang = ?${k}`, p)) {
      get(String(r["key"])).evidence = {
        correct: Number(r["correct"]),
        wrong: Number(r["wrong"]),
        lastAt: Number(r["last_at"]),
        lastCorrect: r["last_correct"] === 1,
      };
    }
    const nowMs = now();
    const out = new Map<string, WordInfo>();
    for (const [key, f] of [...facts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const info = composeWord(key, f, nowMs);
      if (info) out.set(key, info);
    }
    return out;
  }

  /** Full texts (content and tokens) for `ids`, in request order; missing ids left out. */
  async function loadTexts(ids: string[]): Promise<StoredText[]> {
    if (ids.length === 0) return [];
    const rows = await driver.exec(
      `SELECT ${TEXT_COLS}, t.content, tt.tokens, tt.analyzer_version, tt.analyzed_at ${TEXT_FROM}
        WHERE t.id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(ids)],
    );
    const byId = new Map(
      rows.map((r): [string, StoredText] => [
        String(r["id"]),
        {
          ...textSummary(r),
          content: String(r["content"]),
          tokens: r["tokens"] === null ? null : json<AnalyzedToken[]>(r["tokens"]),
          analyzerVersion: r["analyzer_version"] == null ? null : String(r["analyzer_version"]),
          analyzedAt: Number(r["analyzed_at"] ?? 0),
        },
      ]),
    );
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  const repo: VuurtorenRepository = {
    deviceId,

    append: (event) =>
      serial(async () => {
        const id = nextId();
        const stamp = hlc.tick();
        const createdAt = now();
        const v = (EVENT_VERSIONS as Record<string, number>)[event.type] ?? 1;
        const ctx: EventContext = { id, hlc: stamp, createdAt, v, event };
        await driver.transaction(async () => {
          await driver.exec(
            "INSERT INTO events (id, device_id, hlc, type, payload, created_at, v) VALUES (?,?,?,?,?,?,?)",
            [id, deviceId, stamp, event.type, JSON.stringify(event), createdAt, v],
          );
          await applyEvent(driver, ctx);
        });
        return { id, deviceId, hlc: stamp, event };
      }),

    listTexts: () =>
      serial(async () =>
        (
          await driver.exec(
            `SELECT ${TEXT_COLS} ${TEXT_FROM} ORDER BY t.created_at DESC, t.id DESC`,
          )
        ).map(textSummary),
      ),

    getText: (id) => serial(async () => (await loadTexts([id]))[0] ?? null),

    getTexts: (ids) => serial(() => loadTexts(ids)),

    learnerModel: (lang) =>
      serial(async () => {
        const model: LearnerModel = new Map();
        for (const [key, w] of await loadWords(lang)) {
          model.set(key, { state: w.state, pKnown: w.pKnown });
        }
        return model;
      }),

    word: (lang, key) => serial(async () => (await loadWords(lang, [key])).get(key) ?? null),

    wordsByKeys: (lang, keys) =>
      serial(async () => (keys.length ? [...(await loadWords(lang, keys)).values()] : [])),

    words: (lang, q = {}) =>
      serial(async () => {
        const prefix = q.query?.toLowerCase();
        let list = [...(await loadWords(lang)).values()];
        if (q.state) list = list.filter((w) => w.state === q.state);
        if (prefix) list = list.filter((w) => w.key.toLowerCase().startsWith(prefix));
        const offset = q.offset ?? 0;
        return list.slice(offset, q.limit === undefined ? undefined : offset + q.limit);
      }),

    staircase: (lang) =>
      serial(async () => {
        const rows = await driver.exec("SELECT state FROM staircase WHERE lang = ?", [lang]);
        return rows[0] ? json<StaircaseState>(rows[0]["state"]) : null;
      }),

    cardReviewedKeys: (lang, since) =>
      serial(async () =>
        (
          await driver.exec(
            `SELECT DISTINCT n.key AS key FROM native_reviews r
             JOIN native_cards c ON c.id = r.card_id
             JOIN native_notes n ON n.id = c.note_id
             WHERE r.lang = ? AND r.at >= ? AND n.key IS NOT NULL
               AND r.source NOT IN ('practice', 'cloze')`,
            [lang, since],
          )
        ).map((r) => String(r["key"])),
      ),

    practiceAnswers: (lang) =>
      serial(async () =>
        (
          await driver.exec(
            "SELECT key, kind, result, at FROM practice_answers WHERE lang = ? ORDER BY at, key, kind",
            [lang],
          )
        ).map((r) => ({
          key: String(r["key"]),
          kind: String(r["kind"]),
          result: Number(r["result"]),
          at: Number(r["at"]),
        })),
      ),

    practiceItems: (lang) =>
      serial(async () =>
        (
          await driver.exec("SELECT state FROM practice_items WHERE lang = ? ORDER BY key, skill", [
            lang,
          ])
        ).map((r) => json<ItemState>(r["state"])),
      ),

    activity: (sinceMs) =>
      serial(async () =>
        (
          await driver.exec(
            `SELECT type, created_at FROM events
              WHERE created_at >= ? AND type IN
                ('ReadingProgress', 'ExerciseAnswered', 'ClozeAnswered', 'NoteAddedToAnki')
              ORDER BY created_at`,
            [Math.max(0, Math.floor(sinceMs))],
          )
        )
          .map((r): ActivityEntry => ({
            kind:
              r["type"] === "ReadingProgress"
                ? "page"
                : r["type"] === "NoteAddedToAnki"
                  ? "added"
                  : "exercise",
            at: Number(r["created_at"]),
          }))
          .concat(
            // Native reviews answered in Vuurtoren (an undone answer is gone from the table).
            (
              await driver.exec(
                `SELECT at FROM native_reviews
                  WHERE source = 'vuurtoren' AND rating > 0 AND at >= ? ORDER BY at`,
                [Math.max(0, Math.floor(sinceMs))],
              )
            ).map((r): ActivityEntry => ({ kind: "review", at: Number(r["at"]) })),
          )
          .sort((a, b) => a.at - b.at),
      ),

    practiceLog: (lang, limit) =>
      serial(async () =>
        (
          await driver.exec(
            `SELECT payload FROM events
              WHERE type = 'ExerciseAnswered' AND json_extract(payload, '$.lang') = ?
              ORDER BY id DESC LIMIT ?`,
            [lang, Math.max(0, Math.floor(limit))],
          )
        ).map((r) => {
          const e = json<Extract<AppEvent, { type: "ExerciseAnswered" }>>(r["payload"]);
          const entry: PracticeLogEntry = {
            key: e.key,
            skill: e.skill,
            kind: e.kind,
            grade: e.grade,
            correct: e.correct,
            ms: e.ms,
            at: e.at,
          };
          return entry;
        }),
      ),

    ...serialised(courseQueries(driver), serial),

    ...serialised(nativeQueries(driver), serial),

    textGrammar: (textId) =>
      serial(async () => {
        const rows = await driver.exec(
          "SELECT text_id, version, hits FROM text_grammar WHERE text_id = ?",
          [textId],
        );
        return rows[0] ? textGrammar(rows[0]) : null;
      }),

    allTextGrammar: () =>
      serial(async () =>
        (
          await driver.exec(
            `SELECT g.text_id, g.version, g.hits FROM text_grammar g
               JOIN texts t ON t.id = g.text_id
              ORDER BY t.created_at DESC, t.id DESC`,
          )
        ).map(textGrammar),
      ),

    // The analysis cache: this device's language-server results, outside the event log.
    saveTextAnalysis: (analysis) => serial(() => writeTextAnalysis(driver, analysis, now(), true)),

    saveTextGrammar: (grammar) => serial(() => writeTextGrammar(driver, grammar, now(), true)),

    textExtras: (textId) =>
      serial(async () => {
        const r = (
          await driver.exec(
            `SELECT x.text_id, x.content_hash, x.analyzer_version, x.made_at, x.data
               FROM text_extras x JOIN texts t ON t.id = x.text_id AND t.content_hash = x.content_hash
              WHERE x.text_id = ?`,
            [textId],
          )
        )[0];
        return r ? textExtrasOf(r) : null;
      }),

    saveTextExtras: (extras) => serial(() => writeTextExtras(driver, extras)),

    analysisStates: () =>
      serial(async () =>
        (
          await driver.exec(
            `SELECT tt.text_id, tt.content_hash, tt.analyzer_version, tt.analyzed_at,
                    g.version AS grammar, x.made_at AS extras_at
               FROM text_tokens tt
               JOIN texts t ON t.id = tt.text_id AND t.content_hash = tt.content_hash
               LEFT JOIN text_grammar g ON g.text_id = tt.text_id AND g.content_hash = tt.content_hash
               LEFT JOIN text_extras x ON x.text_id = tt.text_id AND x.content_hash = tt.content_hash
              ORDER BY t.created_at DESC, t.id DESC`,
          )
        ).map((r) => ({
          textId: String(r["text_id"]),
          contentHash: String(r["content_hash"]),
          analyzerVersion: r["analyzer_version"] == null ? null : String(r["analyzer_version"]),
          analyzedAt: Number(r["analyzed_at"]),
          grammar: r["grammar"] == null ? null : Number(r["grammar"]),
          extrasAt: r["extras_at"] == null ? null : Number(r["extras_at"]),
        })),
      ),

    unanalysedTexts: () =>
      serial(async () =>
        (
          await driver.exec(
            `SELECT t.id, t.content_hash FROM texts t
               LEFT JOIN text_tokens tt ON tt.text_id = t.id AND tt.content_hash = t.content_hash
              WHERE tt.text_id IS NULL
              ORDER BY t.created_at DESC, t.id DESC`,
          )
        ).map((r) => ({ textId: String(r["id"]), contentHash: String(r["content_hash"]) })),
      ),

    textBundle: (textId) =>
      serial(async () => {
        const r = (
          await driver.exec(
            `SELECT tt.content_hash, tt.tokens, tt.analyzer_version, tt.analyzed_at
               FROM text_tokens tt JOIN texts t ON t.id = tt.text_id AND t.content_hash = tt.content_hash
              WHERE tt.text_id = ?`,
            [textId],
          )
        )[0];
        if (!r) return null;
        const hash = String(r["content_hash"]);
        const g = (
          await driver.exec(
            "SELECT version, hits FROM text_grammar WHERE text_id = ? AND content_hash = ?",
            [textId, hash],
          )
        )[0];
        const x = (
          await driver.exec(
            "SELECT text_id, content_hash, analyzer_version, made_at, data FROM text_extras WHERE text_id = ? AND content_hash = ?",
            [textId, hash],
          )
        )[0];
        const analyzerVersion =
          r["analyzer_version"] == null ? null : String(r["analyzer_version"]);
        const extras = x ? textExtrasOf(x) : null;
        return {
          textId,
          contentHash: hash,
          analyzerVersion,
          analyzedAt: Number(r["analyzed_at"]),
          tokens: json<AnalyzedToken[]>(r["tokens"]),
          grammar: g
            ? { version: Number(g["version"]), hits: json<GrammarHit[]>(g["hits"]) }
            : null,
          extras:
            extras && extras.analyzerVersion === analyzerVersion
              ? {
                  madeAt: extras.madeAt,
                  sentences: extras.sentences,
                  ...(extras.mtModel ? { mtModel: extras.mtModel } : {}),
                  ...(extras.glosses ? { glosses: extras.glosses } : {}),
                }
              : null,
        };
      }),

    saveTextBundle: (b) =>
      serial(() =>
        driver.transaction(async () => {
          // As an analysis from another device: never over a newer one of this device.
          const stored = await writeTextAnalysis(
            driver,
            {
              textId: b.textId,
              contentHash: b.contentHash,
              tokens: b.tokens,
              analyzerVersion: b.analyzerVersion,
            },
            b.analyzedAt,
          );
          if (!stored) return false;
          if (b.grammar) {
            await writeTextGrammar(
              driver,
              { textId: b.textId, contentHash: b.contentHash, ...b.grammar },
              b.analyzedAt,
            );
          }
          if (b.extras) {
            await writeTextExtras(driver, {
              textId: b.textId,
              contentHash: b.contentHash,
              analyzerVersion: b.analyzerVersion,
              ...b.extras,
            });
          }
          return true;
        }),
      ),

    analyzerSeen: (version) =>
      serial(async () => {
        const row = (await driver.exec("SELECT value FROM meta WHERE key = 'analyzers'"))[0];
        const seen = row ? json<Record<string, number>>(row["value"]) : {};
        const at = seen[version];
        if (at !== undefined) return at;
        seen[version] = now();
        await driver.exec(
          "INSERT INTO meta (key, value) VALUES ('analyzers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [JSON.stringify(seen)],
        );
        return seen[version];
      }),

    setting: <T>(key: string) =>
      serial(async () => {
        const rows = await driver.exec("SELECT value FROM settings WHERE key = ?", [key]);
        return rows[0] ? json<T>(rows[0]["value"]) : undefined;
      }),

    languageProfile: (lang) =>
      serial(async () => {
        const rows = await driver.exec("SELECT profile FROM language_profiles WHERE lang = ?", [
          lang,
        ]);
        return rows[0] ? json<LanguageProfile>(rows[0]["profile"]) : null;
      }),

    shelves: () =>
      serial(async () =>
        projectShelves(
          (
            await driver.exec(
              `SELECT * FROM events WHERE type IN (${SHELF_EVENT_TYPES.map(() => "?").join(",")}) ORDER BY id`,
              [...SHELF_EVENT_TYPES],
            )
          ).map(toStored),
        ),
      ),

    putBlob: (bytes, type) =>
      serial(async () => {
        const problem = blobProblem(bytes, type);
        if (problem) throw new Error(problem);
        const id = blobId(bytes);
        await driver.exec(
          "INSERT OR IGNORE INTO blobs (id, type, bytes, created_at) VALUES (?,?,?,?)",
          [id, type, bytes, now()],
        );
        return id;
      }),

    getBlob: (id) =>
      serial(async () => {
        if (!isBlobId(id)) return null;
        const r = (await driver.exec("SELECT type, bytes FROM blobs WHERE id = ?", [id]))[0];
        const bytes = r?.["bytes"];
        // ArrayBuffer.isView rather than instanceof: the driver's realm may differ (worker, jsdom).
        if (!r || !ArrayBuffer.isView(bytes)) return null;
        return {
          type: String(r["type"]),
          bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        };
      }),

    rebuild: () =>
      serial(() =>
        driver.transaction(async () => {
          await replayAll();
        }),
      ),

    exportEvents: (afterId, limit = 10_000) =>
      serial(async () =>
        (
          await driver.exec(
            `SELECT * FROM events WHERE device_id = ? AND id > ? ORDER BY id LIMIT ?`,
            [deviceId, afterId ?? "", Math.max(1, Math.floor(limit))],
          )
        ).map(toSync),
      ),

    importEvents: (incoming, opts = {}) =>
      serial(async () => {
        const at = now();
        const valid = incoming.filter((e) => isSyncEvent(e, deviceId, at));
        const ids = valid.map((e) => e.id);
        const held = new Set<string>();
        for (let i = 0; i < ids.length; i += 500) {
          for (const r of await driver.exec(
            "SELECT id FROM events WHERE id IN (SELECT value FROM json_each(?))",
            [JSON.stringify(ids.slice(i, i + 500))],
          )) {
            held.add(String(r["id"]));
          }
        }
        const seen = new Set<string>();
        const fresh = valid
          .filter((e) => !held.has(e.id) && !seen.has(e.id) && seen.add(e.id))
          .sort((a, b) => compareHlc(a.hlc, b.hlc) || (a.id < b.id ? -1 : 1));
        const result: ImportResult = {
          added: fresh.length,
          invalid: incoming.length - valid.length,
          rebuilt: false,
          failed: [],
        };
        const pending =
          (await driver.exec("SELECT 1 AS x FROM meta WHERE key = 'replay_pending'")).length > 0;
        if (fresh.length === 0 && (!pending || opts.deferReplay)) return result;
        const end = (await driver.exec("SELECT hlc FROM events ORDER BY hlc DESC LIMIT 1"))[0]?.[
          "hlc"
        ];
        // A replay already due covers these events too: they are only stored.
        const inOrder =
          !pending &&
          (fresh.length === 0 || typeof end !== "string" || compareHlc(fresh[0]!.hlc, end) > 0);
        for (const e of fresh) hlc.receive(e.hlc);
        await driver.transaction(async () => {
          for (const e of fresh) {
            await driver.exec(
              "INSERT INTO events (id, device_id, hlc, type, payload, created_at, v) VALUES (?,?,?,?,?,?,?)",
              [e.id, e.deviceId, e.hlc, e.event.type, JSON.stringify(e.event), e.createdAt, e.v],
            );
            if (inOrder) {
              const error = await applyGuarded(e);
              if (error !== null) result.failed.push({ id: e.id, error });
            }
          }
          if (!inOrder) {
            if (opts.deferReplay) {
              await driver.exec(
                "INSERT INTO meta (key, value) VALUES ('replay_pending', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
              );
            } else {
              result.failed.push(...(await replayAll()));
              result.rebuilt = true;
            }
          }
          if (fresh.some((e) => !canApply(e.event.type, e.v))) {
            await driver.exec(
              "INSERT INTO meta (key, value) VALUES ('unapplied_events', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            );
          }
        });
        return result;
      }),

    compact: () =>
      serial(() =>
        driver.transaction(async () => {
          let removed = 0;
          let emptied = 0;
          // Anki snapshots: each replaces the last; only the newest per language matters.
          const newest = new Map<string, string>();
          const snaps = await driver.exec(
            "SELECT id, json_extract(payload, '$.lang') AS lang FROM events WHERE type = 'AnkiSnapshotImported' ORDER BY hlc, id",
          );
          for (const r of snaps) newest.set(String(r["lang"]), String(r["id"]));
          const keep = new Set(newest.values());
          for (const r of snaps) {
            if (keep.has(String(r["id"]))) continue;
            await driver.exec("DELETE FROM events WHERE id = ?", [String(r["id"])]);
            removed++;
          }
          // Deleted texts: their analyses go, their content is emptied (the import stays).
          const gone = (
            await driver.exec(
              "SELECT DISTINCT json_extract(payload, '$.textId') AS t FROM events WHERE type = 'TextDeleted'",
            )
          ).map((r) => String(r["t"]));
          if (gone.length) {
            const list = JSON.stringify(gone);
            const heavy = await driver.exec(
              `SELECT id FROM events WHERE type IN ('TextAnalyzed', 'TextGrammarDetected')
                 AND json_extract(payload, '$.textId') IN (SELECT value FROM json_each(?))`,
              [list],
            );
            for (const r of heavy)
              await driver.exec("DELETE FROM events WHERE id = ?", [String(r["id"])]);
            removed += heavy.length;
            const imports = await driver.exec(
              `SELECT * FROM events WHERE type = 'TextImported'
                 AND json_extract(payload, '$.textId') IN (SELECT value FROM json_each(?))
                 AND json_extract(payload, '$.content') != ''`,
              [list],
            );
            for (const r of imports) {
              // The log is append-only (no UPDATE): the row is replaced, same id and clock.
              const payload = JSON.stringify({
                ...json<Record<string, unknown>>(r["payload"]),
                content: "",
              });
              await driver.exec("DELETE FROM events WHERE id = ?", [String(r["id"])]);
              await driver.exec(
                "INSERT INTO events (id, device_id, hlc, type, payload, created_at, v) VALUES (?,?,?,?,?,?,?)",
                [
                  String(r["id"]),
                  String(r["device_id"]),
                  String(r["hlc"]),
                  String(r["type"]),
                  payload,
                  Number(r["created_at"]),
                  Number(r["v"] ?? 1),
                ],
              );
              emptied++;
            }
          }
          return { removed, emptied };
        }),
      ),

    syncState: () =>
      serial(async () => {
        const r = (await driver.exec("SELECT value FROM meta WHERE key = 'sync_state'"))[0];
        return r ? json<unknown>(r["value"]) : null;
      }),

    setSyncState: (state) =>
      serial(async () => {
        await driver.exec(
          "INSERT INTO meta (key, value) VALUES ('sync_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          [JSON.stringify(state)],
        );
      }),

    events: (sinceId) =>
      serial(async () =>
        (
          await driver.exec(
            sinceId === undefined
              ? "SELECT * FROM events ORDER BY id"
              : "SELECT * FROM events WHERE id > ? ORDER BY id",
            sinceId === undefined ? [] : [sinceId],
          )
        ).map(toStored),
      ),

    lookedUpKeys: (lang, textId) =>
      serial(async () => {
        const rows = await driver.exec(
          `SELECT DISTINCT json_extract(payload, '$.key') AS key, MIN(id) AS first
             FROM events
            WHERE type = 'WordLookedUp'
              AND json_extract(payload, '$.textId') = ?
              AND json_extract(payload, '$.lang') = ?
            GROUP BY key ORDER BY first`,
          [textId, lang],
        );
        return rows.map((r) => String(r["key"]));
      }),

    lastSnapshot: (lang) =>
      serial(async () => {
        const rows = await driver.exec("SELECT value FROM meta WHERE key = ?", [
          `snapshot:${lang}`,
        ]);
        return rows[0] ? json<{ at: number; sources: string[] }>(rows[0]["value"]) : null;
      }),

    eventCount: () =>
      serial(async () => Number((await driver.exec("SELECT count(*) AS c FROM events"))[0]?.["c"])),

    // max(rowid) is O(1) on a rowid table; events are never deleted (append-only triggers).
    head: () =>
      serial(async () => ({
        deviceId,
        seq: Number((await driver.exec("SELECT max(rowid) AS s FROM events"))[0]?.["s"] ?? 0),
      })),

    conversationEvents: () =>
      serial(async () =>
        (
          await driver.exec(
            "SELECT * FROM events WHERE type IN ('ConversationStarted','MessageAdded') ORDER BY id",
          )
        ).map(toStored),
      ),

    generatedSentences: (lang) =>
      serial(async () =>
        projectGeneratedSentences(
          (
            await driver.exec(
              "SELECT * FROM events WHERE type = 'SentencesGenerated' AND json_extract(payload, '$.lang') = ? ORDER BY id",
              [lang],
            )
          ).map(toStored),
        ),
      ),

    suggestedWords: (lang) =>
      serial(async () =>
        projectSuggestedWords(
          (
            await driver.exec(
              "SELECT * FROM events WHERE type IN ('WordSuggested','WordSuggestionDismissed') AND json_extract(payload, '$.lang') = ? ORDER BY id",
              [lang],
            )
          ).map(toStored),
        ),
      ),

    examAttempts: (lang) =>
      serial(async () =>
        projectExamAttempts(
          (
            await driver.exec(
              "SELECT * FROM events WHERE type = 'ExamAttempt' AND json_extract(payload, '$.lang') = ? ORDER BY id",
              [lang],
            )
          ).map(toStored),
          lang,
        ),
      ),

    exclusive: (fn) => serial(fn),

    close: () => serial(() => driver.close()),
  };

  // A sync that stopped before its replay: do it now (it clears the note).
  if ((await driver.exec("SELECT 1 AS x FROM meta WHERE key = 'replay_pending'")).length > 0) {
    await repo.rebuild();
  }

  // Events kept from a newer app version: once this version understands them all, apply them.
  const unapplied = (
    await driver.exec("SELECT 1 AS x FROM meta WHERE key = 'unapplied_events'")
  )[0];
  if (unapplied) {
    const types = await driver.exec("SELECT type, max(v) AS v FROM events GROUP BY type");
    if (types.every((r) => canApply(String(r["type"]), Number(r["v"])))) {
      await repo.rebuild();
      await driver.exec("DELETE FROM meta WHERE key = 'unapplied_events'");
    }
  }

  // Projections are derived data: when their semantics change (PROJECTION_VERSION), rebuild them
  // once from the event log so existing databases pick up the new meaning.
  const pv = (await driver.exec("SELECT value FROM meta WHERE key = 'projection_version'"))[0];
  if (!pv || json<number>(pv["value"]) !== PROJECTION_VERSION) {
    const hasEvents = (await driver.exec("SELECT 1 AS x FROM events LIMIT 1")).length > 0;
    if (hasEvents) await repo.rebuild();
    await driver.exec(
      "INSERT INTO meta (key, value) VALUES ('projection_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [JSON.stringify(PROJECTION_VERSION)],
    );
  }
  return repo;
}
