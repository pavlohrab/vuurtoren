/**
 * The sync engine: this device's new events go up as sealed files, the other devices' files
 * come down and are imported in clock order (`importEvents`), with at most one replay per
 * sync. Images and sounds the events refer to travel as sealed blobs under names that do not
 * reveal them.
 *
 * Layout under the place's root:
 *
 *   vuurtoren/vault.json                         the data key under the passphrase and recovery locks
 *   vuurtoren/devices/<device>/<lastId>.kev      events of one device, oldest first
 *   vuurtoren/devices/<device>/<lastId>.base.kev a part of the device's folded events
 *   vuurtoren/devices/<device>/device.kev        the device's name and when it last wrote
 *   vuurtoren/blobs/<hmac>.kbl                   an image or sound
 *   vuurtoren/devices/<device>/analyses/<hmac>.kan  a text's analysis, as this device made it
 *
 * Each file holds a device's events after one id up to another (`after`, `last`), and every
 * file is sealed with its path, so a file moved or renamed by the place does not open. A
 * device only writes its own folder and blobs, so places that copy files around (Syncthing,
 * Dropbox) never see two devices write the same file.
 *
 * Text bundles: a text's analysis, grammar hits and per-sentence extras are derived data, never
 * events. A device that made them (it has a language server) puts them in its own `analyses`
 * folder; a device with a text it has no analysis of looks there, so a phone without a language
 * server reads what the computer analysed. Their names hide the text (HMAC of its id and content
 * hash), and like everything else they are sealed with the passphrase.
 */
import { Gunzip, gzipSync } from "fflate";
import { isUlid } from "../ids.js";
import { isBlobId } from "../library.js";
import type { VuurtorenRepository } from "../repository.js";
import type { AppEvent, SyncEvent, TextAnalysisState, TextBundle } from "../types.js";
import {
  type SyncKey,
  type Argon2Cost,
  type VaultFile,
  changePassphrase,
  checkKey,
  createVault,
  newRecoveryKey,
  hiddenName,
  parseVault,
  seal,
  unlockVault,
  unseal,
  vaultId,
} from "./crypto.js";
import type { SyncStore } from "./store.js";

const ROOT = "vuurtoren";
export const VAULT_PATH = `${ROOT}/vault.json`;
const DEVICES = `${ROOT}/devices`;
const BLOBS = `${ROOT}/blobs`;
const MiB = 1024 * 1024;
/** Events per segment file. */
const SEGMENT_EVENTS = 2000;
/** JSON bytes per segment file (a single larger event goes alone). */
const SEGMENT_BYTES = 4 * MiB;
/** A folded part closes at the first file end past this many JSON bytes. */
const BASE_BYTES = 8 * MiB;
/** No part grows past this, even inside one old file. */
const BASE_MAX_BYTES = 16 * MiB;
/**
 * The most JSON one file may hold. Sealed and gzipped it stays under the 64 MiB a Vuurtoren
 * server and the desktop app accept; reading stops past 64 MiB.
 */
const MAX_FILE_BYTES = 60 * MiB;
const MAX_READ_BYTES = 64 * MiB;
/** A device's segment files are folded past this many. */
const FOLD_AFTER = 100;
/** Folds between two refolds of everything (only when compaction removed something). */
const REFOLD_EVERY = 10;
/** device.kev is written when something was sent, else at most this often. */
const ANNOUNCE_MS = 3_600_000;
/** The devices' names are read when something came in or went out, else at most this often. */
const DEVICES_EVERY_MS = 3_600_000;
/** How long a file that does not open is tried again before it is left out. */
const RETRY_FOR_MS = 3_600_000;
/** How long a file waits for the one before it (still being copied) before it is taken anyway. */
const GAP_WAIT_MS = 86_400_000;
/** Missing blobs: how many are remembered, how long, and how many are fetched per sync. */
const MISSING_MAX = 1000;
const MISSING_MS = 30 * 86_400_000;
const MISSING_PER_SYNC = 200;
/** Text bundles sent and fetched per sync, so a sync stays quick; the rest come next time. */
const BUNDLES_OUT_PER_SYNC = 20;
const BUNDLES_IN_PER_SYNC = 20;
/** A text with an analysis but no extras looks for another device's at most this often. */
const EXTRAS_RETRY_MS = 15 * 60_000;
/**
 * A bundle without its grammar or extras waits this long after the analysis before it's sent:
 * they are made right after, and then it goes once, full. After that it goes as it is (a phone
 * can't read the text at all without it) and the rest follows.
 */
