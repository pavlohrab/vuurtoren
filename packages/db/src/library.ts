/**
 * Library organisation: editable text details (TextMetaUpdated, TextCoverSet), cover image
 * blobs and the learner's shelves (Shelf* events).
 *
 * - Text details live in the `text_meta` projection, last write wins per field by HLC, so two
 *   devices editing different fields never lose each other's change.
 * - Shelves are folded from their events on read (table-free, like suggested.ts): ordered by
 *   HLC, so a rename or an add/remove is last-write-wins and a deleted shelf stays deleted.
 * - Blobs (cover images) are content-addressed (SHA-256) rows of the `blobs` table. They are
 *   not a projection (rebuild keeps them) and travel with the database file, so a backup
 *   includes them in both storage modes.
 */
import { sha256Bytes } from "./hash.js";
import { compareHlc } from "./ids.js";
import type { Shelf, SqlDriver, StoredEvent, TextMetaPatch } from "./types.js";

/** Largest cover image accepted (bytes). Covers are ~600px WebP, normally 30–80 KB. */
export const MAX_BLOB_BYTES = 2 * 1024 * 1024;

/** Image types a blob may have. */
export const BLOB_TYPES: readonly string[] = [
  "image/webp",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
];

/** A blob id: the SHA-256 of its bytes, hex. */
export function blobId(bytes: Uint8Array): string {
  return sha256Bytes(bytes);
}

/** True for a string that looks like a blob id (64 lowercase hex). */
export function isBlobId(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-f]{64}$/.test(id);
}

/**
 * Check a blob before storing it.
 * @returns an error message safe to show, or null when it is acceptable
 */
export function blobProblem(bytes: Uint8Array, type: string): string | null {
  if (!BLOB_TYPES.includes(type)) return "Only WebP, JPEG, PNG or SVG images can be stored.";
  if (bytes.length === 0) return "The image is empty.";
  if (bytes.length > MAX_BLOB_BYTES) return "The image is larger than 2 MB.";
  return null;
}

/** Fields of `text_meta` an event can set (column = field name). */
const META_FIELDS = ["title", "author", "note", "level", "cover"] as const;
type MetaField = (typeof META_FIELDS)[number];

/** Longest title / author / note / level kept (longer input is cut). */
const MAX_LEN: Record<MetaField, number> = {
  title: 300,
  author: 200,
  note: 1000,
  level: 20,
  cover: 64,
};

/**
 * Last-write-wins (per field, by HLC) merge of a details patch into `text_meta`. An empty
 * string or null clears a field (a cleared title falls back to the imported one).
 */
export async function applyTextMeta(
  driver: SqlDriver,
  hlc: string,
  textId: string,
  patch: Partial<Record<MetaField, string | null | undefined>>,
): Promise<void> {
  const rows = await driver.exec(
    "SELECT title, author, note, level, cover, hlcs FROM text_meta WHERE text_id = ?",
    [textId],
  );
  const row = rows[0];
  const hlcs: Record<string, string> = row ? (JSON.parse(String(row["hlcs"])) as never) : {};
  const values: Record<MetaField, string | null> = {
    title: null,
    author: null,
    note: null,
    level: null,
    cover: null,
  };
  for (const f of META_FIELDS) {
    const v = row?.[f];
    values[f] = typeof v === "string" ? v : null;
  }
  let changed = false;
  for (const f of META_FIELDS) {
    if (!(f in patch) || patch[f] === undefined) continue;
    const prev = hlcs[f];
    if (prev !== undefined && compareHlc(prev, hlc) >= 0) continue;
    const raw = patch[f];
    const v = typeof raw === "string" ? raw.trim().slice(0, MAX_LEN[f]) : null;
    values[f] = v ? v : null;
    hlcs[f] = hlc;
    changed = true;
  }
  if (!changed) return;
  await driver.exec(
    `INSERT OR REPLACE INTO text_meta (text_id, title, author, note, level, cover, hlcs)
     VALUES (?,?,?,?,?,?,?)`,
    [
      textId,
      values.title,
      values.author,
      values.note,
      values.level,
      values.cover,
      JSON.stringify(hlcs),
    ],
  );
}

/** The patch fields a TextMetaUpdated event may carry (anything else is ignored). */
export function metaPatchFields(patch: TextMetaPatch): Partial<Record<MetaField, string | null>> {
  const out: Partial<Record<MetaField, string | null>> = {};
  for (const f of ["title", "author", "note", "level"] as const) {
    const v = patch[f];
    if (v === undefined) continue;
    out[f] = typeof v === "string" ? v : null;
  }
  return out;
}

const SHELF_TYPES = new Set([
  "ShelfCreated",
  "ShelfRenamed",
  "ShelfDeleted",
  "ShelfTextAdded",
  "ShelfTextRemoved",
]);

/** Event types folded by `projectShelves`. */
export const SHELF_EVENT_TYPES: readonly string[] = [...SHELF_TYPES];

/**
 * Fold Shelf* events into the learner's shelves, in creation order. Texts are listed newest
 * addition first; ids of deleted texts are not removed here (the caller knows which exist).
 */
export function projectShelves(events: readonly StoredEvent[]): Shelf[] {
  const sorted = events
    .filter((e) => SHELF_TYPES.has(e.event.type))
    .sort((a, b) => compareHlc(a.hlc, b.hlc) || (a.id < b.id ? -1 : 1));
  const shelves = new Map<string, Shelf & { added: Map<string, string> }>();
  const deleted = new Set<string>();
  for (const { hlc, event: e } of sorted) {
    switch (e.type) {
      case "ShelfCreated":
        if (!deleted.has(e.shelfId) && !shelves.has(e.shelfId)) {
          shelves.set(e.shelfId, {
            id: e.shelfId,
            name: e.name,
            textIds: [],
            createdAt: hlcMs(hlc),
            added: new Map(),
          });
        }
        break;
      case "ShelfRenamed": {
        const s = shelves.get(e.shelfId);
        if (s && e.name.trim()) s.name = e.name;
        break;
      }
      case "ShelfDeleted":
        deleted.add(e.shelfId);
        shelves.delete(e.shelfId);
        break;
      case "ShelfTextAdded": {
        const s = shelves.get(e.shelfId);
        if (s) for (const id of e.textIds) s.added.set(id, hlc);
        break;
      }
      case "ShelfTextRemoved": {
        const s = shelves.get(e.shelfId);
        if (s) for (const id of e.textIds) s.added.delete(id);
        break;
      }
      default:
        break;
    }
  }
  return [...shelves.values()].map(({ added, ...s }) => ({
    ...s,
    textIds: [...added.entries()].sort((a, b) => compareHlc(b[1], a[1])).map(([id]) => id),
  }));
}

/** Wall-clock ms of an HLC stamp ("<ms>-<counter>-<device>"). */
function hlcMs(hlc: string): number {
  const ms = Number(hlc.split("-")[0]);
  return Number.isFinite(ms) ? ms : 0;
}
