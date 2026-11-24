/**
 * Native mode: the card store. `applyNativeEvent` turns the native events into tables (called
 * from `applyEvent`, so live appends and `rebuild()` share it); `nativeQueries` reads them, and
 * `nativeWordEntries` gives the learner model the same per-word facts an Anki snapshot gives.
 */
import {
  type CardRating,
  type CardReview,
  type CardSchedule,
  DEFAULT_DECK_OPTIONS,
  DEFAULT_FSRS_PARAMS,
  type DeckOptions,
  type NativeCard,
  type NativeNote,
  type NativeNotetype,
  type WordKnowledge,
  answerCard,
  classifyCard,
  mergeKnowledge,
  paramsDecay,
  scheduleMemory,
  studyDayStart,
} from "@app/core";
import { insertMany } from "./driver-core.js";
import { compareHlc } from "./ids.js";
import type {
  AnkiWordEntry,
  AppEvent,
  FsrsParamsRecord,
  NativeCardChange,
  NativeCardView,
  NativeCollection,
  NativeDeckSummary,
  NativeKeyCard,
  NativeNoteStatus,
  NativeQueue,
  QueueExtra,
  NativeQueueCounts,
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

/** Learning cards due this soon are shown when nothing else is left (Anki's learn-ahead). */
const LEARN_AHEAD_MS = 20 * 60_000;

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

/** The same memory and due date (both new counts as the same). */
function sameSchedule(a: CardSchedule | undefined, b: CardSchedule | undefined): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.due === b.due &&
    a.lastReview === b.lastReview &&
    a.state === b.state &&
    a.reps === b.reps &&
    a.lapses === b.lapses &&
    a.stability === b.stability &&
    a.difficulty === b.difficulty
  );
}

/**
 * A reading move or a memory update applied to the card as it is now, or null to leave it.
 * Both stand back when the card was answered since they were made (`lastReview` differs): the
 * answer is the stronger evidence, and it was scheduled from the card the device saw.
 */
