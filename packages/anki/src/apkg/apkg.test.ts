/**
 * Package reading on small synthetic packages in both layouts, built here: the older one
 * (collection.anki2, JSON in `col`) and the current one (collection.anki21b, zstd, protobuf
 * blobs in their own tables).
 */
import { zstdCompressSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DEFAULT_DECK_OPTIONS } from "@app/core";
import { buildNativeImport, packageDecks } from "./convert.js";
import { type OpenSqlite, AnkiPackageError, readAnkiPackage } from "./read.js";

const open: OpenSqlite = async (bytes) => {
  const db = new DatabaseSync(":memory:");
  db.deserialize(bytes);
  return {
    all: async (sql) => db.prepare(sql).all() as Record<string, unknown>[],
    close: async () => db.close(),
  };
};

const DAY = 86_400_000;
const CRT = Date.UTC(2026, 0, 1, 4) / 1000;
const NT = 1700000000001;
const CLOZE_NT = 1700000000002;

/** Shared tables of both schemas. */
function baseTables(db: DatabaseSync): void {
  db.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER,
    usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT)`);
  db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER,
    mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER,
    factor INTEGER, reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER,
    flags INTEGER, data TEXT)`);
  db.exec(`CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, usn INTEGER, ease INTEGER,
    ivl INTEGER, lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER)`);
  const note = db.prepare("INSERT INTO notes VALUES (?,?,?,0,0,?,?,'',0,0,'')");
  note.run(
    11,
    "g1",
    NT,
    " nl ",
    ["de fiets", "bicycle", "Ik fiets naar huis.", '<img src="fiets.png">'].join("\x1f"),
  );
  note.run(12, "g2", NT, "", ["het huis", "house", "", "[sound:huis.mp3]"].join("\x1f"));
  note.run(13, "g3", CLOZE_NT, "", ["Ik {{c1::loop}} naar {{c2::school}}.", ""].join("\x1f"));
  const card = db.prepare("INSERT INTO cards VALUES (?,?,?,?,0,0,?,?,?,?,2500,0,0,0,0,0,0,'')");
  // A review card due on day 40 with interval 20, a new card, two cloze cards (one suspended).
  card.run(101, 11, 2, 0, 2, 2, 40, 20);
  card.run(102, 12, 2, 0, 0, 0, 7, 0);
  card.run(103, 13, 3, 0, 1, 1, Math.round(CRT + 30 * 86400), 0);
  card.run(104, 13, 3, 1, 0, -1, 8, 0);
  const rev = db.prepare("INSERT INTO revlog VALUES (?,?,0,?,?,0,0,?,?)");
  const t0 = CRT * 1000 + 2 * DAY;
  rev.run(t0, 101, 3, -600, 4000, 0);
  rev.run(t0 + 600_000, 101, 3, 1, 3000, 0);
  rev.run(t0 + DAY, 101, 3, 4, 2000, 1);
  rev.run(t0 + 5 * DAY, 101, 3, 20, 2000, 1);
  rev.run(CRT * 1000 + 30 * DAY, 103, 1, -60, 5000, 0);
}

