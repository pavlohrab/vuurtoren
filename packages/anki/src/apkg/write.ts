/**
 * Writing an Anki package (.apkg) from Kenning's own cards: note types, decks with their options,
 * notes, cards with their schedule and FSRS memory, the review history and the media the notes
 * use. The older layout is written (`collection.anki21`, schema 11, note types, decks and deck
 * options as JSON in the `col` row; `media` as JSON), which every Anki version since 2.1 imports.
 *
 * Only the file format is written here; the SQLite engine is the caller's (`CreateSqlite`).
 */
import { zipSync } from "fflate";
import {
  type CardReview,
  type CardSchedule,
  DEFAULT_DECK_OPTIONS,
  DEFAULT_FSRS_PARAMS,
  type DeckOptions,
  type NativeCard,
  type NativeNote,
  type NativeNotetype,
  answerCard,
} from "@app/core";
import { mediaRefs } from "./convert.js";

/** A new, empty SQLite database that can be written and then serialised. */
export interface SqliteWriter {
  exec(sql: string, params?: readonly (string | number | null)[]): Promise<void>;
  /** The database file. */
  bytes(): Promise<Uint8Array>;
  close(): Promise<void>;
}
export type CreateSqlite = () => Promise<SqliteWriter>;

export interface PackageInput {
  notetypes: NativeNotetype[];
  decks: { name: string; options: DeckOptions }[];
  notes: NativeNote[];
  cards: NativeCard[];
  /** Review history of these cards (any order). */
  reviews: CardReview[];
  /** FSRS parameters in use (written to every deck's preset). */
  params?: readonly number[];
  /** Media files the notes may use, read when written. */
  media: { name: string; bytes: () => Promise<Uint8Array | null> }[];
  /** The time of the export (ms). */
  now: number;
}

export interface PackageSummary {
  notes: number;
  cards: number;
  reviews: number;
  media: number;
}

const DAY_MS = 86_400_000;
/** Anki's id of Kenning's own note type ("kenning-word"), the same in every export. */
export const KENNING_NOTETYPE_ANKI_ID = 1_761_000_000_000;
const FIRST_DECK_ID = 1_761_000_000_001;

const SCHEMA_11 = [
  `CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null,
    scm integer not null, ver integer not null, dty integer not null, usn integer not null,
    ls integer not null, conf text not null, models text not null, decks text not null,
    dconf text not null, tags text not null)`,
  `CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null,
    mod integer not null, usn integer not null, tags text not null, flds text not null,
    sfld integer not null, csum integer not null, flags integer not null, data text not null)`,
  `CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null,
    ord integer not null, mod integer not null, usn integer not null, type integer not null,
    queue integer not null, due integer not null, ivl integer not null, factor integer not null,
    reps integer not null, lapses integer not null, left integer not null, odue integer not null,
    odid integer not null, flags integer not null, data text not null)`,
  `CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null,
    ease integer not null, ivl integer not null, lastIvl integer not null,
    factor integer not null, time integer not null, type integer not null)`,
  `CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null)`,
  `CREATE INDEX ix_notes_usn ON notes (usn)`,
  `CREATE INDEX ix_cards_usn ON cards (usn)`,
  `CREATE INDEX ix_revlog_usn ON revlog (usn)`,
  `CREATE INDEX ix_cards_nid ON cards (nid)`,
  `CREATE INDEX ix_cards_sched ON cards (did, queue, due)`,
  `CREATE INDEX ix_revlog_cid ON revlog (cid)`,
  `CREATE INDEX ix_notes_csum ON notes (csum)`,
];

/** Anki's numeric id of a note type: its own for imported ones, a fixed one for Kenning's. */
export function ankiNotetypeId(t: NativeNotetype, i: number): number {
  const m = /^anki:(\d+)$/.exec(t.id);
  if (m) return Number(m[1]);
  return t.id === "kenning-word" ? KENNING_NOTETYPE_ANKI_ID : KENNING_NOTETYPE_ANKI_ID + 1000 + i;
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

/** Anki's note checksum: the first 8 hex digits of the SHA-1 of the stripped sort field. */
async function checksum(field: string): Promise<number> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(stripHtml(field)));
  const b = new Uint8Array(digest);
  return ((b[0]! << 24) >>> 0) + (b[1]! << 16) + (b[2]! << 8) + b[3]!;
}