const PARTIAL_BUNDLE_WAIT_MS = 2 * 60_000;
/** Blob ids known to be in the place, remembered so blobs are not listed every sync. */
const KNOWN_BLOBS = 1000;
const PROBLEMS_KEPT = 50;
const NAME_MAX = 64;
const SEGMENT = /^([0-7][0-9A-HJKMNP-TV-Z]{25})(\.base)?\.kev$/;
const DEVICE_ID = /^[0-9A-Za-z_]{1,64}$/;

interface SegmentFile {
  format: 2;
  device: string;
  /** This device's events after this id ("" from the start)… */
  after: string;
  /** …up to this one, the file's name. */
  last: string;
  events: SyncEvent[];
}

/** A device that syncs to this place. */
export interface SyncDevice {
  id: string;
  name: string;
  /** When it last wrote its name (ms): its last sync, give or take an hour. */
  at: number;
  /** This device. */
  self: boolean;
}

/** Something sync left out or is waiting on. */
export interface SyncProblem {
  /** A file of the place, or an event id. */
  what: string;
  /** Why, in plain words. */
  error: string;
  /**
   * Left out for good (a file that never opened, a change too big to send), or kept but not
   * applied (an event a projection cannot apply). Else it is tried again next sync.
   */
  leftOut: boolean;
}

/** Bookkeeping kept on this device only (`repo.syncState`). */
interface SyncState {
  /** The vault this state belongs to (`vaultId`): another vault starts over. */
  vault: string;
  /** Last own event id sent. */
  sent?: string;
  /** Last event id imported, per other device. */
  received: Record<string, string>;
  /** Blobs the events referred to that were not in the place yet, with when first missed. */
  missing?: Record<string, number>;
  /** Blob ids known to be in the place, newest last. */
  blobs?: string[];
  /** The name and time last written to device.kev. */
  announced?: { name: string; at: number; replaces?: string[] };
  /** Folds so far, and events compaction removed since the last refold. */
  folds?: number;
  compacted?: number;
  /** When the devices' names were last read. */
  listedAt?: number;
  /** Files that did not open yet or wait for an earlier file, by path, with since when. */
  retries?: Record<string, { error: string; since: number }>;
  /** What was left out, newest last. */
  problems?: SyncProblem[];
  /** Per text, the bundle sent from or taken into this device (`bundleStamp`). */
  bundles?: Record<string, string>;
  /**
   * Per text, the path of the bundle file this device put in its folder: removed when the text
   * is deleted, or replaced when the text changed (a new content hash gives a new name).
   */
  sentBundles?: Record<string, string>;
  /** Texts with an analysis but no extras, with when another device's bundle was last asked. */
  extrasAsked?: Record<string, number>;
}

export interface SyncSummary {
  sent: number;
  received: number;
  /** The log was replayed because some events were older than its end. */
  rebuilt: boolean;
  /**
   * Every device of the place, read when something came in or went out and at least hourly;
   * null when this sync did not read them.
   */
  devices: SyncDevice[] | null;
  /** What this sync left out or is waiting on. */
  problems: SyncProblem[];
}

/** File sizes the engine works with; tests make them small. */
export interface SyncLimits {
  /** Events per segment file. */
  segmentEvents: number;
  /** JSON bytes per segment file (a single larger event goes alone). */
  segmentBytes: number;
  /** A folded part closes at the first file end past this many JSON bytes. */
  baseBytes: number;
  /** A device's segment files are folded past this many. */
  foldAfter: number;
}

const LIMITS: SyncLimits = {
  segmentEvents: SEGMENT_EVENTS,
  segmentBytes: SEGMENT_BYTES,
  baseBytes: BASE_BYTES,
  foldAfter: FOLD_AFTER,
};

export interface SyncOptions {
  /** This device's name, shown on the others ("Laptop", "Phone"). */
  deviceName: string;
  /**
   * Devices this one replaces (the same phone before a reinstall): they stay in the place, with
   * their history, but no device lists them any more.
   */
  replaces?: string[];
  now?: () => number;
  onProgress?: (message: string) => void;
  /** Tests only: smaller files. */
  testLimits?: Partial<SyncLimits>;
}

/** The place holds no Vuurtoren data (yet). */
export class NoVaultError extends Error {
  override readonly name = "NoVaultError";
  constructor() {
    super("There is no Vuurtoren data here yet.");
  }
}