function intended(
  s: CardSchedule,
  suspended: boolean,
  c: NativeCardChange,
  paramsInUse: boolean,
): CardSchedule | null {
  let next: CardSchedule | null = null;
  const d = c.due;
  if (d && s.state === 2 && !suspended && s.lastReview === d.lastReview) {
    if (d.to === "later" && s.due < d.dayEnd) next = { ...s, due: d.at + d.days * DAY_MS };
    if (d.to === "now" && s.due >= d.dayEnd) next = { ...s, due: d.at };
  }
  const m = c.memory;
  if (m && paramsInUse && s.lastReview === m.lastReview) {
    next = { ...(next ?? s), stability: m.stability, difficulty: m.difficulty };
  }
  return next;
}

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
      const rows = await driver.exec("SELECT deck, schedule FROM native_cards WHERE id = ?", [
        e.cardId,
      ]);
      const row = rows[0];
      if (!row) return;
      const current = row["schedule"] === null ? undefined : json<CardSchedule>(row["schedule"]);
      let schedule = e.schedule;
      if (!sameSchedule(current, e.previous)) {
        // Answered on another device in the meantime (sync): this answer applies to the card
        // as it is now, so both answers count. The result comes from this app's scheduler
        // whenever the log is replayed; devices on app versions whose FSRS differs could
        // disagree slightly on such a card until its next answer.
        const options = (await deckOptions(driver, e.lang)).get(String(row["deck"]));
        const params = (await paramsOf(driver, e.lang))?.params ?? DEFAULT_FSRS_PARAMS;
        schedule = answerCard(current, e.rating, e.at, {
          options: options ?? DEFAULT_DECK_OPTIONS,
          params,
          fuzz: false,
        });
      }
      await setSchedule(driver, e.cardId, schedule);
      await driver.exec(
        "INSERT OR REPLACE INTO native_reviews (id, lang, card_id, at, rating, kind, duration_ms, source, previous) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          ctx.id,
          e.lang,
          e.cardId,
          e.at,
          e.rating,
          current ? REVIEW_KIND[current.state as 1 | 2 | 3] : "learn",
          Math.max(0, Math.round(e.durationMs)),
          e.via ?? "vuurtoren",
          current ? JSON.stringify(current) : null,
        ],
      );
      return;
    }
    case "CardReviewUndone": {
      const rows = await driver.exec(
        `SELECT rowid AS seq, previous FROM native_reviews
          WHERE id = ? AND card_id = ? AND source = 'vuurtoren'`,
        [e.reviewId, e.cardId],
      );
      const row = rows[0];
      if (!row) return;
      let schedule = row["previous"] === null ? undefined : json<CardSchedule>(row["previous"]);
      await driver.exec("DELETE FROM native_reviews WHERE id = ?", [e.reviewId]);
      // Answers applied after this one (from another device, merged) still count: the card is
      // replayed from the schedule before the undone answer through each of them, in order.
      // Rows are inserted in the order events apply, which is clock order on every device.
      const later = await driver.exec(
        `SELECT id, at, rating FROM native_reviews
          WHERE card_id = ? AND rowid > ? AND rating > 0 ORDER BY rowid`,
        [e.cardId, Number(row["seq"])],
      );
      if (later.length > 0) {
        const deck = (
          await driver.exec("SELECT deck FROM native_cards WHERE id = ?", [e.cardId])
        )[0];
        const ctx = {
          options:
            (await deckOptions(driver, e.lang)).get(String(deck?.["deck"])) ?? DEFAULT_DECK_OPTIONS,
          params: (await paramsOf(driver, e.lang))?.params ?? DEFAULT_FSRS_PARAMS,
          fuzz: false,
        };
        for (const r of later) {
          await driver.exec("UPDATE native_reviews SET kind = ?, previous = ? WHERE id = ?", [
            schedule ? REVIEW_KIND[schedule.state] : "learn",
            schedule ? JSON.stringify(schedule) : null,
            String(r["id"]),
          ]);
          schedule = answerCard(schedule, Number(r["rating"]) as CardRating, Number(r["at"]), ctx);
        }
      }
      await setSchedule(driver, e.cardId, schedule ?? null);
      return;
    }
    case "NativeCardsChanged": {
      const params = e.params
        ? ((await paramsOf(driver, e.lang))?.params ?? DEFAULT_FSRS_PARAMS)
        : null;
      const paramsInUse = !!e.params && JSON.stringify(e.params) === JSON.stringify(params);
      for (const c of e.changes) {
        if (c.schedule !== undefined) await setSchedule(driver, c.cardId, c.schedule);
        if (c.due || c.memory) {
          const row = (
            await driver.exec("SELECT schedule, suspended FROM native_cards WHERE id = ?", [
              c.cardId,
            ])
          )[0];
          const s =
            row && row["schedule"] !== null ? json<CardSchedule>(row["schedule"]) : undefined;
          const next = s && intended(s, row?.["suspended"] === 1, c, paramsInUse);
          if (next) await setSchedule(driver, c.cardId, next);
        }
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
    }
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

/** What the queue needs of a card to choose it: no schedule JSON, no fields. */
interface QueueRow {
  id: number;
  noteId: number;
  /** FSRS state, null for a new card. */
  state: number | null;
  key: string | null;
  position: number;
  /** Due time, null for a new card. */
  due: number | null;
}

const QUEUE_COLUMNS = `c.id AS id, c.note_id AS note_id, c.position AS position, c.due AS due,
  json_extract(c.schedule, '$.state') AS state, n.key AS key
  FROM native_cards c LEFT JOIN native_notes n ON n.id = c.note_id AND n.lang = c.lang`;

function toQueueRow(r: Row): QueueRow {
  return {
    id: Number(r["id"]),
    noteId: Number(r["note_id"]),
    state: r["state"] === null || r["state"] === undefined ? null : Number(r["state"]),
    key: r["key"] === null || r["key"] === undefined ? null : String(r["key"]),
    position: Number(r["position"]),
    due: r["due"] === null || r["due"] === undefined ? null : Number(r["due"]),
  };
}

/**
 * Which cards are in today's queue, in order (the ids only): (re)learning cards whose step is due,
 * then review cards due today, then each deck's new cards within its daily limit, with related
 * cards apart. As in Anki, a review card is due for the whole day it falls on (the study day
 * starts at 4:00), not from the minute it was answered on an earlier day, and a learning card
 * comes before the reviews as soon as its step is due, so a word answered Again comes back after
 * its minute instead of after all of today's reviews. Both the queue
 * and its counts (the Words badge) come from here, so they always agree.
 */
async function queuePlan(
  driver: SqlDriver,
  lang: string,
  now: number,
  dayStart: number,
  options: Map<string, DeckOptions>,
  newCap?: number,
  reviewCap?: number,
): Promise<{ learnIds: number[]; reviewIds: number[]; dueIds: number[]; freshIds: number[] }> {
  const dueRows = (
    await driver.exec(
      `SELECT ${QUEUE_COLUMNS}
        WHERE c.lang = ? AND c.suspended = 0 AND c.schedule IS NOT NULL
          AND (c.due <= ? OR (json_extract(c.schedule, '$.state') = 2 AND c.due < ?))
        ORDER BY json_extract(c.schedule, '$.state') = 2, c.due, c.id`,
      [lang, now, dayStart + DAY_MS],
    )
  ).map(toQueueRow);
  // New cards introduced today per deck (answered for the first time since dayStart).
  const introduced = new Map<string, number>();
  for (const r of await driver.exec(
    `SELECT c.deck AS deck, count(DISTINCT r.card_id) AS n
       FROM native_reviews r JOIN native_cards c ON c.id = r.card_id
      WHERE r.lang = ? AND r.source = 'vuurtoren' AND r.previous IS NULL AND r.at >= ?
      GROUP BY c.deck`,
    [lang, dayStart],
  )) {
    introduced.set(String(r["deck"]), Number(r["n"]));
  }
  const fresh: QueueRow[] = [];
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
      `SELECT ${QUEUE_COLUMNS}
        WHERE c.lang = ? AND c.deck = ? AND c.suspended = 0 AND c.schedule IS NULL
        ORDER BY c.position, c.id LIMIT ?`,
      [lang, deck, allowed],
    );
    fresh.push(...rows.map(toQueueRow));
  }
  fresh.sort((a, b) => a.position - b.position || a.id - b.id);
  // One limit for all decks together: what is left of it today, words added while reading first.
  if (newCap !== undefined) {
    let today = 0;
    for (const n of introduced.values()) today += n;
    fresh.splice(Math.max(0, newCap - today));
  }
  // Related cards apart: after one card of a note (or of the same word) was answered today,
  // its other new and review cards wait for another day. Learning steps go on.
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
  const apart = (list: QueueRow[]) =>
    list
      .filter((c) => {
        if (c.state !== null && c.state !== 2) return true;
        if (answered.has(c.id)) return true;
        const tags = [`n${c.noteId}`];
        if (c.key) tags.push(`k${c.key}`);
        if (tags.some((t) => busy.has(t))) return false;
        // One of them per session: the next comes once this one is answered (then tomorrow).
        for (const t of tags) busy.add(t);
        return true;
      })
      .map((c) => c.id);
  const learnIds = apart(dueRows.filter((c) => c.state !== 2));
  // Reviews by the day they fell due (the most overdue first), shuffled within a day the same way
  // all day long, so the queue stays put between answers (Anki: "due date, then random").
  const dayOf = (c: QueueRow) => Math.floor(((c.due ?? 0) - dayStart) / DAY_MS);
  const shuffled = dueRows
    .filter((c) => c.state === 2)
    .sort((a, b) => dayOf(a) - dayOf(b) || dayHash(a.id, dayStart) - dayHash(b.id, dayStart));
  let reviewIds = apart(shuffled);
  // At most `reviewCap` reviews a day, counting the ones already done today (Anki's 200).
  if (reviewCap !== undefined) {
    const [done] = await driver.exec(
      `SELECT count(DISTINCT card_id) AS n FROM native_reviews
        WHERE lang = ? AND at >= ? AND rating > 0 AND kind = 'review'`,
      [lang, dayStart],
    );
    reviewIds = reviewIds.slice(0, Math.max(0, reviewCap - Number(done?.["n"] ?? 0)));
  }
  return {
    learnIds,
    reviewIds,
    dueIds: [...learnIds, ...reviewIds],
    freshIds: apart(fresh),
  };
}

