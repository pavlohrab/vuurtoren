/**
 * Native mode: the card store. `applyNativeEvent` turns the native events into tables (called
 * from `applyEvent`, so live appends and `rebuild()` share it); `nativeQueries` reads them, and
 * `nativeWordEntries` gives the learner model the same per-word facts an Anki snapshot gives.
 */
import {
  type CardReview,
  type CardSchedule,
  DEFAULT_DECK_OPTIONS,
  DEFAULT_FSRS_PARAMS,
  type DeckOptions,
  type NativeCard,
  type NativeNote,
  type NativeNotetype,
  type WordKnowledge,
  classifyCard,
  mergeKnowledge,
  paramsDecay,
  scheduleMemory,
} from "@app/core";
import { compareHlc } from "./ids.js";
import type {
  AnkiWordEntry,
  AppEvent,
  FsrsParamsRecord,
  NativeCardView,
  NativeCollection,
  NativeDeckSummary,
  NativeKeyCard,
  NativeNoteStatus,
  NativeQueue,
  SqlDriver,
  SqlValue,
} from "./types.js";

type NativeEvent = Extract<
  AppEvent,
  {
    type:
      | "NativeNotesAdded"
      | "NativeDeckOptionsSet"
      | "CardReviewed"
      | "CardReviewUndone"
      | "NativeCardsChanged"
      | "FsrsParamsSet";
  }
>;

type Row = Record<string, SqlValue>;
const json = <T>(v: SqlValue | undefined): T => JSON.parse(String(v)) as T;
const DAY_MS = 86_400_000;
const CHUNK = 100;

/** Learning cards due this soon are shown when nothing else is left (Anki's learn-ahead). */
const LEARN_AHEAD_MS = 20 * 60_000;

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

async function setSchedule(
  driver: SqlDriver,
  cardId: number,
  schedule: CardSchedule | null,
): Promise<void> {
  await driver.exec("UPDATE native_cards SET schedule = ?, due = ? WHERE id = ?", [
    schedule ? JSON.stringify(schedule) : null,
    schedule ? schedule.due : null,
    cardId,
  ]);
}

const REVIEW_KIND = { 1: "learn", 2: "review", 3: "relearn" } as const;