/** A file written by a newer Vuurtoren: waited on, never left out. */
class NewerFileError extends Error {
  override readonly name = "NewerFileError";
}

const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const decode = <T>(b: Uint8Array): T => JSON.parse(new TextDecoder().decode(b)) as T;
const jsonBytes = (v: unknown) => encode(v).length;
const deviceDir = (id: string) => `${DEVICES}/${id}`;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function readVault(store: SyncStore): Promise<VaultFile | null> {
  const bytes = await store.get(VAULT_PATH);
  return bytes ? parseVault(bytes) : null;
}

/**
 * The key for a place: unlock its vault with the passphrase (or a recovery key), or, with
 * `create`, make a new vault when the place has none. `recoveryKey` is set only for a new vault:
 * it is shown once.
 */
export async function openVault(
  store: SyncStore,
  secret: string,
  create: boolean,
  cost?: Argon2Cost,
): Promise<{ key: SyncKey; recoveryKey: string | null }> {
  const vault = await readVault(store);
  if (vault) return { key: await unlockVault(vault, secret), recoveryKey: null };
  if (!create) throw new NoVaultError();
  const made = await createVault(secret, cost);
  await store.put(VAULT_PATH, encode(made.vault));
  return { key: made.key, recoveryKey: made.recoveryKey };
}

/** Give the place's vault a new passphrase (the data key and every file stay as they are). */
export async function changeVaultPassphrase(
  store: SyncStore,
  key: SyncKey,
  passphrase: string,
  cost?: Argon2Cost,
): Promise<void> {
  const vault = await readVault(store);
  if (!vault) throw new NoVaultError();
  await store.put(VAULT_PATH, encode(await changePassphrase(vault, key, passphrase, cost)));
}

/** A new recovery key for the place's vault (the old one stops working). */
export async function renewRecoveryKey(
  store: SyncStore,
  key: SyncKey,
  cost?: Argon2Cost,
): Promise<string> {
  const vault = await readVault(store);
  if (!vault) throw new NoVaultError();
  const made = await newRecoveryKey(vault, key, cost);
  await store.put(VAULT_PATH, encode(made.vault));
  return made.recoveryKey;
}

/** Blob ids an event refers to (a text's cover, the media of imported cards). */
export function blobRefs(e: AppEvent): string[] {
  const refs =
    e.type === "TextCoverSet"
      ? [e.blobId]
      : e.type === "NativeNotesAdded"
        ? Object.values(e.media ?? {})
        : [];
  return refs.filter(isBlobId);
}