/** A note's guid: stable for the note id, so importing the file twice updates, not doubles. */
const guidOf = (noteId: number) => `kenning${noteId.toString(36)}`;

/** Start of the study day (4:00 local time) that `ms` falls in. */
function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() > ms) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** Each deck and every parent of it ("A::B" also needs "A"), by name. */
function withParents(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const parts = n.split("::");
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("::"));
  }
  return [...out].sort();
}

function deckConf(id: number, name: string, o: DeckOptions, params: readonly number[]) {
  return {
    id,
    name,
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    dyn: false,
    new: {
      delays: o.learningSteps,
      ints: [1, 4, 0],
      initialFactor: 2500,
      order: 1,
      perDay: o.newPerDay,
      bury: false,
    },
    lapse: {
      delays: o.relearningSteps,
      mult: 0,
      minInt: 1,
      leechFails: 8,
      leechAction: 1,
    },
    rev: {
      perDay: 9999,
      ease4: 1.3,
      maxIvl: o.maxInterval,
      hardFactor: 1.2,
      bury: false,
    },
    desiredRetention: o.desiredRetention,
    ...(params.length === 21 ? { fsrsParams6: [...params] } : {}),
  };
}

function deckJson(id: number, name: string, conf: number, now: number) {
  return {
    id,
    name,
    conf,
    desc: "",
    dyn: 0,
    collapsed: false,
    browserCollapsed: false,
    extendNew: 0,
    extendRev: 0,
    usn: 0,
    mod: Math.floor(now / 1000),
    newToday: [0, 0],
    revToday: [0, 0],
    lrnToday: [0, 0],
    timeToday: [0, 0],
  };
}

function modelJson(id: number, t: NativeNotetype, now: number) {
  return {
    id,
    name: t.name,
    type: t.kind === "cloze" ? 1 : 0,
    mod: Math.floor(now / 1000),
    usn: 0,
    sortf: 0,
    did: 1,
    tmpls: t.templates.map((tm, ord) => ({
      name: tm.name,
      ord,
      qfmt: tm.front,
      afmt: tm.back,
      bqfmt: "",
      bafmt: "",
      did: null,
      bfont: "",
      bsize: 0,
    })),
    flds: t.fields.map((name, ord) => ({
      name,
      ord,
      sticky: false,
      rtl: false,
      font: "Arial",
      size: 20,
      media: [],
    })),
    css: t.css,
    latexPre:
      "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    latexsvg: false,
    req: t.templates.map((_, ord) => [ord, "any", [0]]),
    tags: [],
    vers: [],
  };
}

/** Anki's revlog interval: days for review answers, negative seconds for (re)learning steps. */
function revlogInterval(s: CardSchedule, at: number): number {
  return s.state === 2
    ? Math.max(1, Math.round(s.scheduledDays))
    : -Math.max(1, Math.round((s.due - at) / 1000));
}

const REVLOG_TYPE = { learn: 0, review: 1, relearn: 2, filtered: 3, manual: 4 } as const;

/**
 * The revlog rows of one card: its answers replayed (without fuzz) for the interval each gave,
 * as Anki shows them in its card info.
 */
export function revlogRows(
  reviews: CardReview[],
  options: DeckOptions,
  params: readonly number[],
): { at: number; ease: number; ivl: number; lastIvl: number; type: number; time: number }[] {
  let s: CardSchedule | undefined;
  let last = 0;
  const rows = [];
  for (const r of [...reviews].sort((a, b) => a.at - b.at)) {
    if (r.rating === 0) {
      rows.push({ at: r.at, ease: 0, ivl: 0, lastIvl: last, type: REVLOG_TYPE.manual, time: 0 });
      continue;
    }
    s = answerCard(s, r.rating, r.at, { options, params, fuzz: false });
    const ivl = revlogInterval(s, r.at);
    rows.push({
      at: r.at,
      ease: r.rating,
      ivl,
      lastIvl: last,
      type: REVLOG_TYPE[r.kind],
      time: Math.max(0, Math.min(60_000, Math.round(r.durationMs))),
    });
    last = ivl;
  }
  return rows;
}