/** Apply one native-mode event (inside the caller's transaction). */
export async function applyNativeEvent(
  driver: SqlDriver,
  ctx: { id: string; hlc: string; createdAt: number },
  e: NativeEvent,
): Promise<void> {
  switch (e.type) {
    case "NativeNotesAdded": {
      await insertMany(
        driver,
        "INSERT OR IGNORE INTO native_notetypes (id, data)",
        2,
        (e.notetypes ?? []).map((t) => [t.id, JSON.stringify(t)]),
      );
      await insertMany(
        driver,
        "INSERT OR IGNORE INTO native_decks (lang, name, options, updated_hlc)",
        4,
        (e.decks ?? []).map((d) => [e.lang, d.name, JSON.stringify(d.options), null]),
      );
      await insertMany(
        driver,
        "INSERT OR IGNORE INTO native_notes (id, lang, notetype_id, data, key, origin, created_at)",
        7,
        e.notes.map((n) => [
          n.id,
          e.lang,
          n.notetypeId,
          JSON.stringify(n),
          n.key ?? null,
          e.origin,
          ctx.createdAt,
        ]),
      );
      // Cards whose id is already held keep their state (and their history: see below).
      const ids = e.cards.map((c) => c.id);
      const held = new Set<number>();
      for (let i = 0; i < ids.length; i += 500) {
        const rows = await driver.exec(
          "SELECT id FROM native_cards WHERE id IN (SELECT value FROM json_each(?))",
          [JSON.stringify(ids.slice(i, i + 500))],
        );
        for (const r of rows) held.add(Number(r["id"]));
      }
      const fresh = e.cards.filter((c) => !held.has(c.id));
      await insertMany(
        driver,
        "INSERT INTO native_cards (id, lang, note_id, ord, deck, schedule, due, suspended, position)",
        9,
        fresh.map((c) => [
          c.id,
          e.lang,
          c.noteId,
          c.ord,
          c.deck,
          c.schedule ? JSON.stringify(c.schedule) : null,
          c.schedule ? c.schedule.due : null,
          c.suspended ? 1 : 0,
          c.position,
        ]),
      );
      const freshIds = new Set(fresh.map((c) => c.id));
      const reviews = (e.reviews ?? []).filter((r) => freshIds.has(r.cardId));
      await insertMany(
        driver,
        "INSERT OR IGNORE INTO native_reviews (id, lang, card_id, at, rating, kind, duration_ms, source, previous)",
        9,
        reviews.map((r, i) => [
          `${ctx.id}:${i}`,
          e.lang,
          r.cardId,
          r.at,
          r.rating,
          r.kind,
          r.durationMs,
          e.origin,
          null,
        ]),
      );
      await insertMany(
        driver,
        "INSERT OR REPLACE INTO native_media (lang, name, blob_id)",
        3,
        Object.entries(e.media ?? {}).map(([name, blob]) => [e.lang, name, blob]),
      );
      return;
    }
    case "NativeDeckOptionsSet": {
      const rows = await driver.exec(
        "SELECT updated_hlc FROM native_decks WHERE lang = ? AND name = ?",
        [e.lang, e.deck],
      );
      const prev = rows[0]?.["updated_hlc"];
      if (typeof prev === "string" && compareHlc(prev, ctx.hlc) >= 0) return;
      await driver.exec(
        "INSERT OR REPLACE INTO native_decks (lang, name, options, updated_hlc) VALUES (?,?,?,?)",
        [e.lang, e.deck, JSON.stringify(e.options), ctx.hlc],
      );
      return;
    }
    case "CardReviewed": {
      const exists = await driver.exec("SELECT 1 AS x FROM native_cards WHERE id = ?", [e.cardId]);
      if (exists.length === 0) return;
      await setSchedule(driver, e.cardId, e.schedule);
      await driver.exec(
        "INSERT OR REPLACE INTO native_reviews (id, lang, card_id, at, rating, kind, duration_ms, source, previous) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          ctx.id,
          e.lang,
          e.cardId,
          e.at,
          e.rating,
          e.previous ? REVIEW_KIND[e.previous.state as 1 | 2 | 3] : "learn",
          Math.max(0, Math.round(e.durationMs)),
          e.via ?? "kenning",
          e.previous ? JSON.stringify(e.previous) : null,
        ],
      );
      return;
    }
    case "CardReviewUndone": {
      const rows = await driver.exec(
        "SELECT previous FROM native_reviews WHERE id = ? AND card_id = ? AND source = 'kenning'",
        [e.reviewId, e.cardId],
      );
      const row = rows[0];
      if (!row) return;
      await setSchedule(
        driver,
        e.cardId,
        row["previous"] === null ? null : json<CardSchedule>(row["previous"]),
      );
      await driver.exec("DELETE FROM native_reviews WHERE id = ?", [e.reviewId]);
      return;
    }
    case "NativeCardsChanged":
      for (const c of e.changes) {
        if (c.schedule !== undefined) await setSchedule(driver, c.cardId, c.schedule);
        if (c.suspended !== undefined) {
          await driver.exec("UPDATE native_cards SET suspended = ? WHERE id = ?", [
            c.suspended ? 1 : 0,
            c.cardId,
          ]);
        }
        if (c.position !== undefined) {
          await driver.exec("UPDATE native_cards SET position = ? WHERE id = ?", [
            c.position,
            c.cardId,
          ]);
        }
      }
      return;
    case "FsrsParamsSet": {
      const record: FsrsParamsRecord = {
        params: e.params,
        reviews: e.reviews,
        at: ctx.createdAt,
        ...(e.historySize !== undefined ? { historySize: e.historySize } : {}),
        ...(e.logLoss !== undefined ? { logLoss: e.logLoss } : {}),
        ...(e.rmse !== undefined ? { rmse: e.rmse } : {}),
        ...(e.previousLogLoss !== undefined ? { previousLogLoss: e.previousLogLoss } : {}),
        ...(e.previousRmse !== undefined ? { previousRmse: e.previousRmse } : {}),
      };
      await driver.exec("INSERT OR REPLACE INTO fsrs_params (lang, data) VALUES (?,?)", [
        e.lang,
        JSON.stringify(record),
      ]);
      return;
    }
  }
}