/** Gunzip, refusing more than `max` bytes of output (a small file that unpacks to gigabytes). */
function gunzipAtMost(bytes: Uint8Array, max: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  const gunzip = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > max) throw new Error("A synced file unpacks to more than Vuurtoren reads.");
    parts.push(chunk);
  });
  // Small steps: one step unpacks to at most about a thousand times its size.
  const STEP = 4096;
  for (let i = 0; i < bytes.length; i += STEP) {
    gunzip.push(bytes.subarray(i, i + STEP), i + STEP >= bytes.length);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function pack(key: SyncKey, path: string, file: SegmentFile): Promise<Uint8Array> {
  return seal(key, gzipSync(encode(file), { level: 6 }), path);
}

async function unpack(key: SyncKey, path: string, bytes: Uint8Array): Promise<SegmentFile> {
  return decode<SegmentFile>(gunzipAtMost(await unseal(key, bytes, path), MAX_READ_BYTES));
}

async function packBlob(
  key: SyncKey,
  path: string,
  type: string,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const head = new TextEncoder().encode(type).slice(0, 255);
  const plain = new Uint8Array(2 + head.length + bytes.length);
  plain[0] = head.length >> 8;
  plain[1] = head.length & 0xff;
  plain.set(head, 2);
  plain.set(bytes, 2 + head.length);
  return seal(key, plain, path);
}

async function unpackBlob(
  key: SyncKey,
  path: string,
  sealed: Uint8Array,
): Promise<{ type: string; bytes: Uint8Array }> {
  const plain = await unseal(key, sealed, path);
  const n = plain.length >= 2 ? (plain[0]! << 8) + plain[1]! : -1;
  if (n < 0 || n > 255 || 2 + n > plain.length) throw new Error("A synced image is damaged.");
  return {
    type: new TextDecoder().decode(plain.slice(2, 2 + n)),
    bytes: plain.slice(2 + n),
  };
}

interface Segment {
  name: string;
  lastId: string;
  base: boolean;
}

/** A device's event files, by last id; on the same id the smaller segment comes first. */
function segments(names: string[]): Segment[] {
  return names
    .flatMap((name) => {
      const m = SEGMENT.exec(name);
      return m ? [{ name, lastId: m[1]!, base: !!m[2] }] : [];
    })
    .sort((a, b) =>
      a.lastId < b.lastId ? -1 : a.lastId > b.lastId ? 1 : Number(a.base) - Number(b.base),
    );
}

/**
 * The files of another device that may hold events after `cursor`, in the order to read them.
 * Reading skips a file that ends at or before what was read so far, so a device reads the
 * small segment files while they are there, and the folded parts only for what is gone.
 */
export function toImport(names: string[], cursor: string): string[] {
  return segments(names)
    .filter((s) => s.lastId > cursor)
    .map((s) => s.name);
}

/** A file's events, checked against its device and its name. Throws with the reason. */
function checkFile(
  file: SegmentFile,
  dev: string,
  seg: Segment,
): { after: string; last: string; events: SyncEvent[] } {
  if (!file || typeof file !== "object") throw new Error("This file is damaged.");
  if (typeof file.format === "number" && file.format > 2) {
    throw new NewerFileError("This file was written by a newer Vuurtoren. Update Vuurtoren.");
  }
  if (file.format !== 2) throw new Error("This file is damaged.");
  if (file.device !== dev) throw new Error("This file belongs to another device.");
  if (!Array.isArray(file.events)) throw new Error("This file is damaged.");
  const events = file.events.filter(
    (e): e is SyncEvent => !!e && typeof e === "object" && (e as SyncEvent).deviceId === dev,
  );
  const after = file.after;
  if (file.last !== seg.lastId || typeof after !== "string" || (after && !isUlid(after))) {
    throw new Error("This file does not hold what its name says.");
  }
  if (after >= seg.lastId || events.some((e) => !(e.id > after && e.id <= seg.lastId))) {
    throw new Error("This file does not hold what its name says.");
  }
  return { after, last: seg.lastId, events };
}

/** Every device of the place, with its name and when it last wrote it. */
export async function listDevices(
  store: SyncStore,
  key: SyncKey,
  self: string,
): Promise<SyncDevice[]> {
  const out: SyncDevice[] = [];
  const replaced = new Set<string>();
  for (const id of await store.list(DEVICES)) {
    if (!DEVICE_ID.test(id)) continue;
    const path = `${deviceDir(id)}/device.kev`;
    const bytes = await store.get(path);
    // An empty or foreign folder (some places keep folders whose files are gone) is no device.
    if (!bytes) continue;
    let info = { name: "A device", at: 0 };
    try {
      const raw = decode<{ name?: unknown; at?: unknown; replaces?: unknown }>(
        await unseal(key, bytes, path),
      );
      if (Array.isArray(raw.replaces))
        for (const r of raw.replaces) if (typeof r === "string") replaced.add(r);
      info = {
        name:
          typeof raw.name === "string" && raw.name.trim()
            ? raw.name.trim().slice(0, NAME_MAX)
            : "A device",
        at: typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : 0,
      };
    } catch {
      // Unreadable: listed without a name.
    }
    out.push({ id, name: info.name, at: info.at, self: id === self });
  }
  return out
    .filter((d) => d.self || !replaced.has(d.id))
    .sort((a, b) => Number(b.self) - Number(a.self) || b.at - a.at);
}

/** One sync: send what is new here, then bring in what is new elsewhere. */
export async function syncOnce(
  repo: VuurtorenRepository,
  store: SyncStore,
  key: SyncKey,
  opts: SyncOptions,
): Promise<SyncSummary> {
  const now = opts.now ?? Date.now;
  const progress = opts.onProgress ?? (() => undefined);
  const limits = { ...LIMITS, ...opts.testLimits };
  const vault = await readVault(store);
  if (!vault)
    throw new Error("The sync place no longer holds your Vuurtoren data. Set up sync again.");
  await checkKey(vault, key);
  const saved = (await repo.syncState()) as SyncState | null;
  const state: SyncState =
    saved && saved.vault === vaultId(vault) ? saved : { vault: vaultId(vault), received: {} };
  const me = repo.deviceId;
  const problems: SyncProblem[] = [];
  const leaveOut = (p: SyncProblem) => {
    problems.push(p);
    const others = (state.problems ?? []).filter((q) => q.what !== p.what);
    state.problems = [...others, p].slice(-PROBLEMS_KEPT);
  };
  const retries = (state.retries ??= {});

  // Send: blobs first, so a device that reads a segment finds what it refers to. Blobs known
  // to be in the place are remembered; the place's blobs are listed only for one that is not.
  const known = new Set(state.blobs ?? []);
  let listed: Set<string> | null = null;
  const segmentBytes = limits.segmentBytes;
  let sent = 0;
  for (;;) {
    const page = await repo.exportEvents(state.sent, limits.segmentEvents);
    if (page.length === 0) break;
    let events: SyncEvent[] = [];
    let bytes = 0;
    for (const e of page) {
      const size = jsonBytes(e);
      if (events.length > 0 && bytes + size > segmentBytes) break;
      events.push(e);
      bytes += size;
    }
    const last = events[events.length - 1]!.id;
    if (bytes > MAX_FILE_BYTES) {
      // One change bigger than any place takes: an empty file keeps the files in a row.
      leaveOut({
        what: last,
        error: "This change is too big to sync. It stays on this device.",
        leftOut: true,
      });
      events = [];
    }
    progress(`Sending ${sent + events.length} changes`);
    for (const id of new Set(events.flatMap((e) => blobRefs(e.event)))) {
      if (known.has(id)) continue;
      const name = `${await hiddenName(key, id)}.kbl`;
      listed ??= new Set(await store.list(BLOBS));
      if (!listed.has(name)) {
        const blob = await repo.getBlob(id);
        if (!blob) continue;
        const path = `${BLOBS}/${name}`;
        const sealed = await packBlob(key, path, blob.type, blob.bytes);
        if (sealed.length > MAX_FILE_BYTES) continue;
        await store.put(path, sealed);
        listed.add(name);
      }
      known.add(id);
    }
    const path = `${deviceDir(me)}/${last}.kev`;
    await store.put(
      path,
      await pack(key, path, { format: 2, device: me, after: state.sent ?? "", last, events }),
    );
    state.sent = last;
    state.blobs = [...known].slice(-KNOWN_BLOBS);
    sent += events.length;
    await repo.setSyncState(state);
  }
  const name = opts.deviceName.trim().slice(0, NAME_MAX) || "A device";
  const told = state.announced;
  const replaces = [...new Set(opts.replaces ?? [])].filter(
    (id) => DEVICE_ID.test(id) && id !== me,
  );
  const sameReplaces = (told?.replaces ?? []).join() === replaces.join();
  if (
    sent > 0 ||
    !told ||
    told.name !== name ||
    !sameReplaces ||
    Math.abs(now() - told.at) >= ANNOUNCE_MS
  ) {
    const path = `${deviceDir(me)}/device.kev`;
    const info = replaces.length ? { name, at: now(), replaces } : { name, at: now() };
    await store.put(path, await seal(key, encode(info), path));
    state.announced = { name, at: now(), ...(replaces.length ? { replaces } : {}) };
    await repo.setSyncState(state);
  }
  await sendBundles(repo, store, key, state, leaveOut, now());

  // Receive: every new file of every device, imported without a replay; one replay at the
  // end when some events were older than the log's end.
  let received = 0;
  let rebuilt: boolean;
  const missing = missingOf(state, now());
  const noteFailed = (failed: { id: string; error: string }[]) => {
    for (const f of failed) {
      leaveOut({ what: f.id, error: `A change could not be applied: ${f.error}`, leftOut: true });
    }
  };
  try {
    for (const dev of await store.list(DEVICES)) {
      if (dev === me || !DEVICE_ID.test(dev)) continue;
      let cursor = state.received[dev] ?? "";
      for (const fileName of toImport(await store.list(deviceDir(dev)), cursor)) {
        const seg = segments([fileName])[0]!;
        if (seg.lastId <= cursor) continue;
        const path = `${deviceDir(dev)}/${fileName}`;
        const bytes = await store.get(path);
        // Folded away since the listing: what replaced it comes next time.
        if (!bytes) break;
        let file: ReturnType<typeof checkFile>;
        try {
          file = checkFile(await unpack(key, path, bytes), dev, seg);
        } catch (err) {
          if (err instanceof NewerFileError) {
            problems.push({ what: path, error: err.message, leftOut: false });
            break;
          }
          // Tried again on the next syncs (it may still be arriving); after an hour, left out.
          const r = (retries[path] = {
            error: message(err),
            since: retries[path]?.since ?? now(),
          });
          if (now() - r.since < RETRY_FOR_MS) {
            problems.push({ what: path, error: r.error, leftOut: false });
            break;
          }
          delete retries[path];
          leaveOut({ what: path, error: r.error, leftOut: true });
          cursor = seg.lastId;
          state.received[dev] = cursor;
          await repo.setSyncState(state);
          continue;
        }
        if (file.after > cursor) {
          // A file before this one has not arrived yet. A later folded part may cover it;
          // else this one waits, and after a day it is taken anyway.
          const r = (retries[path] = {
            error: "Waiting for an earlier file of this device.",
            since: retries[path]?.since ?? now(),
          });
          if (now() - r.since < GAP_WAIT_MS) {
            problems.push({ what: path, error: r.error, leftOut: false });
            continue;
          }
          leaveOut({
            what: path,
            error: "Some changes of this device never arrived; the later ones were taken.",
            leftOut: true,
          });
        }
        delete retries[path];
        const events = file.events.filter((e) => e.id > cursor);
        progress(`Receiving ${received + events.length} changes`);
        for (const e of events) {
          for (const id of blobRefs(e.event)) if (!(id in missing)) missing[id] = now();
        }
        const r = await repo.importEvents(events, { deferReplay: true });
        received += r.added;
        noteFailed(r.failed);
        cursor = file.last;
        state.received[dev] = cursor;
        await repo.setSyncState(state);
      }
      // Files waited on that what was read since has passed.
      for (const path of Object.keys(retries)) {
        const m = path.startsWith(`${deviceDir(dev)}/`) && SEGMENT.exec(path.split("/").pop()!);
        if (m && m[1]! <= cursor) delete retries[path];
      }
    }
  } finally {
    // The one replay of this sync, also when it stopped early.
    const r = await repo.importEvents([]);
    rebuilt = r.rebuilt;
    noteFailed(r.failed);
  }

  await fetchMissing(repo, store, key, missing, known, now());
  state.missing = missing;
  state.blobs = [...known].slice(-KNOWN_BLOBS);
  await repo.setSyncState(state);
  // Texts that became readable count as received, so the screens refresh.
  received += await fetchBundles(repo, store, key, state, now());

  await foldOwn(repo, store, key, state, progress, limits);
  let devices: SyncDevice[] | null = null;
  if (
    sent > 0 ||
    received > 0 ||
    !sameReplaces ||
    !state.listedAt ||
    now() - state.listedAt >= DEVICES_EVERY_MS
  ) {
    devices = await listDevices(store, key, me);
    state.listedAt = now();
    await repo.setSyncState(state);
  }
  return { sent, received, rebuilt, devices, problems };
}

/**
 * Format of a text bundle file. Format 2 (empty alignments as null, `extras.mtModel`) only adds
 * to format 1, so it is still written as 1: older apps read it and skip what they don't know.
 * Readers take 1 and 2.
 */
interface BundleFile extends TextBundle {
  format: 1 | 2;
}

/** What a bundle holds, in one string: a changed analysis, grammar or extras is sent again. */
export function bundleStamp(
  s: Pick<TextAnalysisState, "contentHash" | "analyzedAt" | "grammar" | "extrasAt">,
): string {
  return `${s.contentHash}:${s.analyzedAt}:${s.grammar ?? "-"}:${s.extrasAt ?? "-"}`;
}

const stampOf = (b: TextBundle) =>
  bundleStamp({
    contentHash: b.contentHash,
    analyzedAt: b.analyzedAt,
    grammar: b.grammar?.version ?? null,
    extrasAt: b.extras?.madeAt ?? null,
  });

async function bundleName(key: SyncKey, textId: string, hash: string): Promise<string> {
  return `${await hiddenName(key, `bundle:${textId}:${hash}`)}.kan`;
}

/**
 * Send the bundles of texts this device analysed (or whose grammar or extras it added) since it
 * last sent them. A bundle this device took from another is not sent back.
 */
async function sendBundles(
  repo: VuurtorenRepository,
  store: SyncStore,
  key: SyncKey,
  state: SyncState,
  leaveOut: (p: SyncProblem) => void,
  at: number,
): Promise<void> {
  const done = (state.bundles ??= {});
  const sent = (state.sentBundles ??= {});
  // A deleted text's bundle leaves this device's folder (the place keeps nothing of it).
  const live = new Set((await repo.listTexts()).map((t) => t.id));
  for (const [textId, path] of Object.entries(sent)) {
    if (live.has(textId)) continue;
    await store.remove(path);
    delete sent[textId];
    delete done[textId];
    await repo.setSyncState(state);
  }
  const full = (s: TextAnalysisState) => s.grammar !== null && s.extrasAt !== null;
  const todo = (await repo.analysisStates())
    .filter((s) => done[s.textId] !== bundleStamp(s))
    .filter((s) => full(s) || at - s.analyzedAt >= PARTIAL_BUNDLE_WAIT_MS)
    .slice(0, BUNDLES_OUT_PER_SYNC);
  for (const s of todo) {
    const bundle = await repo.textBundle(s.textId);
    if (!bundle) continue;
    const json = encode({ format: 1, ...bundle } satisfies BundleFile);
    if (json.length > MAX_FILE_BYTES) {
      leaveOut({
        what: s.textId,
        error: "This text is too long to send its analysis. Other devices analyse it themselves.",
        leftOut: true,
      });
      done[s.textId] = bundleStamp(s);
      continue;
    }
    const path = `${deviceDir(repo.deviceId)}/analyses/${await bundleName(key, s.textId, s.contentHash)}`;
    await store.put(path, await seal(key, gzipSync(json, { level: 6 }), path));
    // The text changed since: its old bundle (another name) goes.
    const old = sent[s.textId];
    if (old && old !== path) await store.remove(old);
    sent[s.textId] = path;
    done[s.textId] = bundleStamp(s);
    await repo.setSyncState(state);
  }
}

/**
 * Take other devices' bundles of texts this device has no analysis of. Returns how many texts
 * became readable.
 */
async function fetchBundles(
  repo: VuurtorenRepository,
  store: SyncStore,
  key: SyncKey,
  state: SyncState,
  at: number,
): Promise<number> {
  // Texts with no analysis, then texts whose analysis came without extras or grammar (asked
  // again now and then: the other device may have made them since).
  const asked = (state.extrasAsked ??= {});
  const noExtras = (await repo.analysisStates()).filter(
    (s) => s.extrasAt === null || s.grammar === null,
  );
  for (const id of Object.keys(asked)) {
    if (!noExtras.some((s) => s.textId === id)) delete asked[id];
  }
  const wanted = [
    ...(await repo.unanalysedTexts()),
    ...noExtras.filter((s) => at - (asked[s.textId] ?? 0) >= EXTRAS_RETRY_MS),
  ];
  for (const s of noExtras) if (wanted.includes(s)) asked[s.textId] = at;
  if (wanted.length === 0) return 0;
  const me = repo.deviceId;
  const where = new Map<string, string>();
  for (const dev of await store.list(DEVICES)) {
    if (dev === me || !DEVICE_ID.test(dev)) continue;
    for (const name of await store.list(`${deviceDir(dev)}/analyses`)) {
      if (!where.has(name)) where.set(name, dev);
    }
  }
  if (where.size === 0) return 0;
  const done = (state.bundles ??= {});
  let took = 0;
  let tried = 0;
  for (const w of wanted) {
    if (tried >= BUNDLES_IN_PER_SYNC) break;
    const name = await bundleName(key, w.textId, w.contentHash);
    const dev = where.get(name);
    if (!dev) continue;
    tried++;
    const path = `${deviceDir(dev)}/analyses/${name}`;
    try {
      const bytes = await store.get(path);
      if (!bytes) continue;
      const file = decode<BundleFile>(gunzipAtMost(await unseal(key, bytes, path), MAX_READ_BYTES));
      if ((file.format !== 1 && file.format !== 2) || file.textId !== w.textId || file.contentHash !== w.contentHash) {
        continue;
      }
      const bundle: TextBundle = {
        textId: file.textId,
        contentHash: file.contentHash,
        analyzerVersion: file.analyzerVersion,
        analyzedAt: file.analyzedAt,
        tokens: file.tokens,
        grammar: file.grammar,
        extras: file.extras,
      };
      if (await repo.saveTextBundle(bundle)) {
        done[w.textId] = stampOf(bundle);
        took++;
      }
    } catch {
      // A damaged or newer file: this device analyses the text itself when it can.
    }
  }
  await repo.setSyncState(state);
  return took;
}

/** The missing blobs of the state, without the oldest past the limits. */
function missingOf(state: SyncState, now: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(state.missing ?? {})
      .filter(([id, since]) => isBlobId(id) && now - since < MISSING_MS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MISSING_MAX),
  );
}

