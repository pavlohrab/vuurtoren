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
import { Decompress } from "fzstd";
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

/**
 * The largest file a package may unpack to: the collection, or one media file. Real
 * collections and media are far smaller; this stops a small hostile file from filling memory.
 */
const MAX_UNPACKED = 512 * 1024 * 1024;
/** And all of the package's files together. */
const MAX_UNPACKED_TOTAL = 1024 * 1024 * 1024;

const tooLarge = () =>
  new AnkiPackageError("This package unpacks to more than Kenning can open at once.");

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => ZSTD_MAGIC.every((m, i) => b[i] === m);

/** The memory a zstd frame asks for up front: its window, or its whole size in one segment. */
function zstdWindow(b: Uint8Array): number {
  const flags = b[4] ?? 0;
  const single = (flags >> 5) & 1;
  if (!single) {
    const desc = b[5] ?? 0;
    const base = 2 ** (10 + (desc >> 3));
    return base + (base / 8) * (desc & 7);
  }
  const dictBytes = [0, 1, 2, 4][flags & 3]!;
  const sizeBytes = [1, 2, 4, 8][flags >> 6]!;
  let size = 0;
  for (let i = sizeBytes - 1; i >= 0; i--) size = size * 256 + (b[5 + dictBytes + i] ?? 0);
  return sizeBytes === 2 ? size + 256 : size;
}