function toCard(r: Row): NativeCard {
  const card: NativeCard = {
    id: Number(r["id"]),
    noteId: Number(r["note_id"]),
    ord: Number(r["ord"]),
    deck: String(r["deck"]),
    position: Number(r["position"]),
  };
  if (r["schedule"] !== null && r["schedule"] !== undefined) {
    card.schedule = json<CardSchedule>(r["schedule"]);
  }
  if (r["suspended"] === 1) card.suspended = true;
  return card;
}

async function deckOptions(driver: SqlDriver, lang: string): Promise<Map<string, DeckOptions>> {
  const rows = await driver.exec("SELECT name, options FROM native_decks WHERE lang = ?", [lang]);
  return new Map(
    rows.map((r) => [
      String(r["name"]),
      { ...DEFAULT_DECK_OPTIONS, ...json<Partial<DeckOptions>>(r["options"]) },
    ]),
  );
}

async function paramsOf(driver: SqlDriver, lang: string): Promise<FsrsParamsRecord | null> {
  const r = (await driver.exec("SELECT data FROM fsrs_params WHERE lang = ?", [lang]))[0];
  return r ? json<FsrsParamsRecord>(r["data"]) : null;
}

/** Cards with notes and note types, in the given card order. */
async function views(
  driver: SqlDriver,
  lang: string,
  cards: NativeCard[],
  options: Map<string, DeckOptions>,
): Promise<NativeCardView[]> {
  if (cards.length === 0) return [];
  const noteIds = [...new Set(cards.map((c) => c.noteId))];
  const notes = new Map<number, NativeNote>();
  for (const r of await driver.exec(
    "SELECT id, data FROM native_notes WHERE lang = ? AND id IN (SELECT value FROM json_each(?))",
    [lang, JSON.stringify(noteIds)],
  )) {
    notes.set(Number(r["id"]), json<NativeNote>(r["data"]));
  }
  const typeIds = [...new Set([...notes.values()].map((n) => n.notetypeId))];
  const types = new Map<string, NativeNotetype>();
  for (const r of await driver.exec(
    "SELECT id, data FROM native_notetypes WHERE id IN (SELECT value FROM json_each(?))",
    [JSON.stringify(typeIds)],
  )) {
    types.set(String(r["id"]), json<NativeNotetype>(r["data"]));
  }
  return cards.flatMap((card) => {
    const note = notes.get(card.noteId);
    const notetype = note ? types.get(note.notetypeId) : undefined;
    if (!note || !notetype) return [];
    return [{ card, note, notetype, options: options.get(card.deck) ?? DEFAULT_DECK_OPTIONS }];
  });
}

function dueText(due: number, now: number): string {
  const days = Math.ceil((due - now) / DAY_MS);
  if (days <= 0) return "due today";
  return days === 1 ? "due tomorrow" : `due in ${days} days`;
}

const CARD_TYPE = { 1: "learning", 2: "review", 3: "relearning" } as const;