/** One card's row: type, queue, due, interval and FSRS memory as Anki keeps them. */
function cardRow(
  c: NativeCard,
  options: DeckOptions,
  crt: number,
  newRank: number,
): {
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  data: string;
} {
  const s = c.schedule;
  if (!s) {
    return {
      type: 0,
      queue: c.suspended ? -1 : 0,
      due: newRank,
      ivl: 0,
      factor: 0,
      reps: 0,
      lapses: 0,
      left: 0,
      data: "",
    };
  }
  const data = JSON.stringify({
    s: Math.round(s.stability * 10_000) / 10_000,
    d: Math.round(s.difficulty * 1000) / 1000,
    dr: options.desiredRetention,
    lrt: Math.floor(s.lastReview / 1000),
  });
  if (s.state === 2) {
    return {
      type: 2,
      queue: c.suspended ? -1 : 2,
      due: Math.max(0, Math.round((dayStart(s.due) - crt) / DAY_MS)),
      ivl: Math.max(1, Math.round(s.scheduledDays)),
      factor: 2500,
      reps: s.reps,
      lapses: s.lapses,
      left: 0,
      data,
    };
  }
  const steps = s.state === 1 ? options.learningSteps : options.relearningSteps;
  return {
    type: s.state === 1 ? 1 : 3,
    queue: c.suspended ? -1 : 1,
    due: Math.floor(s.due / 1000),
    ivl: s.state === 3 ? Math.max(1, Math.round(s.stability)) : 0,
    factor: 2500,
    reps: s.reps,
    lapses: s.lapses,
    left: Math.max(1, steps.length - s.learningSteps),
    data,
  };
}