/** Undo zstd (when the bytes are zstd), giving up as soon as the output passes `max`. */
function unzstd(b: Uint8Array, max = MAX_UNPACKED): Uint8Array {
  if (!isZstd(b)) return b;
  if (zstdWindow(b) > max) throw tooLarge();
  const parts: Uint8Array[] = [];
  let total = 0;
  new Decompress((chunk) => {
    total += chunk.length;
    if (total > max) throw tooLarge();
    parts.push(chunk);
  }).push(b, true);
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Unzip, refusing entries that say they unpack to more than the limits allow. */
function unzipLimited(file: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  try {
    // fflate unpacks each entry into a buffer of its declared size and never past it.
    return unzipSync(file, {
      filter: (f) => {
        total += f.originalSize;
        if (f.originalSize > MAX_UNPACKED || total > MAX_UNPACKED_TOTAL) throw tooLarge();
        return true;
      },
    });
  } catch (e) {
    if (e instanceof AnkiPackageError) throw e;
    throw new AnkiPackageError("This is not an Anki package (.apkg or .colpkg).");
  }
}

const DAY_MS = 86_400_000;

const num = (v: unknown): number => (typeof v === "bigint" ? Number(v) : Number(v ?? 0));
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const bytes = (v: unknown): Uint8Array =>
  ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(0);

/** Learning steps in minutes from Anki's (minutes, possibly fractional). */
const steps = (xs: unknown): number[] =>
  Array.isArray(xs) ? xs.map(Number).filter((x) => x > 0) : [];

const UNICASE = "collate unicase";
const BINARY = new TextEncoder().encode("COLLATE binary ");

const u16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32 = (b: Uint8Array, i: number) => u16(b, i) * 65536 + u16(b, i + 2);

/** A SQLite varint at `i`: its value (exact up to 2^53, enough here) and its length. */
function varint(b: Uint8Array, i: number): [value: number, length: number] {
  let v = 0;
  for (let n = 0; n < 8; n++) {
    const byte = b[i + n] ?? 0;
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return [v, n + 1];
  }
  return [v * 256 + (b[i + 8] ?? 0), 9];
}

/** Bytes per serial type of a record column (SQLite file format, "Record Format"). */
function serialSize(t: number): number {
  if (t >= 12) return Math.floor((t - 12) / 2);
  return [0, 1, 2, 3, 4, 6, 8, 8, 0, 0, 0, 0][t]!;
}

/**
 * The file offsets of the `sql` text of every row of the schema table (`sqlite_schema`, the
 * table b-tree rooted at page 1), one offset per byte, following overflow pages. Null when
 * the file does not look like a UTF-8 SQLite database this reader understands.
 */
function schemaSqlOffsets(b: Uint8Array): number[][] | null {
  if (b.length < 512 || new TextDecoder().decode(b.subarray(0, 15)) !== "SQLite format 3") {
    return null;
  }
  const raw = u16(b, 16);
  const pageSize = raw === 1 ? 65536 : raw;
  const usable = pageSize - (b[20] ?? 0);
  if (pageSize < 512 || usable < 480 || u32(b, 56) !== 1) return null;
  const pageCount = Math.floor(b.length / pageSize);
  const seen = new Set<number>();
  const out: number[][] = [];
  const pageAt = (n: number) =>
    n >= 1 && n <= pageCount && !seen.has(n) ? (n - 1) * pageSize : -1;

  /** One cell's payload as file offsets (local part, then overflow pages). */
  const payload = (start: number, size: number): number[] | null => {
    const maxLocal = usable - 35;
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    let local = size;
    if (size > maxLocal) {
      const k = minLocal + ((size - minLocal) % (usable - 4));
      local = k <= maxLocal ? k : minLocal;
    }
    const at: number[] = [];
    for (let i = 0; i < local; i++) at.push(start + i);
    let next = size > local ? u32(b, start + local) : 0;
    while (at.length < size) {
      const page = pageAt(next);
      if (page < 0) return null;
      seen.add(next);
      const take = Math.min(usable - 4, size - at.length);
      for (let i = 0; i < take; i++) at.push(page + 4 + i);
      next = u32(b, page);
    }
    return at;
  };

  const walk = (n: number): boolean => {
    const page = pageAt(n);
    if (page < 0) return false;
    seen.add(n);
    const head = page + (n === 1 ? 100 : 0);
    const kind = b[head];
    const cells = u16(b, head + 3);
    if (kind === 0x05) {
      for (let c = 0; c < cells; c++) {
        if (!walk(u32(b, page + u16(b, head + 12 + c * 2)))) return false;
      }
      return walk(u32(b, head + 8));
    }
    if (kind !== 0x0d) return false;
    for (let c = 0; c < cells; c++) {
      let at = page + u16(b, head + 8 + c * 2);
      const [size, l1] = varint(b, at);
      at += l1;
      at += varint(b, at)[1]; // the rowid
      if (size > 16 * 1024 * 1024) return false;
      const bytes = payload(at, size);
      if (!bytes) return false;
      const read = (i: number) => b[bytes[i] ?? -1] ?? 0;
      const record = Uint8Array.from({ length: Math.min(size, 64) }, (_, i) => read(i));
      // Record header: its length, then one serial type per column (type, name, tbl_name,
      // rootpage, sql).
      const [headerSize, hl] = varint(record, 0);
      let h = hl;
      let data = headerSize;
      for (let col = 0; col < 5 && h < headerSize; col++) {
        const [t, tl] = varint(record, h);
        h += tl;
        const len = serialSize(t);
        if (col === 4 && t >= 13 && t % 2 === 1) out.push(bytes.slice(data, data + len));
        data += len;
      }
    }
    return true;
  };
  return walk(1) ? out : null;
}

/**
 * Make Anki's collection file openable by a plain SQLite in memory:
 * - Anki writes it in WAL journal mode (header bytes 18–19 are 2), which a database opened from
 *   bytes cannot use: the copy is marked as a rollback-journal file (1). The file is complete.
 * - The current schema declares text columns `COLLATE unicase`, a collation only Anki registers;
 *   without it SQLite refuses those tables. Neither SQLite Kenning uses (node:sqlite,
 *   sqlite-wasm through its worker) can add a collation, so the declaration is swapped for
 *   `COLLATE binary ` (the same length, so nothing moves) in the schema's SQL text only, found
 *   by walking the schema table's pages: note text that happens to say "COLLATE unicase" is
 *   left alone. Kenning never sorts or filters by those columns.
 */
function openableCollection(bytes: Uint8Array): Uint8Array {
  const wal = bytes.length >= 20 && (bytes[18] === 2 || bytes[19] === 2);
  const patches: number[][] = [];
  for (const sql of schemaSqlOffsets(bytes) ?? []) {
    let text = "";
    for (const i of sql) text += String.fromCharCode(bytes[i]!);
    text = text.toLowerCase();
    for (let i = text.indexOf(UNICASE); i >= 0; i = text.indexOf(UNICASE, i + 1)) {
      const after = text.charCodeAt(i + UNICASE.length);
      // A whole word: not the start of a longer name.
      if (!/[a-z0-9_$]/.test(String.fromCharCode(after || 32))) {
        patches.push(sql.slice(i, i + UNICASE.length));
      }
    }
  }
  if (!wal && patches.length === 0) return bytes;
  const copy = bytes.slice();
  if (wal) {
    copy[18] = 1;
    copy[19] = 1;
  }
  for (const at of patches) at.forEach((offset, j) => (copy[offset] = BINARY[j]!));
  return copy;
}

/** Read a package's collection and media list. */
export async function readAnkiPackage(file: Uint8Array, open: OpenSqlite): Promise<AnkiCollection> {
  const entries = unzipLimited(file);
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
