/**
 * Repository over any `SqlDriver`: appends events and keeps projections in sync, answers queries.
 */
import type { AnalyzedToken, LearnerModel, StaircaseState, WordState } from "@app/core";
import { createHlc, createUlidGenerator, randomDeviceId } from "./ids.js";
import {
  type EventContext,
  type Row,
  type WordFacts,
  applyEvent,
  composeWord,
} from "./projections.js";
import { PROJECTION_TABLES, migrate } from "./schema.js";
import type {
  AnkiWordEntry,
  AppEvent,
  Repository,
  SqlDriver,
  SqlValue,
  StoredEvent,
  StoredText,
  TextSummary,
  WordInfo,
} from "./types.js";

export interface RepositoryOptions {
  /** Override the persisted device id (mainly for tests). */
  deviceId?: string;
  /** Clock in ms since epoch; injectable for tests. */
  now?: () => number;
}

/** `Repository` plus lifecycle, log access and snapshot metadata. */
export interface KenningRepository extends Repository {
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
  /** This device's id. */
  readonly deviceId: string;
}

/**
 * Bump when a projection's meaning changes. 2: reading_progress.last_segment = next segment to read. 3: write-action events (ADR 0007).
 */
export const PROJECTION_VERSION = 3;

const json = <T>(v: SqlValue | undefined): T => JSON.parse(String(v)) as T;

function textSummary(r: Row): TextSummary {
  return {
    id: String(r["id"]),
    title: String(r["title"]),
    lang: String(r["lang"]),
    sourceKind: String(r["source_kind"]) as TextSummary["sourceKind"],
    createdAt: Number(r["created_at"]),
    wordCount: Number(r["word_count"]),
    analyzed: r["analyzed"] !== null,
    lastSegment: Number(r["last_segment"] ?? 0),
  };
}

const TEXT_COLS = `t.id, t.title, t.lang, t.source_kind, t.created_at, t.word_count,
    tt.text_id AS analyzed, rp.last_segment`;
const TEXT_FROM = `FROM texts t
  LEFT JOIN text_tokens tt ON tt.text_id = t.id
  LEFT JOIN reading_progress rp ON rp.text_id = t.id`;

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
): Promise<KenningRepository> {
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

  // Resume clocks past the newest stored event so ids/hlcs stay monotonic across restarts.
  const lastHlc = (await driver.exec("SELECT hlc FROM events ORDER BY hlc DESC LIMIT 1"))[0]?.[
    "hlc"
  ];
  const lastId = (await driver.exec("SELECT id FROM events ORDER BY id DESC LIMIT 1"))[0]?.["id"];
  const hlc = createHlc(deviceId, now, typeof lastHlc === "string" ? lastHlc : undefined);
  const nextId = createUlidGenerator(
    now,
    undefined,
    typeof lastId === "string" ? lastId : undefined,
  );

  const toStored = (r: Row): StoredEvent => ({
    id: String(r["id"]),
    deviceId: String(r["device_id"]),
    hlc: String(r["hlc"]),
    event: json<AppEvent>(r["payload"]),
  });

  /** Gather facts for all words (or one key) of a language and compose them. */
  async function loadWords(lang: string, key?: string): Promise<Map<string, WordInfo>> {
    const k = key === undefined ? "" : " AND key = ?";
    const p = key === undefined ? [lang] : [lang, key];
    const facts = new Map<string, WordFacts>();
    const get = (key: string): WordFacts => {
      let f = facts.get(key);
      if (!f) facts.set(key, (f = { lookups: 0 }));
      return f;
    };
    for (const r of await driver.exec(`SELECT * FROM anki_words WHERE lang = ?${k}`, p)) {
      get(String(r["key"])).anki = ankiEntry(r);
    }
    for (const r of await driver.exec(`SELECT * FROM word_overrides WHERE lang = ?${k}`, p)) {
      // An empty state is the tombstone left by WordStateCleared.
      if (r["state"] === "") continue;
      const f = get(String(r["key"]));
      f.override = String(r["state"]) as WordState;
      f.markedKnownInAnki = r["marked_anki"] === 1;
    }
    for (const r of await driver.exec(`SELECT * FROM word_lookups WHERE lang = ?${k}`, p)) {
      get(String(r["key"])).lookups = Number(r["count"]);
    }
    for (const r of await driver.exec(`SELECT * FROM notes_added WHERE lang = ?${k}`, p)) {
      get(String(r["key"])).note = { noteId: Number(r["note_id"]), deck: String(r["deck"]) };
    }
    for (const r of await driver.exec(`SELECT * FROM prioritized WHERE lang = ?${k}`, p)) {
      get(String(r["key"])).prioritizedNoteId = Number(r["note_id"]);
    }
    const out = new Map<string, WordInfo>();
    for (const [key, f] of [...facts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const info = composeWord(key, f);
      if (info) out.set(key, info);
    }
    return out;
  }

  const repo: KenningRepository = {
    deviceId,

    append: (event) =>
      serial(async () => {
        const id = nextId();
        const stamp = hlc.tick();
        const createdAt = now();
        const ctx: EventContext = { id, hlc: stamp, createdAt, event };
        await driver.transaction(async () => {
          await driver.exec(
            "INSERT INTO events (id, device_id, hlc, type, payload, created_at) VALUES (?,?,?,?,?,?)",
            [id, deviceId, stamp, event.type, JSON.stringify(event), createdAt],
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

    getText: (id) =>
      serial(async () => {
        const rows = await driver.exec(
          `SELECT ${TEXT_COLS}, t.content, tt.tokens ${TEXT_FROM} WHERE t.id = ?`,
          [id],
        );
        const r = rows[0];
        if (!r) return null;
        const text: StoredText = {
          ...textSummary(r),
          content: String(r["content"]),
          tokens: r["tokens"] === null ? null : json<AnalyzedToken[]>(r["tokens"]),
        };
        return text;
      }),

    learnerModel: (lang) =>
      serial(async () => {
        const model: LearnerModel = new Map();
        for (const [key, w] of await loadWords(lang)) {
          model.set(key, { state: w.state, pKnown: w.pKnown });
        }
        return model;
      }),

    word: (lang, key) => serial(async () => (await loadWords(lang, key)).get(key) ?? null),

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

    setting: <T>(key: string) =>
      serial(async () => {
        const rows = await driver.exec("SELECT value FROM settings WHERE key = ?", [key]);
        return rows[0] ? json<T>(rows[0]["value"]) : undefined;
      }),

    rebuild: () =>
      serial(() =>
        driver.transaction(async () => {
          for (const t of PROJECTION_TABLES) await driver.exec(`DELETE FROM ${t}`);
          await driver.exec("DELETE FROM meta WHERE key LIKE 'snapshot:%'");
          const rows = await driver.exec("SELECT * FROM events ORDER BY id");
          for (const r of rows) {
            const s = toStored(r);
            await applyEvent(driver, {
              id: s.id,
              hlc: s.hlc,
              createdAt: Number(r["created_at"]),
              event: s.event,
            });
          }
        }),
      ),

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

    close: () => serial(() => driver.close()),
  };

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