/** Write the package. Media files a note uses but that cannot be read are left out. */
export async function writeAnkiPackage(
  input: PackageInput,
  create: CreateSqlite,
): Promise<{ bytes: Uint8Array; summary: PackageSummary }> {
  const { now } = input;
  const params = input.params?.length === 21 ? input.params : DEFAULT_FSRS_PARAMS;
  const options = new Map(input.decks.map((d) => [d.name, d.options]));
  const optionsOf = (deck: string) => options.get(deck) ?? DEFAULT_DECK_OPTIONS;

  // The collection's creation day: early enough that no due day is negative.
  const firstMs = Math.min(
    now,
    ...input.cards.flatMap((c) => (c.schedule ? [c.schedule.due] : [])),
    ...input.reviews.map((r) => r.at),
  );
  const crt = dayStart(firstMs);

  const deckNames = withParents([
    ...input.decks.map((d) => d.name),
    ...input.cards.map((c) => c.deck),
  ]);
  const deckIds = new Map<string, number>([["Default", 1]]);
  deckNames.forEach((n) => {
    if (!deckIds.has(n)) deckIds.set(n, FIRST_DECK_ID + deckIds.size);
  });
  const decks: Record<string, unknown> = {};
  const dconf: Record<string, unknown> = {
    1: deckConf(1, "Default", DEFAULT_DECK_OPTIONS, params),
  };
  for (const [name, id] of deckIds) {
    const conf = name === "Default" ? 1 : id;
    if (conf !== 1) dconf[conf] = deckConf(conf, name, optionsOf(name), params);
    decks[id] = deckJson(id, name, conf, now);
  }

  const typeIds = new Map(input.notetypes.map((t, i) => [t.id, ankiNotetypeId(t, i)]));
  const models: Record<string, unknown> = {};
  for (const t of input.notetypes)
    models[typeIds.get(t.id)!] = modelJson(typeIds.get(t.id)!, t, now);

  const db = await create();
  try {
    for (const stmt of SCHEMA_11) await db.exec(stmt);
    const conf = {
      activeDecks: [1],
      curDeck: 1,
      newSpread: 0,
      collapseTime: 1200,
      timeLim: 0,
      estTimes: true,
      dueCounts: true,
      curModel: null,
      nextPos: input.cards.length + 1,
      sortType: "noteFld",
      sortBackwards: false,
      addToCur: true,
      schedVer: 2,
      sched2021: true,
    };
    await db.exec("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,'{}')", [
      Math.floor(crt / 1000),
      now,
      now,
      JSON.stringify(conf),
      JSON.stringify(models),
      JSON.stringify(decks),
      JSON.stringify(dconf),
    ]);

    const noteIds = new Set<number>();
    const used = new Set<string>();
    for (const n of input.notes) {
      const mid = typeIds.get(n.notetypeId);
      if (mid === undefined) continue;
      noteIds.add(n.id);
      for (const f of n.fields) for (const m of mediaRefs(f)) used.add(m);
      const sfld = stripHtml(n.fields[0] ?? "");
      await db.exec("INSERT INTO notes VALUES (?,?,?,?,0,?,?,?,?,0,'')", [
        n.id,
        guidOf(n.id),
        mid,
        Math.floor(now / 1000),
        n.tags.length ? ` ${n.tags.join(" ")} ` : "",
        n.fields.join("\x1f"),
        sfld,
        await checksum(n.fields[0] ?? ""),
      ]);
    }
    for (const t of input.notetypes) {
      for (const tm of t.templates) for (const m of mediaRefs(tm.front + tm.back)) used.add(m);
    }

    const cards = input.cards.filter((c) => noteIds.has(c.noteId));
    const newRank = new Map(
      cards
        .filter((c) => !c.schedule)
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .map((c, i) => [c.id, i + 1]),
    );
    for (const c of cards) {
      const row = cardRow(c, optionsOf(c.deck), crt, newRank.get(c.id) ?? 0);
      await db.exec("INSERT INTO cards VALUES (?,?,?,?,?,0,?,?,?,?,?,?,?,?,0,0,0,?)", [
        c.id,
        c.noteId,
        deckIds.get(c.deck) ?? 1,
        c.ord,
        Math.floor(now / 1000),
        row.type,
        row.queue,
        row.due,
        row.ivl,
        row.factor,
        row.reps,
        row.lapses,
        row.left,
        row.data,
      ]);
    }

    const cardDeck = new Map(cards.map((c) => [c.id, c.deck]));
    const byCard = new Map<number, CardReview[]>();
    for (const r of input.reviews) {
      if (!cardDeck.has(r.cardId)) continue;
      const list = byCard.get(r.cardId);
      if (list) list.push(r);
      else byCard.set(r.cardId, [r]);
    }
    const taken = new Set<number>();
    let reviews = 0;
    for (const [cardId, list] of byCard) {
      for (const row of revlogRows(list, optionsOf(cardDeck.get(cardId)!), params)) {
        // A revlog id is the answer time in ms and must be unique.
        let id = Math.round(row.at);
        while (taken.has(id)) id++;
        taken.add(id);
        await db.exec("INSERT INTO revlog VALUES (?,?,0,?,?,?,?,?,?)", [
          id,
          cardId,
          row.ease,
          row.ivl,
          row.lastIvl,
          row.type === REVLOG_TYPE.learn ? 0 : 2500,
          row.time,
          row.type,
        ]);
        reviews++;
      }
    }

    const files: Record<string, Uint8Array> = {};
    const mediaMap: Record<string, string> = {};
    let m = 0;
    for (const f of input.media) {
      if (!used.has(f.name)) continue;
      const bytes = await f.bytes();
      if (!bytes) continue;
      files[String(m)] = bytes;
      mediaMap[String(m)] = f.name;
      m++;
    }
    files["collection.anki21"] = await db.bytes();
    files["media"] = new TextEncoder().encode(JSON.stringify(mediaMap));
    return {
      bytes: zipSync(files, { level: 6 }),
      summary: { notes: noteIds.size, cards: cards.length, reviews, media: m },
    };
  } finally {
    await db.close();
  }
}