export function nativeQueries(driver: SqlDriver) {
  return {
    async nativeDecks(lang: string, now: number): Promise<NativeDeckSummary[]> {
      const options = await deckOptions(driver, lang);
      const rows = await driver.exec(
        `SELECT deck,
                count(*) AS total,
                sum(schedule IS NULL) AS fresh,
                sum(schedule IS NOT NULL AND suspended = 0 AND due <= ?) AS due,
                sum(suspended) AS suspended
           FROM native_cards WHERE lang = ? GROUP BY deck`,
        [now, lang],
      );
      const byName = new Map(rows.map((r) => [String(r["deck"]), r]));
      const names = [...new Set([...options.keys(), ...byName.keys()])].sort();
      return names.map((name) => {
        const r = byName.get(name);
        return {
          name,
          options: options.get(name) ?? DEFAULT_DECK_OPTIONS,
          total: Number(r?.["total"] ?? 0),
          fresh: Number(r?.["fresh"] ?? 0),
          due: Number(r?.["due"] ?? 0),
          suspended: Number(r?.["suspended"] ?? 0),
        };
      });
    },

    async nativeQueue(
      lang: string,
      now: number,
      dayStart: number,
      limit: number,
    ): Promise<NativeQueue> {
      const options = await deckOptions(driver, lang);
      const dueRows = await driver.exec(
        `SELECT * FROM native_cards
          WHERE lang = ? AND suspended = 0 AND schedule IS NOT NULL AND due <= ?
          ORDER BY due, id`,
        [lang, now],
      );
      // New cards introduced today per deck (answered for the first time since dayStart).
      const introduced = new Map<string, number>();
      for (const r of await driver.exec(
        `SELECT c.deck AS deck, count(DISTINCT r.card_id) AS n
           FROM native_reviews r JOIN native_cards c ON c.id = r.card_id
          WHERE r.lang = ? AND r.source = 'kenning' AND r.previous IS NULL AND r.at >= ?
          GROUP BY c.deck`,
        [lang, dayStart],
      )) {
        introduced.set(String(r["deck"]), Number(r["n"]));
      }
      const fresh: NativeCard[] = [];
      for (const r of await driver.exec(
        `SELECT deck, count(*) AS n FROM native_cards
          WHERE lang = ? AND suspended = 0 AND schedule IS NULL GROUP BY deck ORDER BY deck`,
        [lang],
      )) {
        const deck = String(r["deck"]);
        const perDay = (options.get(deck) ?? DEFAULT_DECK_OPTIONS).newPerDay;
        const allowed = Math.min(Number(r["n"]), Math.max(0, perDay - (introduced.get(deck) ?? 0)));
        if (allowed === 0) continue;
        const rows = await driver.exec(
          `SELECT * FROM native_cards WHERE lang = ? AND deck = ? AND suspended = 0
             AND schedule IS NULL ORDER BY position, id LIMIT ?`,
          [lang, deck, allowed],
        );
        fresh.push(...rows.map(toCard));
      }
      fresh.sort((a, b) => a.position - b.position || a.id - b.id);
      // Related cards apart: after one card of a note (or of the same word) was answered today,
      // its other new and review cards wait for another day. Learning steps go on.
      const keyOf = new Map<number, string | null>();
      const cand = [...dueRows.map(toCard), ...fresh];
      for (const r of await driver.exec(
        "SELECT id, key FROM native_notes WHERE lang = ? AND id IN (SELECT value FROM json_each(?))",
        [lang, JSON.stringify([...new Set(cand.map((c) => c.noteId))])],
      )) {
        keyOf.set(Number(r["id"]), r["key"] === null ? null : String(r["key"]));
      }
      const answered = new Set<number>();
      const busy = new Set<string>();
      for (const r of await driver.exec(
        `SELECT DISTINCT r.card_id AS card, c.note_id AS note, n.key AS key
           FROM native_reviews r JOIN native_cards c ON c.id = r.card_id
           JOIN native_notes n ON n.id = c.note_id
          WHERE r.lang = ? AND r.at >= ? AND r.rating > 0`,
        [lang, dayStart],
      )) {
        answered.add(Number(r["card"]));
        busy.add(`n${String(r["note"])}`);
        if (r["key"] !== null) busy.add(`k${String(r["key"])}`);
      }
      const apart = (list: NativeCard[]) =>
        list.filter((c) => {
          const s = c.schedule;
          if (s && s.state !== 2) return true;
          if (answered.has(c.id)) return true;
          const tags = [`n${c.noteId}`];
          const key = keyOf.get(c.noteId);
          if (key) tags.push(`k${key}`);
          if (tags.some((t) => busy.has(t))) return false;
          // One of them per session: the next comes once this one is answered (then tomorrow).
          for (const t of tags) busy.add(t);
          return true;
        });
      const dueCards = apart(dueRows.map(toCard));
      const freshCards = apart(fresh);
      let cards = [...dueCards, ...freshCards];
      if (cards.length === 0) {
        // Nothing else today: learning cards due within the next minutes come forward.
        cards = (
          await driver.exec(
            `SELECT * FROM native_cards
              WHERE lang = ? AND suspended = 0 AND schedule IS NOT NULL AND due <= ?
                AND json_extract(schedule, '$.state') IN (1, 3)
              ORDER BY due, id`,
            [lang, now + LEARN_AHEAD_MS],
          )
        ).map(toCard);
      }
      return {
        cards: await views(driver, lang, cards.slice(0, Math.max(0, limit)), options),
        due: dueCards.length,
        fresh: freshCards.length,
      };
    },

    async nativeDueCounts(lang: string, from: number, days: number): Promise<number[]> {
      const out = Array.from({ length: Math.max(0, days) }, () => 0);
      for (const r of await driver.exec(
        `SELECT CAST((due - ?) / ? AS INTEGER) AS d, count(*) AS n FROM native_cards
          WHERE lang = ? AND suspended = 0 AND schedule IS NOT NULL AND due >= ? AND due < ?
            AND json_extract(schedule, '$.state') = 2
          GROUP BY d`,
        [from, DAY_MS, lang, from, from + days * DAY_MS],
      )) {
        const d = Number(r["d"]);
        if (d >= 0 && d < out.length) out[d] = Number(r["n"]);
      }
      return out;
    },

    async nativeCard(lang: string, cardId: number): Promise<NativeCardView | null> {
      const rows = await driver.exec("SELECT * FROM native_cards WHERE lang = ? AND id = ?", [
        lang,
        cardId,
      ]);
      if (!rows[0]) return null;
      return (
        (await views(driver, lang, [toCard(rows[0])], await deckOptions(driver, lang)))[0] ?? null
      );
    },

    async nativeReviews(lang: string): Promise<CardReview[]> {
      return (
        await driver.exec(
          "SELECT card_id, at, rating, kind, duration_ms FROM native_reviews WHERE lang = ? ORDER BY at, id",
          [lang],
        )
      ).map((r) => ({
        cardId: Number(r["card_id"]),
        at: Number(r["at"]),
        rating: Number(r["rating"]) as CardReview["rating"],
        kind: String(r["kind"]) as CardReview["kind"],
        durationMs: Number(r["duration_ms"]),
      }));
    },

    async nativeStats(lang: string) {
      const one = async (sql: string) => Number((await driver.exec(sql, [lang]))[0]?.["n"] ?? 0);
      return {
        notes: await one("SELECT count(*) AS n FROM native_notes WHERE lang = ?"),
        cards: await one("SELECT count(*) AS n FROM native_cards WHERE lang = ?"),
        reviews: await one("SELECT count(*) AS n FROM native_reviews WHERE lang = ?"),
      };
    },

    fsrsParams: (lang: string) => paramsOf(driver, lang),

    async nativeCollection(lang: string, decks: string[]): Promise<NativeCollection> {
      const options = await deckOptions(driver, lang);
      const all = decks.length === 0;
      const inDeck = (name: string) =>
        all || decks.some((d) => name === d || name.startsWith(`${d}::`));
      const cards = (
        await driver.exec("SELECT * FROM native_cards WHERE lang = ? ORDER BY id", [lang])
      )
        .map(toCard)
        .filter((c) => inDeck(c.deck));
      const noteIds = new Set(cards.map((c) => c.noteId));
      const notes: NativeNote[] = [];
      for (const r of await driver.exec(
        "SELECT id, data FROM native_notes WHERE lang = ? ORDER BY id",
        [lang],
      )) {
        if (noteIds.has(Number(r["id"]))) notes.push(json<NativeNote>(r["data"]));
      }
      const typeIds = [...new Set(notes.map((n) => n.notetypeId))];
      const notetypes = (
        await driver.exec(
          "SELECT data FROM native_notetypes WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id",
          [JSON.stringify(typeIds)],
        )
      ).map((r) => json<NativeNotetype>(r["data"]));
      const cardIds = new Set(cards.map((c) => c.id));
      const reviews = (
        await driver.exec(
          "SELECT card_id, at, rating, kind, duration_ms FROM native_reviews WHERE lang = ? ORDER BY at, id",
          [lang],
        )
      )
        .filter((r) => cardIds.has(Number(r["card_id"])))
        .map((r) => ({
          cardId: Number(r["card_id"]),
          at: Number(r["at"]),
          rating: Number(r["rating"]) as CardReview["rating"],
          kind: String(r["kind"]) as CardReview["kind"],
          durationMs: Number(r["duration_ms"]),
        }));
      const deckNames = [...new Set(cards.map((c) => c.deck))].sort();
      const media = Object.fromEntries(
        (await driver.exec("SELECT name, blob_id FROM native_media WHERE lang = ?", [lang])).map(
          (r) => [String(r["name"]), String(r["blob_id"])],
        ),
      );
      return {
        notetypes,
        decks: deckNames.map((name) => ({
          name,
          options: options.get(name) ?? DEFAULT_DECK_OPTIONS,
        })),
        notes,
        cards,
        reviews,
        media,
      };
    },

    async nativeMedia(lang: string, names: string[]): Promise<Record<string, string>> {
      if (names.length === 0) return {};
      const rows = await driver.exec(
        "SELECT name, blob_id FROM native_media WHERE lang = ? AND name IN (SELECT value FROM json_each(?))",
        [lang, JSON.stringify(names)],
      );
      return Object.fromEntries(rows.map((r) => [String(r["name"]), String(r["blob_id"])]));
    },

    async nativeKeyCards(lang: string, keys: string[], dayStart: number): Promise<NativeKeyCard[]> {
      if (keys.length === 0) return [];
      const options = await deckOptions(driver, lang);
      const rows = await driver.exec(
        `SELECT c.*, n.key AS word_key,
                EXISTS (SELECT 1 FROM native_reviews r
                         WHERE r.card_id = c.id AND r.at >= ? AND r.rating > 0) AS answered
           FROM native_cards c JOIN native_notes n ON n.id = c.note_id
          WHERE c.lang = ? AND n.key IN (SELECT value FROM json_each(?))
          ORDER BY c.due, c.id`,
        [dayStart, lang, JSON.stringify(keys)],
      );
      return rows.map((r) => {
        const card = toCard(r);
        return {
          key: String(r["word_key"]),
          card,
          options: options.get(card.deck) ?? DEFAULT_DECK_OPTIONS,
          answeredToday: Number(r["answered"]) === 1,
        };
      });
    },

    async nativeNoteStatus(
      lang: string,
      noteIds: number[],
      now: number,
    ): Promise<NativeNoteStatus[]> {
      if (noteIds.length === 0) return [];
      const rows = await driver.exec(
        `SELECT * FROM native_cards WHERE lang = ? AND note_id IN (SELECT value FROM json_each(?))
          ORDER BY ord, id`,
        [lang, JSON.stringify(noteIds)],
      );
      const byNote = new Map<number, NativeNoteStatus>();
      for (const card of rows.map(toCard)) {
        let note = byNote.get(card.noteId);
        if (!note)
          byNote.set(card.noteId, (note = { noteId: card.noteId, deck: card.deck, cards: [] }));
        const s = card.schedule;
        note.cards.push({
          cardId: card.id,
          type: s ? CARD_TYPE[s.state as 1 | 2 | 3] : "new",
          suspended: card.suspended === true,
          buried: false,
          intervalDays: s?.state === 2 ? s.scheduledDays : 0,
          ...(s?.state === 2 ? { dueText: dueText(s.due, now) } : {}),
        });
      }
      return noteIds.flatMap((id) => byNote.get(id) ?? []);
    },
  };
}