/** Bring in blobs the events referred to; a few hundred per sync. */
async function fetchMissing(
  repo: VuurtorenRepository,
  store: SyncStore,
  key: SyncKey,
  missing: Record<string, number>,
  known: Set<string>,
  now: number,
): Promise<void> {
  let tries = 0;
  for (const id of Object.keys(missing)) {
    if (await repo.getBlob(id)) {
      delete missing[id];
      continue;
    }
    if (++tries > MISSING_PER_SYNC) break;
    const path = `${BLOBS}/${await hiddenName(key, id)}.kbl`;
    const bytes = await store.get(path);
    if (!bytes) continue;
    try {
      const blob = await unpackBlob(key, path, bytes);
      if ((await repo.putBlob(blob.bytes, blob.type)) === id) known.add(id);
    } catch {
      // Damaged, or not a kind of file this device keeps: left out.
    }
    delete missing[id];
  }
  // Ages out what never came.
  for (const [id, since] of Object.entries(missing)) {
    if (now - since >= MISSING_MS) delete missing[id];
  }
}

/**
 * Past `foldAfter` segment files, this device's segments since its last folded part become a
 * few larger parts, and the segments go. The parts before stay as they are, so no device
 * downloads them again. Parts end where existing files end, so a device that has read up to
 * any file reads on from there. Only after compaction removed events, and at most every
 * tenth fold, everything is folded again, so what was removed leaves the place too.
 */
