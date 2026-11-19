/**
 * The defensive side of package reading: the `COLLATE unicase` swap touches the schema only,
 * and packages that would unpack to too much are refused before they fill memory.
 */
import { DatabaseSync } from "node:sqlite";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { type OpenSqlite, AnkiPackageError, readAnkiPackage } from "./read.js";

/** Opens the bytes it is given, and keeps every table's SQL to look at. */
function opener() {
  const schema: string[] = [];
  const open: OpenSqlite = async (bytes) => {
    const db = new DatabaseSync(":memory:");
    db.deserialize(bytes);
    for (const r of db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL").all()) {
      schema.push(String(r["sql"]));
    }
    return {
      all: async (sql) => db.prepare(sql).all() as Record<string, unknown>[],
      close: async () => db.close(),
    };
  };
  return { open, schema };
}

const NOTE = "Schrijf ' COLLATE unicase' in een zin\x1fWrite ' COLLATE unicase' in a sentence";

/**
 * An older-layout collection whose schema says `COLLATE unicase` (put there by hand: this
 * SQLite has no such collation), with enough tables and long enough SQL that the schema spans
 * several pages and overflow pages.
 */
function collection(): Uint8Array {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA page_size = 1024");
  db.exec(`CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, models TEXT, decks TEXT,
    dconf TEXT)`);
  db.exec("INSERT INTO col VALUES (1, 1767240000, '{}', '{}', '{}')");
  db.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, tags TEXT,
    flds TEXT COLLATE binary , sfld TEXT COLLATE binary )`);
  db.prepare("INSERT INTO notes VALUES (1, 7, '', ?, '')").run(NOTE);
  db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER,
    type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, odue INTEGER, odid INTEGER)`);
  db.exec(`CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, ease INTEGER,
    type INTEGER, time INTEGER)`);
  for (let t = 0; t < 60; t++) {
    const cols = Array.from({ length: 120 }, (_, c) => `c${c} TEXT COLLATE binary `);
    db.exec(`CREATE TABLE extra${t} (${cols.join(", ")})`);
  }
  db.enableDefensive(false);
  db.exec("PRAGMA writable_schema = ON");
  db.exec("UPDATE sqlite_master SET sql = replace(sql, 'COLLATE binary ', 'COLLATE unicase')");
  return db.serialize();
}

/** A zip whose central directory says its one entry unpacks to `size` bytes. */
function zipClaiming(name: string, data: Uint8Array, size: number): Uint8Array {
  const zip = zipSync({ [name]: data }, { level: 0 });
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 4 <= zip.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true);
  }
  return zip;
}

describe("reading an Anki package safely", () => {
  it("swaps the collation in the schema only, never in note text", async () => {
    const bytes = collection();
    // Some declarations are split across pages, so a plain byte search would miss them.
    const contiguous = new TextDecoder("latin1").decode(bytes).split("COLLATE unicase").length - 1;
    expect(contiguous).toBeLessThan(60 * 120 + 2);
    const { open, schema } = opener();
    const c = await readAnkiPackage(zipSync({ "collection.anki2": bytes }), open);
    expect(c.notes[0]!.fields.join("\x1f")).toBe(NOTE);
    expect(schema.length).toBeGreaterThan(60);
    expect(schema.filter((s) => /unicase/i.test(s))).toEqual([]);
    expect(schema.find((s) => s.startsWith("CREATE TABLE extra59"))).toContain(
      "c119 TEXT COLLATE binary ",
    );
  });

  it("refuses packages that say they unpack to too much", async () => {
    const { open } = opener();
    const huge = zipClaiming("collection.anki2", new Uint8Array(10), 0xfff00000);
    await expect(readAnkiPackage(huge, open)).rejects.toThrow(/more than Kenning can open/);
    await expect(readAnkiPackage(huge, open)).rejects.toBeInstanceOf(AnkiPackageError);

    // A zstd frame that asks for a terabyte in one piece.
    const frame = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0xe0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0]);
    await expect(readAnkiPackage(zipSync({ "collection.anki21b": frame }), open)).rejects.toThrow(
      /more than Kenning can open/,
    );
  });
});
