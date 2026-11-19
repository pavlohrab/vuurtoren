/**
 * The sync engine: this device's new events go up as sealed segments, the other devices'
 * segments come down and are imported in clock order (`importEvents`). Images and sounds the
 * events refer to travel as sealed blobs under names that do not reveal them.
 *
 * Layout under the place's root:
 *
 *   kenning/vault.json                         how the passphrase becomes the key
 *   kenning/devices/<device>/<lastId>.kev      events of one device, oldest first
 *   kenning/devices/<device>/<lastId>.base.kev all of a device's events up to lastId (folded)
 *   kenning/devices/<device>/device.kev        the device's name and last sync
 *   kenning/blobs/<hmac>.kbl                   an image or sound
 *
 * A device only writes its own folder and blobs, so places that copy files around
 * (Syncthing, Dropbox) never see two devices write the same file.
 */
import { gunzipSync, gzipSync } from "fflate";
import type { KenningRepository } from "../repository.js";
import type { AppEvent, SyncEvent } from "../types.js";
import {
  type SyncKey,
  type VaultFile,
  checkKey,
  createVault,
  hiddenName,
  seal,
  unlockVault,
  unseal,
} from "./crypto.js";
import type { SyncStore } from "./store.js";

const ROOT = "kenning";
export const VAULT_PATH = `${ROOT}/vault.json`;
const DEVICES = `${ROOT}/devices`;
const BLOBS = `${ROOT}/blobs`;
/** Events per segment file. */
const SEGMENT_EVENTS = 2000;
/** A device's segment files are folded into one base file past this many. */
const FOLD_AFTER = 40;
const SEGMENT = /^([0-9A-HJKMNP-TV-Z]{26})(\.base)?\.kev$/;

interface SegmentFile {
  format: 1;
  device: string;
  events: SyncEvent[];
}

/** A device that syncs to this place. */
export interface SyncDevice {
  id: string;
  name: string;
  /** Its last sync (ms). */
  at: number;
  /** This device. */
  self: boolean;
}

/** Bookkeeping kept on this device only (`repo.syncState`). */
interface SyncState {
  /** The vault this state belongs to (its salt): another vault starts over. */
  vault: string;
  /** Last own event id sent. */
  sent?: string;
  /** Last event id imported, per other device. */
  received: Record<string, string>;
  /** Blobs the events referred to that were not in the place yet. */
  missing?: string[];
}

export interface SyncSummary {
  sent: number;
  received: number;
  /** The log was replayed because some events were older than its end. */
  rebuilt: boolean;
  devices: SyncDevice[];
}

export interface SyncOptions {
  /** This device's name, shown on the others ("Laptop", "Phone"). */
  deviceName: string;
  now?: () => number;
  onProgress?: (message: string) => void;
  /** Events per segment file (default 2000). */
  segmentEvents?: number;
  /** Fold this device's files past this many (default 40). */
  foldAfter?: number;
}

/** The place holds no Kenning data (yet). */
export class NoVaultError extends Error {
  override readonly name = "NoVaultError";
  constructor() {
    super("There is no Kenning data here yet.");
  }
}

const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const decode = <T>(b: Uint8Array): T => JSON.parse(new TextDecoder().decode(b)) as T;
const deviceDir = (id: string) => `${DEVICES}/${id}`;

export async function readVault(store: SyncStore): Promise<VaultFile | null> {
  const bytes = await store.get(VAULT_PATH);
  return bytes ? decode<VaultFile>(bytes) : null;
}

/**
 * The key for a place: unlock its vault with the passphrase, or, with `create`, make a new vault
 * when the place has none.
 */
export async function openVault(
  store: SyncStore,
  passphrase: string,
  create: boolean,
  iterations?: number,
): Promise<SyncKey> {
  const vault = await readVault(store);
  if (vault) return unlockVault(vault, passphrase);
  if (!create) throw new NoVaultError();
  const made = await createVault(passphrase, iterations);
  await store.put(VAULT_PATH, encode(made.vault));
  return made.key;
}