async function foldOwn(
  repo: VuurtorenRepository,
  store: SyncStore,
  key: SyncKey,
  state: SyncState,
  progress: (m: string) => void,
  opts: { foldAfter: number; baseBytes: number },
): Promise<void> {
  const me = repo.deviceId;
  const dir = deviceDir(me);
  const own = segments(await store.list(dir));
  const small = own.filter((s) => !s.base && (!state.sent || s.lastId <= state.sent));
  if (small.length <= opts.foldAfter) return;
  // The newest half stays: a device that keeps up reads those, never a folded part.
  const upTo = small[small.length - 1 - Math.floor(opts.foldAfter / 2)]!.lastId;
  progress("Tidying up the synced files");
  const c = await repo.compact();
  const compacted = (state.compacted ?? 0) + c.removed + c.emptied;
  const folds = state.folds ?? 0;
  const bases = own.filter((s) => s.base);
  const all = bases.length === 0 || (compacted > 0 && folds % REFOLD_EVERY === 0);
  const from = all ? "" : bases[bases.length - 1]!.lastId;
  const bounds = [...new Set(own.map((s) => s.lastId))].filter((id) => id > from && id <= upTo);
  const end = bounds[bounds.length - 1];
  if (!end) return;

  const written = new Set<string>();
  let chunk: SyncEvent[] = [];
  let bytes = 0;
  let after = from;
  let last = "";
  const flush = async () => {
    if (!last) return;
    const name = `${last}.base.kev`;
    const path = `${dir}/${name}`;
    await store.put(
      path,
      await pack(key, path, { format: 2, device: me, after, last, events: chunk }),
    );
    written.add(name);
    after = last;
    chunk = [];
    bytes = 0;
    last = "";
  };
  let b = 0;
  read: for (let cursor = from; ;) {
    const page = await repo.exportEvents(cursor, SEGMENT_EVENTS);
    if (page.length === 0) break;
    for (const e of page) {
      if (e.id > end) break read;
      // Close at file ends once the part is big enough.
      while (b < bounds.length && bounds[b]! < e.id) {
        last = bounds[b++]!;
        if (bytes >= opts.baseBytes) await flush();
      }
      const size = jsonBytes(e);
      // Too big for any place: it was left out when sent.
      if (size > MAX_FILE_BYTES) continue;
      if (bytes > 0 && bytes + size > Math.max(BASE_MAX_BYTES, opts.baseBytes * 2)) {
        const lastEvent = chunk[chunk.length - 1]!.id;
        last = last > lastEvent ? last : lastEvent;
        await flush();
      }
      chunk.push(e);
      bytes += size;
    }
    cursor = page[page.length - 1]!.id;
  }
  last = end;
  await flush();
  // Then the files the parts replace (a part never replaces the parts before it, unless all
  // were folded again).
  for (const s of own) {
    if (written.has(s.name) || s.lastId > end || (s.base && !all)) continue;
    await store.remove(`${dir}/${s.name}`);
  }
  state.folds = folds + 1;
  state.compacted = all ? 0 : compacted;
  await repo.setSyncState(state);
}