/** A number from a card id and the day, the same all day: the order of a day's reviews. */
function dayHash(id: number, day: number): number {
  let h = Math.imul(id ^ Math.floor(day / DAY_MS), 2654435761);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * New cards spread evenly through the reviews, as Anki does by default ("mix with reviews"):
 * with 100 reviews and 20 new cards, a new card about every sixth card.
 */
export function mixIn(reviews: readonly number[], fresh: readonly number[]): number[] {
  if (fresh.length === 0) return [...reviews];
  if (reviews.length === 0) return [...fresh];
  const out: number[] = [];
  const total = reviews.length + fresh.length;
  let r = 0;
  let f = 0;
  for (let i = 0; i < total; i++) {
    // Put the next new card where its even share says it belongs.
    const wantNew =
      f < fresh.length &&
      (r >= reviews.length || (f + 1) / (fresh.length + 1) <= (i + 1) / (total + 1));
    if (wantNew) out.push(fresh[f++]!);
    else out.push(reviews[r++]!);
  }
  return out;
}

/**
 * Cards beyond today's queue (custom study): new cards past the daily limits by position (words
 * added while reading first, then the starter words by frequency rank, across levels); or learned cards not due yet and not answered today, the soonest due first.
 */
async function extraIds(
  driver: SqlDriver,
  lang: string,
  now: number,
  dayStart: number,
  extra: QueueExtra,
): Promise<number[]> {
  const rows =
    extra.kind === "new"
      ? await driver.exec(
          `SELECT id FROM native_cards
            WHERE lang = ? AND suspended = 0 AND schedule IS NULL
            ORDER BY position, id LIMIT ?`,
          [lang, extra.count + 200],
        )
      : await driver.exec(
          `SELECT c.id AS id FROM native_cards c
            WHERE c.lang = ? AND c.suspended = 0 AND c.schedule IS NOT NULL AND c.due > ?
              AND NOT EXISTS (SELECT 1 FROM native_reviews r
                               WHERE r.card_id = c.id AND r.at >= ? AND r.rating > 0)
            ORDER BY c.due, c.id LIMIT ?`,
          [lang, now, dayStart, extra.count],
        );
  return rows.map((r) => Number(r["id"]));
}

/** When the next card not due yet becomes due (a learning step, tomorrow's reviews), or null. */
async function nextDue(driver: SqlDriver, lang: string, now: number): Promise<number | null> {
  const [r] = await driver.exec(
    `SELECT min(due) AS due FROM native_cards
      WHERE lang = ? AND suspended = 0 AND schedule IS NOT NULL AND due > ?`,
    [lang, now],
  );
  const due = r?.["due"];
  return due === null || due === undefined ? null : Number(due);
}

export function nativeQueries(driver: SqlDriver) {
  return {
    async nativeDecks(lang: string, now: number): Promise<NativeDeckSummary[]> {
      const options = await deckOptions(driver, lang);
      const rows = await driver.exec(
        `SELECT deck,
                count(*) AS total,
                sum(schedule IS NULL) AS fresh,
                sum(schedule IS NOT NULL AND suspended = 0 AND (due <= ?
                    OR (json_extract(schedule, '$.state') = 2 AND due < ?))) AS due,
                sum(suspended) AS suspended
           FROM native_cards WHERE lang = ? GROUP BY deck`,
        [now, studyDayStart(now) + DAY_MS, lang],
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
      extra?: QueueExtra,
      newCap?: number,
      reviewCap?: number,
    ): Promise<NativeQueue> {
      const options = await deckOptions(driver, lang);
      const { learnIds, reviewIds, dueIds, freshIds } = await queuePlan(
        driver,
        lang,
        now,
        dayStart,
        options,
        newCap,
        reviewCap,
      );
      const today = new Set([...dueIds, ...freshIds]);
      const more =
        extra && extra.count > 0
          ? (await extraIds(driver, lang, now, dayStart, extra))
              .filter((id) => !today.has(id))
              .slice(0, extra.count)
          : [];
      const ids = [...learnIds, ...mixIn(reviewIds, freshIds), ...more].slice(
        0,
        Math.max(0, limit),
      );
      let cards: NativeCard[];
      if (ids.length === 0 && limit > 0) {
        // Nothing else today: learning cards due within the next minutes come forward.
        cards = (
          await driver.exec(
            `SELECT * FROM native_cards
              WHERE lang = ? AND suspended = 0 AND schedule IS NOT NULL AND due <= ?
                AND json_extract(schedule, '$.state') IN (1, 3)
              ORDER BY due, id LIMIT ?`,
            [lang, now + LEARN_AHEAD_MS, limit],
          )
        ).map(toCard);
      } else {
        const byId = new Map<number, NativeCard>();
        if (ids.length > 0) {
          for (const r of await driver.exec(
            "SELECT * FROM native_cards WHERE lang = ? AND id IN (SELECT value FROM json_each(?))",
            [lang, JSON.stringify(ids)],
          )) {
            const c = toCard(r);
            byId.set(c.id, c);
          }
        }
        cards = ids.flatMap((id) => byId.get(id) ?? []);
      }
      return {
        cards: await views(driver, lang, cards, options),
        due: dueIds.length,
        fresh: freshIds.length,
        nextDue: await nextDue(driver, lang, now),
      };
    },

    async nativeQueueCounts(
      lang: string,
      now: number,
      dayStart: number,
      newCap?: number,
      reviewCap?: number,
    ): Promise<NativeQueueCounts> {
      const options = await deckOptions(driver, lang);
      const { dueIds, freshIds } = await queuePlan(
        driver,
        lang,
        now,
        dayStart,
        options,
        newCap,
        reviewCap,
      );
      return {
        due: dueIds.length,
        fresh: freshIds.length,
        nextDue: await nextDue(driver, lang, now),
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

    async nativeDueKeys(
      lang: string,
      now: number,
      limit: number,
    ): Promise<{ key: string; due: number }[]> {
      return (
        await driver.exec(
          `SELECT n.key AS key, min(c.due) AS due FROM native_cards c
             JOIN native_notes n ON n.id = c.note_id
            WHERE c.lang = ? AND c.suspended = 0 AND c.schedule IS NOT NULL AND c.due <= ?
              AND n.key IS NOT NULL
            GROUP BY n.key ORDER BY due, n.key LIMIT ?`,
          [lang, now, Math.max(0, Math.floor(limit))],
        )
      ).map((r) => ({ key: String(r["key"]), due: Number(r["due"]) }));
    },

    async nativeCardReviews(lang: string, cardIds: number[]): Promise<CardReview[]> {
      if (cardIds.length === 0) return [];
      return (
        await driver.exec(
          `SELECT card_id, at, rating, kind, duration_ms FROM native_reviews
            WHERE lang = ? AND card_id IN (SELECT value FROM json_each(?)) ORDER BY at, id`,
          [lang, JSON.stringify(cardIds)],
        )
      ).map((r) => ({
        cardId: Number(r["card_id"]),
        at: Number(r["at"]),
        rating: Number(r["rating"]) as CardReview["rating"],
        kind: String(r["kind"]) as CardReview["kind"],
        durationMs: Number(r["duration_ms"]),
      }));
    },

    async nativeLastReview(
      lang: string,
    ): Promise<{ cardId: number; reviewId: string; at: number } | null> {
      // This device's newest answer on the review screen, and only while it is still its card's
      // latest: an answer another device gave after it is never taken back from here.
      const r = (
        await driver.exec(
          `SELECT r.id, r.card_id, r.at,
                  EXISTS (SELECT 1 FROM native_reviews o
                           WHERE o.card_id = r.card_id AND o.rowid > r.rowid) AS answered_since
             FROM native_reviews r JOIN events e ON e.id = r.id
            WHERE r.lang = ? AND r.source = 'vuurtoren'
              AND e.device_id = (SELECT json_extract(value, '$') FROM meta WHERE key = 'device_id')
            ORDER BY r.at DESC, r.id DESC LIMIT 1`,
          [lang],
        )
      )[0];
      return r && Number(r["answered_since"]) === 0
        ? { cardId: Number(r["card_id"]), reviewId: String(r["id"]), at: Number(r["at"]) }
        : null;
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

/** Per-word facts from the native cards, plus the notes added in Vuurtoren not yet answered. */
export interface NativeWordFacts {
  entries: Map<string, AnkiWordEntry>;
  /** Words added in Vuurtoren whose cards are all new: "learning" until first answered. */
  pending: Map<string, { noteId: number; deck: string }>;
}

/** Up to this many words are looked up in SQL; more read every note (one pass is cheaper). */
const FEW_KEYS = 500;

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
  // A few words (a word sheet, a page's glosses): only their notes and cards come back, chosen
  // in SQL by key or alias. Reading every note and card for one word cost 70–110 ms (A9).
  const few = keys !== undefined && keys.size <= FEW_KEYS;
  const wanted = few ? JSON.stringify([...keys]) : "";
  const noteRows = few
    ? await driver.exec(
        `SELECT n.id, n.data, n.origin FROM native_notes n
         WHERE n.lang = ? AND n.key IS NOT NULL
           AND (n.key IN (SELECT value FROM json_each(?))
             OR EXISTS (SELECT 1 FROM json_each(n.data, '$.aliases') a
                        WHERE a.value IN (SELECT value FROM json_each(?))))
         ORDER BY n.id`,
        [lang, wanted, wanted],
      )
    : await driver.exec(
        "SELECT id, data, origin FROM native_notes WHERE lang = ? AND key IS NOT NULL ORDER BY id",
        [lang],
      );
  const cards = new Map<number, NativeCard[]>();
  const cardRows = few
    ? noteRows.length
      ? await driver.exec(
          "SELECT * FROM native_cards WHERE note_id IN (SELECT value FROM json_each(?)) ORDER BY ord, id",
          [JSON.stringify(noteRows.map((r) => r["id"]))],
        )
      : []
    : await driver.exec("SELECT * FROM native_cards WHERE lang = ? ORDER BY ord, id", [lang]);
  for (const r of cardRows) {
    const c = toCard(r);
    const list = cards.get(c.noteId);
    if (list) list.push(c);
    else cards.set(c.noteId, [c]);
  }
  const entries = new Map<string, AnkiWordEntry>();
  const knowledge = new Map<string, WordKnowledge>();
  const pending = new Map<string, { noteId: number; deck: string }>();
  for (const r of noteRows) {
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
      // A word the learner added counts as being learned from the start; a starter word they have
      // not met yet does not (otherwise 5000 untouched cards make every text "20% known").
      const starter = note.tags?.includes("vuurtoren::starter") ?? false;
      if (r["origin"] === "vuurtoren" && fresh && !starter && !pending.has(key)) {
        pending.set(key, { noteId: note.id, deck: own[0]!.deck });
      }
    }
  }
  return { entries, pending };
}