/** Blob ids an event refers to (a text's cover, the media of imported cards). */
export function blobRefs(e: AppEvent): string[] {
  if (e.type === "TextCoverSet") return e.blobId ? [e.blobId] : [];
  if (e.type === "NativeNotesAdded") return Object.values(e.media ?? {});
  return [];
}

async function pack(key: SyncKey, file: SegmentFile): Promise<Uint8Array> {
  return seal(key, gzipSync(encode(file), { level: 6 }));
}

async function unpack(key: SyncKey, bytes: Uint8Array): Promise<SegmentFile> {
  return decode<SegmentFile>(gunzipSync(await unseal(key, bytes)));
}

async function packBlob(key: SyncKey, type: string, bytes: Uint8Array): Promise<Uint8Array> {
  const head = new TextEncoder().encode(type);
  const plain = new Uint8Array(2 + head.length + bytes.length);
  plain[0] = head.length >> 8;
  plain[1] = head.length & 0xff;
  plain.set(head, 2);
  plain.set(bytes, 2 + head.length);
  return seal(key, plain);
}

async function unpackBlob(
  key: SyncKey,
  sealed: Uint8Array,
): Promise<{ type: string; bytes: Uint8Array }> {
  const plain = await unseal(key, sealed);
  const n = (plain[0]! << 8) + plain[1]!;
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

function segments(names: string[]): Segment[] {
  return names
    .flatMap((name) => {
      const m = SEGMENT.exec(name);
      return m ? [{ name, lastId: m[1]!, base: !!m[2] }] : [];
    })
    .sort((a, b) => (a.lastId < b.lastId ? -1 : a.lastId > b.lastId ? 1 : a.base ? -1 : 1));
}

/**
 * The files of another device still to import after `cursor`: the newest base file that goes
 * past it (it holds everything up to its last id), then the segments after it.
 */
export function toImport(names: string[], cursor: string): string[] {
  const after = segments(names).filter((s) => s.lastId > cursor);
  const bases = after.filter((s) => s.base);
  const base = bases[bases.length - 1];
  const rest = after.filter((s) => !s.base && (!base || s.lastId > base.lastId));
  return [...(base ? [base] : []), ...rest].map((s) => s.name);
}

/** Every device of the place, with its name and last sync. */
export async function listDevices(
  store: SyncStore,
  key: SyncKey,
  self: string,
): Promise<SyncDevice[]> {
  const out: SyncDevice[] = [];
  for (const id of await store.list(DEVICES)) {
    const bytes = await store.get(`${deviceDir(id)}/device.kev`);
    let info = { name: "A device", at: 0 };
    if (bytes) {
      try {
        info = decode<{ name: string; at: number }>(await unseal(key, bytes));
      } catch {
        // Unreadable: listed without a name.
      }
    }
    out.push({ id, name: info.name, at: info.at, self: id === self });
  }
  return out.sort((a, b) => Number(b.self) - Number(a.self) || b.at - a.at);
}

/** One sync: send what is new here, then bring in what is new elsewhere. */
export async function syncOnce(
  repo: KenningRepository,
  store: SyncStore,
  key: SyncKey,
  opts: SyncOptions,
): Promise<SyncSummary> {
  const now = opts.now ?? Date.now;
  const progress = opts.onProgress ?? (() => undefined);
  const vault = await readVault(store);
  if (!vault)
    throw new Error("The sync place no longer holds your Kenning data. Set up sync again.");
  await checkKey(vault, key);
  const saved = (await repo.syncState()) as SyncState | null;
  const state: SyncState =
    saved && saved.vault === vault.kdf.salt ? saved : { vault: vault.kdf.salt, received: {} };
  const me = repo.deviceId;

  // Send: blobs first, so a device that reads a segment finds what it refers to.
  const remoteBlobs = new Set(await store.list(BLOBS));
  let sent = 0;
  for (;;) {
    const events = await repo.exportEvents(state.sent, opts.segmentEvents ?? SEGMENT_EVENTS);
    if (events.length === 0) break;
    progress(`Sending ${sent + events.length} changes`);
    for (const id of new Set(events.flatMap((e) => blobRefs(e.event)))) {
      const name = `${await hiddenName(key, id)}.kbl`;
      if (remoteBlobs.has(name)) continue;
      const blob = await repo.getBlob(id);
      if (!blob) continue;
      await store.put(`${BLOBS}/${name}`, await packBlob(key, blob.type, blob.bytes));
      remoteBlobs.add(name);
    }
    const last = events[events.length - 1]!.id;
    await store.put(
      `${deviceDir(me)}/${last}.kev`,
      await pack(key, { format: 1, device: me, events }),
    );
    state.sent = last;
    sent += events.length;
    await repo.setSyncState(state);
  }
  await store.put(
    `${deviceDir(me)}/device.kev`,
    await seal(key, encode({ name: opts.deviceName, at: now() })),
  );

  // Receive.
  let received = 0;
  let rebuilt = false;
  const missing = new Set(state.missing ?? []);
  for (const dev of await store.list(DEVICES)) {
    if (dev === me) continue;
    const files = toImport(await store.list(deviceDir(dev)), state.received[dev] ?? "");
    for (const name of files) {
      const bytes = await store.get(`${deviceDir(dev)}/${name}`);
      // Folded away since the listing: the base file comes next time.
      if (!bytes) break;
      const file = await unpack(key, bytes);
      if (file.device !== dev) continue;
      progress(`Receiving ${received + file.events.length} changes`);
      for (const e of file.events) for (const id of blobRefs(e.event)) missing.add(id);
      const r = await repo.importEvents(file.events);
      received += r.added;
      rebuilt ||= r.rebuilt;
      state.received[dev] = SEGMENT.exec(name)![1]!;
      await repo.setSyncState(state);
    }
  }
  for (const id of [...missing]) {
    if (await repo.getBlob(id)) {
      missing.delete(id);
      continue;
    }
    const bytes = await store.get(`${BLOBS}/${await hiddenName(key, id)}.kbl`);
    if (!bytes) continue;
    const blob = await unpackBlob(key, bytes);
    try {
      if ((await repo.putBlob(blob.bytes, blob.type)) === id) missing.delete(id);
    } catch {
      // Not a kind of file this device keeps: left out.
      missing.delete(id);
    }
  }
  state.missing = [...missing];
  await repo.setSyncState(state);

  await foldOwn(repo, store, key, progress, opts.foldAfter ?? FOLD_AFTER);
  return { sent, received, rebuilt, devices: await listDevices(store, key, me) };
}

/**
 * Past `FOLD_AFTER` segment files, this device's files become one base file (after compacting
 * the log), and the older files go. Devices that already have those events skip them.
 */
async function foldOwn(
  repo: KenningRepository,
  store: SyncStore,
  key: SyncKey,
  progress: (m: string) => void,
  foldAfter: number,
): Promise<void> {
  const me = repo.deviceId;
  const own = segments(await store.list(deviceDir(me)));
  if (own.length <= foldAfter) return;
  progress("Tidying up the synced files");
  await repo.compact();
  const events: SyncEvent[] = [];
  for (let after: string | undefined; ;) {
    const page = await repo.exportEvents(after, 10_000);
    if (page.length === 0) break;
    events.push(...page);
    after = page[page.length - 1]!.id;
  }
  const last = events[events.length - 1]?.id;
  if (!last) return;
  const name = `${last}.base.kev`;
  await store.put(`${deviceDir(me)}/${name}`, await pack(key, { format: 1, device: me, events }));
  for (const s of own)
    if (s.lastId <= last && s.name !== name) await store.remove(`${deviceDir(me)}/${s.name}`);
}