function legacyPackage(): Uint8Array {
  const db = new DatabaseSync(":memory:");
  baseTables(db);
  db.exec(`CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER,
    ver INTEGER, dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT,
    dconf TEXT, tags TEXT)`);
  const models = {
    [NT]: {
      id: NT,
      name: "Dutch word",
      type: 0,
      css: ".card{}",
      flds: [
        { name: "Woord", ord: 0 },
        { name: "Betekenis", ord: 1 },
        { name: "Zin", ord: 2 },
        { name: "Plaatje", ord: 3 },
      ],
      tmpls: [
        {
          name: "Card 1",
          ord: 0,
          qfmt: "{{Woord}}",
          afmt: "{{FrontSide}}<hr id=answer>{{Betekenis}}",
        },
      ],
    },
    [CLOZE_NT]: {
      id: CLOZE_NT,
      name: "Cloze",
      type: 1,
      css: "",
      flds: [
        { name: "Text", ord: 0 },
        { name: "Extra", ord: 1 },
      ],
      tmpls: [
        { name: "Cloze", ord: 0, qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<br>{{Extra}}" },
      ],
    },
  };
  const decks = {
    1: { id: 1, name: "Default", conf: 1, dyn: 0 },
    2: { id: 2, name: "Dutch::Words", conf: 2, dyn: 0 },
    3: { id: 3, name: "Dutch::Clozes", conf: 1, dyn: 0 },
    9: { id: 9, name: "Filtered", dyn: 1 },
  };
  const dconf = {
    1: {
      id: 1,
      new: { delays: [1, 10], perDay: 20 },
      lapse: { delays: [10] },
      rev: { maxIvl: 36500 },
    },
    2: {
      id: 2,
      new: { delays: [5], perDay: 7 },
      lapse: { delays: [15] },
      rev: { maxIvl: 400 },
      desiredRetention: 0.85,
    },
  };
  db.prepare("INSERT INTO col VALUES (1,?,0,0,11,0,0,0,'{}',?,?,?,'{}')").run(
    CRT,
    JSON.stringify(models),
    JSON.stringify(decks),
    JSON.stringify(dconf),
  );
  return zipSync({
    "collection.anki2": db.serialize(),
    media: new TextEncoder().encode(JSON.stringify({ 0: "fiets.png", 1: "huis.mp3" })),
    0: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    1: new Uint8Array([0xff, 0xfb, 0x90]),
  });
}

/** Protobuf writer for the fixtures. */
const varint = (n: number | bigint): number[] => {
  let v = BigInt(n);
  if (v < 0n) v = BigInt.asUintN(64, v);
  const out: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return out;
};
type Field =
  | [number, "varint", number]
  | [number, "bytes", Uint8Array | string]
  | [number, "floats", number[]]
  | [number, "float", number];
function proto(fields: Field[]): Uint8Array {
  const out: number[] = [];
  for (const [n, kind, v] of fields) {
    if (kind === "varint") out.push(...varint((n << 3) | 0), ...varint(v));
    else if (kind === "float") {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setFloat32(0, v, true);
      out.push(...varint((n << 3) | 5), ...b);
    } else {
      const bytes =
        kind === "floats"
          ? new Uint8Array(new Float32Array(v).buffer)
          : typeof v === "string"
            ? new TextEncoder().encode(v)
            : v;
      out.push(...varint((n << 3) | 2), ...varint(bytes.length), ...bytes);
    }
  }
  return new Uint8Array(out);
}

function latestPackage(): Uint8Array {
  const db = new DatabaseSync(":memory:");
  baseTables(db);
  db.exec(`CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER,
    ver INTEGER, dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT,
    dconf TEXT, tags TEXT)`);
  db.prepare("INSERT INTO col VALUES (1,?,0,0,18,0,0,0,'','','','','')").run(CRT);
  db.exec(
    "CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT, mtime_secs INTEGER, usn INTEGER, config BLOB)",
  );
  db.exec("CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT, config BLOB)");
  db.exec(
    "CREATE TABLE templates (ntid INTEGER, ord INTEGER, name TEXT, mtime_secs INTEGER, usn INTEGER, config BLOB)",
  );
  db.exec(
    "CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT, mtime_secs INTEGER, usn INTEGER, common BLOB, kind BLOB)",
  );
  db.exec(
    "CREATE TABLE deck_config (id INTEGER PRIMARY KEY, name TEXT, mtime_secs INTEGER, usn INTEGER, config BLOB)",
  );
  const nt = db.prepare("INSERT INTO notetypes VALUES (?,?,0,0,?)");
  nt.run(
    NT,
    "Dutch word",
    proto([
      [1, "varint", 0],
      [3, "bytes", ".card{}"],
    ]),
  );
  nt.run(
    CLOZE_NT,
    "Cloze",
    proto([
      [1, "varint", 1],
      [3, "bytes", ""],
    ]),
  );
  const f = db.prepare("INSERT INTO fields VALUES (?,?,?,x'')");
  ["Woord", "Betekenis", "Zin", "Plaatje"].forEach((name, i) => f.run(NT, i, name));
  ["Text", "Extra"].forEach((name, i) => f.run(CLOZE_NT, i, name));
  const t = db.prepare("INSERT INTO templates VALUES (?,?,?,0,0,?)");
  t.run(
    NT,
    0,
    "Card 1",
    proto([
      [1, "bytes", "{{Woord}}"],
      [2, "bytes", "{{FrontSide}}<hr id=answer>{{Betekenis}}"],
    ]),
  );
  t.run(
    CLOZE_NT,
    0,
    "Cloze",
    proto([
      [1, "bytes", "{{cloze:Text}}"],
      [2, "bytes", "{{cloze:Text}}<br>{{Extra}}"],
    ]),
  );
  const normal = (conf: number) => proto([[1, "bytes", proto([[1, "varint", conf]])]]);
  const d = db.prepare("INSERT INTO decks VALUES (?,?,0,0,x'',?)");
  d.run(1, "Default", normal(1));
  d.run(2, "Dutch\x1fWords", normal(2));
  d.run(3, "Dutch\x1fClozes", normal(1));
  d.run(9, "Filtered", proto([[2, "bytes", new Uint8Array(0)]]));
  const params = [
    0.4, 1.1, 3.2, 15.7, 7.2, 0.5, 1.4, 0.005, 1.5, 0.12, 1.0, 1.9, 0.11, 0.29, 2.27, 0.25, 2.9,
    0.5, 0.67, 0.06, 0.15,
  ];
  const c = db.prepare("INSERT INTO deck_config VALUES (?,?,0,0,?)");
  c.run(
    1,
    "Default",
    proto([
      [1, "floats", [1, 10]],
      [2, "floats", [10]],
      [9, "varint", 20],
      [16, "varint", 36500],
    ]),
  );
  c.run(
    2,
    "Words",
    proto([
      [1, "floats", [5]],
      [2, "floats", [15]],
      [6, "floats", params],
      [9, "varint", 7],
      [16, "varint", 400],
      [37, "float", 0.85],
    ]),
  );
  const media = proto([
    [
      1,
      "bytes",
      proto([
        [1, "bytes", "fiets.png"],
        [2, "varint", 4],
      ]),
    ],
    [
      1,
      "bytes",
      proto([
        [1, "bytes", "huis.mp3"],
        [2, "varint", 3],
      ]),
    ],
  ]);
  return zipSync({
    "collection.anki21b": zstdCompressSync(db.serialize()),
    "collection.anki2": new Uint8Array(0),
    media: zstdCompressSync(media),
    0: zstdCompressSync(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    1: zstdCompressSync(new Uint8Array([0xff, 0xfb, 0x90])),
  });
}

describe.each([
  ["older layout (collection.anki2)", legacyPackage],
  ["current layout (collection.anki21b)", latestPackage],
])("Anki package, %s", (_name, build) => {
  it("reads note types, decks with options, notes, cards, history and media", async () => {
    const col = await readAnkiPackage(build(), open);
    const word = col.notetypes.find((n) => n.id === NT)!;
    expect(word).toMatchObject({ name: "Dutch word", kind: "standard", css: ".card{}" });
    expect(word.fields).toEqual(["Woord", "Betekenis", "Zin", "Plaatje"]);
    expect(word.templates[0]).toEqual({
      name: "Card 1",
      front: "{{Woord}}",
      back: "{{FrontSide}}<hr id=answer>{{Betekenis}}",
    });
    expect(col.notetypes.find((n) => n.id === CLOZE_NT)?.kind).toBe("cloze");
    expect(col.decks.map((d) => d.name).sort()).toEqual([
      "Default",
      "Dutch::Clozes",
      "Dutch::Words",
    ]);
    const words = col.decks.find((d) => d.name === "Dutch::Words")!;
    expect(words.options).toEqual({
      ...DEFAULT_DECK_OPTIONS,
      learningSteps: [5],
      relearningSteps: [15],
      maxInterval: 400,
      newPerDay: 7,
      desiredRetention: 0.85,
    });
    expect(col.notes.map((n) => n.id)).toEqual([11, 12, 13]);
    expect(col.notes[0]?.tags).toEqual(["nl"]);
    expect(col.cards.find((c) => c.id === 101)).toMatchObject({
      type: 2,
      intervalDays: 20,
      dueMs: (CRT + 40 * 86400) * 1000,
    });
    expect(col.cards.find((c) => c.id === 102)?.newPosition).toBe(7);
    expect(col.reviews).toHaveLength(5);
    expect(col.media.map((m) => m.name)).toEqual(["fiets.png", "huis.mp3"]);
    expect(await col.media[0]!.bytes()).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("imports chosen decks with keys, replayed memory and media", async () => {
    const col = await readAnkiPackage(build(), open);
    expect(packageDecks(col)).toEqual([
      { name: "Dutch::Clozes", notes: 1, cards: 2, reviews: 1 },
      { name: "Dutch::Words", notes: 2, cards: 2, reviews: 4 },
    ]);
    const stored: string[] = [];
    const imp = await buildNativeImport(col, ["Dutch::Words"], {
      lang: "nl",
      origin: "apkg",
      analyzeTerms: async (terms) =>
        terms.map((t) => ({ key: t.split(" ").at(-1)!, aliases: [], article: t.split(" ")[0]! })),
      putMedia: async (name) => (stored.push(name), name.padEnd(64, "0")),
      now: Date.UTC(2026, 3, 1),
    });
    expect(imp).toMatchObject({ notes: 2, cards: 2, reviews: 4, vocabNotes: 2, media: 2 });
    const [ev] = imp.events;
    expect(ev?.notetypes?.[0]?.vocab).toEqual({
      word: "Woord",
      gloss: "Betekenis",
      sentence: "Zin",
    });
    expect(ev?.notes[0]).toMatchObject({
      key: "fiets",
      article: "de",
      gloss: "bicycle",
      sentence: "Ik fiets naar huis.",
    });
    const reviewed = ev?.cards.find((c) => c.id === 101);
    expect(reviewed?.schedule).toMatchObject({
      state: 2,
      due: (CRT + 40 * 86400) * 1000,
      scheduledDays: 20,
    });
    expect(reviewed?.schedule?.stability).toBeGreaterThan(1);
    expect(ev?.cards.find((c) => c.id === 102)?.schedule).toBeUndefined();
    expect(stored.sort()).toEqual(["fiets.png", "huis.mp3"]);
    expect(imp.fsrsParams?.length ?? 0).toBe(build === latestPackage ? 21 : 0);
  });

  it("keeps cloze cards and their suspension", async () => {
    const col = await readAnkiPackage(build(), open);
    const imp = await buildNativeImport(col, ["Dutch::Clozes"], { lang: "nl", origin: "apkg" });
    const cards = imp.events[0]!.cards;
    expect(cards.map((c) => [c.ord, c.suspended ?? false, c.schedule?.state ?? 0])).toEqual([
      [0, false, 1],
      [1, true, 0],
    ]);
  });
});

it("rejects a file that is not a package", async () => {
  await expect(readAnkiPackage(new Uint8Array([1, 2, 3]), open)).rejects.toBeInstanceOf(
    AnkiPackageError,
  );
});