/** Per-word facts from the native cards, plus the notes added in Kenning not yet answered. */
export interface NativeWordFacts {
  entries: Map<string, AnkiWordEntry>;
  /** Words added in Kenning whose cards are all new: "learning" until first answered. */
  pending: Map<string, { noteId: number; deck: string }>;
}

/**
 * The learner model's view of the native cards, with the same rules as an Anki snapshot: each
 * note's strongest card, read with the FSRS forgetting curve of the parameters in use, merged
 * per key and alias (strongest evidence wins).
 */
export async function nativeWordEntries(
  driver: SqlDriver,
  lang: string,
  nowMs: number,
  keys?: ReadonlySet<string>,
): Promise<NativeWordFacts> {
  const params = await paramsOf(driver, lang);
  const decay = paramsDecay(params?.params ?? DEFAULT_FSRS_PARAMS);
  const cards = new Map<number, NativeCard[]>();
  for (const r of await driver.exec("SELECT * FROM native_cards WHERE lang = ? ORDER BY ord, id", [
    lang,
  ])) {
    const c = toCard(r);
    const list = cards.get(c.noteId);
    if (list) list.push(c);
    else cards.set(c.noteId, [c]);
  }
  const entries = new Map<string, AnkiWordEntry>();
  const knowledge = new Map<string, WordKnowledge>();
  const pending = new Map<string, { noteId: number; deck: string }>();
  for (const r of await driver.exec(
    "SELECT id, data, origin FROM native_notes WHERE lang = ? AND key IS NOT NULL ORDER BY id",
    [lang],
  )) {
    const note = json<NativeNote>(r["data"]);
    const own = cards.get(note.id) ?? [];
    let best: WordKnowledge = { state: "unknown", pKnown: 0 };
    for (const c of own) {
      best = mergeKnowledge(
        best,
        classifyCard(scheduleMemory(c.schedule, decay, c.suspended), nowMs),
      );
    }
    const decks = [...new Set(own.map((c) => c.deck))];
    for (const key of [note.key ?? "", ...(note.aliases ?? [])]) {
      if (!key || (keys && !keys.has(key))) continue;
      const k = mergeKnowledge(knowledge.get(key), best);
      knowledge.set(key, k);
      const prev = entries.get(key);
      const entry: AnkiWordEntry = {
        key,
        state: k.state,
        pKnown: k.pKnown,
        noteIds: [...new Set([...(prev?.noteIds ?? []), note.id])],
        decks: [...new Set([...(prev?.decks ?? []), ...decks])],
      };
      const gloss = prev?.gloss ?? note.gloss;
      if (gloss) entry.gloss = gloss;
      const article = prev?.article ?? note.article;
      if (article) entry.article = article;
      const sentence = prev?.sentence ?? note.sentence;
      if (sentence) {
        entry.sentence = sentence;
        const tr = prev?.sentence ? prev.sentenceTranslation : note.sentenceTranslation;
        if (tr) entry.sentenceTranslation = tr;
      }
      entries.set(key, entry);
      const fresh = own.length > 0 && own.every((c) => !c.schedule && !c.suspended);
      if (r["origin"] === "kenning" && fresh && !pending.has(key)) {
        pending.set(key, { noteId: note.id, deck: own[0]!.deck });
      }
    }
  }
  return { entries, pending };
}
