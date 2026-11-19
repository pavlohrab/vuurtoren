/**
 * Reading Anki package files (.apkg, .colpkg): a zip holding the collection (SQLite), the
 * media files and a media list. Three layouts exist:
 *
 * - `collection.anki2` / `collection.anki21`: the older collection schema, where note types,
 *   decks and deck options are JSON in the `col` row, and `media` is JSON (`{"0": "a.jpg"}`).
 * - `collection.anki21b`: the current one, compressed with zstd. Note types, fields,
 *   templates, decks and deck options have their own tables with protobuf blobs; `media` is a
 *   zstd-compressed protobuf list, and each media file is compressed with zstd too.
 *
 * Only the file format is read here; the SQLite engine is the caller's (`OpenSqlite`).
 */
import { unzipSync } from "fflate";
import { decompress } from "fzstd";
import { DEFAULT_DECK_OPTIONS, type DeckOptions, type NotetypeKind } from "@app/core";
import {
  decodeProto,
  protoFloat,
  protoFloats,
  protoInt,
  protoMessage,
  protoMessages,
  protoString,
} from "./protobuf.js";

/** A read-only SQLite database opened from bytes. */
export interface SqliteReader {
  all(sql: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}
export type OpenSqlite = (bytes: Uint8Array) => Promise<SqliteReader>;

export interface AnkiNotetypeData {
  id: number;
  name: string;
  kind: NotetypeKind;
  fields: string[];
  templates: { name: string; front: string; back: string }[];
  css: string;
}

export interface AnkiDeckData {
  id: number;
  name: string;
  options: DeckOptions;
  /** FSRS-6 parameters of the deck's preset, when Anki has trained them. */
  fsrsParams?: number[];
}

interface AnkiNoteData {
  id: number;
  notetypeId: number;
  fields: string[];
  tags: string[];
}

export interface AnkiCardData {
  id: number;
  noteId: number;
  deckId: number;
  ord: number;
  /** 0 new, 1 learning, 2 review, 3 relearning. */
  type: number;
  /** −1 suspended, −2/−3 buried, 0 new, 1 learning, 2 review, 3 day learning. */
  queue: number;
  /** When a reviewed card is due (ms), if known. */
  dueMs?: number;
  /** Place in the new queue (new cards). */
  newPosition?: number;
  /** Review interval in days (0 in learning). */
  intervalDays: number;
}

/** One review-log entry, as Anki stores it. */
export interface AnkiReviewData {
  cardId: number;
  /** ms since epoch (the log entry's id). */
  at: number;
  /** 1–4, or 0 for a manual change. */
  ease: number;
  /** 0 learn, 1 review, 2 relearn, 3 filtered, 4 manual, 5 rescheduled. */
  type: number;
  timeMs: number;
}

export interface AnkiCollection {
  notetypes: AnkiNotetypeData[];
  decks: AnkiDeckData[];
  notes: AnkiNoteData[];
  cards: AnkiCardData[];
  reviews: AnkiReviewData[];
  /** Media files by name; bytes are decompressed when read. */
  media: { name: string; bytes: () => Uint8Array | Promise<Uint8Array> }[];
}

/** The file is not an Anki package, or a layout Kenning cannot read. */
export class AnkiPackageError extends Error {
  override readonly name = "AnkiPackageError";
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => ZSTD_MAGIC.every((m, i) => b[i] === m);
const unzstd = (b: Uint8Array) => (isZstd(b) ? decompress(b) : b);
const DAY_MS = 86_400_000;

const num = (v: unknown): number => (typeof v === "bigint" ? Number(v) : Number(v ?? 0));
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const bytes = (v: unknown): Uint8Array =>
  ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(0);

/** Learning steps in minutes from Anki's (minutes, possibly fractional). */
const steps = (xs: unknown): number[] =>
  Array.isArray(xs) ? xs.map(Number).filter((x) => x > 0) : [];

const UNICASE = new TextEncoder().encode(" COLLATE unicase");
const BINARY = new TextEncoder().encode(" COLLATE binary ");

/**
 * Make Anki's collection file openable by a plain SQLite in memory:
 * - Anki writes it in WAL journal mode (header bytes 18–19 are 2), which a database opened from
 *   bytes cannot use: the copy is marked as a rollback-journal file (1). The file is complete.
 * - The current schema declares text columns `COLLATE unicase`, a collation only Anki registers;
 *   without it SQLite refuses those tables. The declaration is swapped for `COLLATE binary `
 *   (the same length, so no record moves). Kenning never sorts or filters by those columns.
 */
export function openableCollection(bytes: Uint8Array): Uint8Array {
  const wal = bytes.length >= 20 && (bytes[18] === 2 || bytes[19] === 2);
  const at: number[] = [];
  outer: for (let i = bytes.indexOf(UNICASE[0]!); i >= 0; i = bytes.indexOf(UNICASE[0]!, i + 1)) {
    for (let j = 1; j < UNICASE.length; j++) if (bytes[i + j] !== UNICASE[j]) continue outer;
    at.push(i);
  }
  if (!wal && at.length === 0) return bytes;
  const copy = bytes.slice();
  if (wal) {
    copy[18] = 1;
    copy[19] = 1;
  }
  for (const i of at) copy.set(BINARY, i);
  return copy;
}

/** Read a package's collection and media list. */
export async function readAnkiPackage(file: Uint8Array, open: OpenSqlite): Promise<AnkiCollection> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(file);
  } catch {
    throw new AnkiPackageError("This is not an Anki package (.apkg or .colpkg).");
  }
  const latest = entries["collection.anki21b"];
  const legacy = entries["collection.anki21"] ?? entries["collection.anki2"];
  const raw = latest ? unzstd(latest) : legacy;
  if (!raw) throw new AnkiPackageError("The package holds no Anki collection.");
  const db = await open(openableCollection(raw));
  try {
    const crtRow = (await db.all("SELECT crt FROM col"))[0];
    const crt = num(crtRow?.["crt"]);
    const isLatest =
      (await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'"))
        .length > 0;
    const { notetypes, decks } = isLatest ? await latestSchema(db) : await legacySchema(db);
    const notes = (await db.all("SELECT id, mid, flds, tags FROM notes ORDER BY id")).map(
      (r): AnkiNoteData => ({
        id: num(r["id"]),
        notetypeId: num(r["mid"]),
        fields: str(r["flds"]).split("\x1f"),
        tags: str(r["tags"]).trim().split(/\s+/).filter(Boolean),
      }),
    );
    const cards = (
      await db.all(
        "SELECT id, nid, did, ord, type, queue, due, ivl, odue, odid FROM cards ORDER BY id",
      )
    ).map((r) => cardData(r, crt));
    const reviews = (await db.all("SELECT id, cid, ease, type, time FROM revlog ORDER BY id")).map(
      (r): AnkiReviewData => ({
        cardId: num(r["cid"]),
        at: num(r["id"]),
        ease: num(r["ease"]),
        type: num(r["type"]),
        timeMs: num(r["time"]),
      }),
    );
    return { notetypes, decks, notes, cards, reviews, media: mediaList(entries) };
  } finally {
    await db.close();
  }
}

function cardData(r: Record<string, unknown>, crtSeconds: number): AnkiCardData {
  const odid = num(r["odid"]);
  const type = num(r["type"]);
  const queue = num(r["queue"]);
  // A card in a filtered deck keeps its home deck and due date in odid / odue.
  const due = odid ? num(r["odue"]) : num(r["due"]);
  const card: AnkiCardData = {
    id: num(r["id"]),
    noteId: num(r["nid"]),
    deckId: odid || num(r["did"]),
    ord: num(r["ord"]),
    type,
    queue,
    intervalDays: Math.max(0, num(r["ivl"])),
  };
  if (type === 0) card.newPosition = due;
  else if (type === 2 || queue === 3) card.dueMs = (crtSeconds + due * 86_400) * 1000;
  else if (due > 1e9) card.dueMs = due * 1000;
  else card.dueMs = (crtSeconds + due * 86_400) * 1000;
  if (card.dueMs !== undefined && card.dueMs < DAY_MS) delete card.dueMs;
  return card;
}

interface Schema {
  notetypes: AnkiNotetypeData[];
  decks: AnkiDeckData[];
}

/** Older schema: JSON in the `col` row. */
async function legacySchema(db: SqliteReader): Promise<Schema> {
  const row = (await db.all("SELECT models, decks, dconf FROM col"))[0] ?? {};
  const models = JSON.parse(str(row["models"]) || "{}") as Record<string, Record<string, unknown>>;
  const decks = JSON.parse(str(row["decks"]) || "{}") as Record<string, Record<string, unknown>>;
  const dconf = JSON.parse(str(row["dconf"]) || "{}") as Record<string, Record<string, unknown>>;
  const notetypes = Object.values(models).map((m): AnkiNotetypeData => {
    const flds = (m["flds"] as { name: string; ord: number }[] | undefined) ?? [];
    const tmpls =
      (m["tmpls"] as { name: string; ord: number; qfmt: string; afmt: string }[] | undefined) ?? [];
    return {
      id: num(m["id"]),
      name: str(m["name"]),
      kind: num(m["type"]) === 1 ? "cloze" : "standard",
      fields: [...flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: [...tmpls]
        .sort((a, b) => a.ord - b.ord)
        .map((t) => ({ name: t.name, front: t.qfmt, back: t.afmt })),
      css: str(m["css"]),
    };
  });
  const deckList = Object.values(decks)
    .filter((d) => !num(d["dyn"]))
    .map((d): AnkiDeckData => {
      const conf = dconf[String(num(d["conf"]) || 1)] ?? {};
      const fresh = (conf["new"] ?? {}) as Record<string, unknown>;
      const lapse = (conf["lapse"] ?? {}) as Record<string, unknown>;
      const rev = (conf["rev"] ?? {}) as Record<string, unknown>;
      const options: DeckOptions = {
        ...DEFAULT_DECK_OPTIONS,
        ...(Array.isArray(fresh["delays"]) ? { learningSteps: steps(fresh["delays"]) } : {}),
        ...(Array.isArray(lapse["delays"]) ? { relearningSteps: steps(lapse["delays"]) } : {}),
        ...(num(rev["maxIvl"]) > 0 ? { maxInterval: num(rev["maxIvl"]) } : {}),
        ...(num(fresh["perDay"]) >= 0 && fresh["perDay"] !== undefined
          ? { newPerDay: num(fresh["perDay"]) }
          : {}),
        ...(num(conf["desiredRetention"]) > 0
          ? { desiredRetention: num(conf["desiredRetention"]) }
          : {}),
      };
      const params = Array.isArray(conf["fsrsParams6"]) ? conf["fsrsParams6"].map(Number) : [];
      return {
        id: num(d["id"]),
        name: str(d["name"]),
        options,
        ...(params.length === 21 ? { fsrsParams: params } : {}),
      };
    });
  return { notetypes, decks: deckList };
}

/** Current schema: tables with protobuf blobs. */
async function latestSchema(db: SqliteReader): Promise<Schema> {
  const fields = await db.all("SELECT ntid, ord, name FROM fields ORDER BY ntid, ord");
  const templates = await db.all(
    "SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord",
  );
  const notetypes = (await db.all("SELECT id, name, config FROM notetypes")).map(
    (r): AnkiNotetypeData => {
      const id = num(r["id"]);
      const config = decodeProto(bytes(r["config"]));
      return {
        id,
        name: str(r["name"]),
        kind: protoInt(config, 1) === 1 ? "cloze" : "standard",
        fields: fields.filter((f) => num(f["ntid"]) === id).map((f) => str(f["name"])),
        templates: templates
          .filter((t) => num(t["ntid"]) === id)
          .map((t) => {
            const c = decodeProto(bytes(t["config"]));
            return { name: str(t["name"]), front: protoString(c, 1), back: protoString(c, 2) };
          }),
        css: protoString(config, 3),
      };
    },
  );
  const configs = new Map<number, { options: DeckOptions; params: number[] }>();
  for (const r of await db.all("SELECT id, config FROM deck_config")) {
    const c = decodeProto(bytes(r["config"]));
    const retention = protoFloat(c, 37);
    const maxIvl = protoInt(c, 16);
    configs.set(num(r["id"]), {
      options: {
        ...DEFAULT_DECK_OPTIONS,
        learningSteps: protoFloats(c, 1),
        relearningSteps: protoFloats(c, 2),
        newPerDay: protoInt(c, 9),
        ...(maxIvl > 0 ? { maxInterval: maxIvl } : {}),
        ...(retention && retention > 0
          ? { desiredRetention: Math.round(retention * 100) / 100 }
          : {}),
      },
      params: protoFloats(c, 6),
    });
  }
  const decks: AnkiDeckData[] = [];
  for (const r of await db.all("SELECT id, name, kind FROM decks")) {
    const kind = decodeProto(bytes(r["kind"]));
    const normal = protoMessage(kind, 1);
    if (!normal) continue; // a filtered deck: its cards belong to their home decks
    const conf = configs.get(protoInt(normal, 1)) ?? configs.get(1);
    decks.push({
      id: num(r["id"]),
      // Deck levels are separated by \x1f in this schema.
      name: str(r["name"]).split("\x1f").join("::"),
      options: conf?.options ?? DEFAULT_DECK_OPTIONS,
      ...(conf && conf.params.length === 21 ? { fsrsParams: conf.params } : {}),
    });
  }
  return { notetypes, decks };
}

/** Media file names → zip entries ("0", "1", …), in either media-list format. */
function mediaList(entries: Record<string, Uint8Array>): AnkiCollection["media"] {
  const raw = entries["media"];
  if (!raw || raw.length === 0) return [];
  const names = new Map<string, string>();
  const text = new TextDecoder().decode(raw.subarray(0, 1));
  if (text === "{") {
    const map = JSON.parse(new TextDecoder().decode(raw)) as Record<string, string>;
    for (const [entry, name] of Object.entries(map)) names.set(name, entry);
  } else {
    const list = decodeProto(unzstd(raw));
    protoMessages(list, 1).forEach((m, i) => names.set(protoString(m, 1), String(i)));
  }
  return [...names].flatMap(([name, entry]) => {
    const data = entries[entry];
    return data ? [{ name, bytes: () => unzstd(data) }] : [];
  });
}
