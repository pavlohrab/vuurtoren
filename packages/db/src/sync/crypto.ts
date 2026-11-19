/**
 * Sync encryption. A random data key (64 bytes) seals every file: its first half is an
 * AES-256-GCM key, its second an HMAC-SHA256 key for file names that must not reveal what they
 * hold (blob ids). A file is `KSY2` + a random 12-byte IV + ciphertext, sealed with its own
 * path as additional data: a copy under another name does not open. Files of the first format
 * (`KSY1`, no path) still open.
 *
 * The vault (`kenning/vault.json`) holds the data key under locks: one opened by your
 * passphrase (Argon2id), one by a recovery key (160 random bits, HKDF). Changing the passphrase
 * re-locks the data key; no file changes and other devices keep their key. A vault of the first
 * format derived the key from the passphrase with PBKDF2; it still opens, and changing its
 * passphrase turns it into the current format with that key as its data key.
 */
import { argon2id } from "hash-wasm";

const MAGIC = new TextEncoder().encode("KSY1");
/** Sealed with the file's path as additional data. */
const MAGIC_PATH = new TextEncoder().encode("KSY2");
const CHECK = "kenning-sync";
/** What a vault may ask of this device: more is refused (a damaged or hostile vault.json). */
const MAX_ARGON2_KIB = 1_048_576;
const MAX_ARGON2_PASSES = 10;
const MAX_ARGON2_LANES = 16;
const MAX_PBKDF2_ROUNDS = 10_000_000;
/** PBKDF2 rounds of first-format vaults (OWASP's 2023 figure for PBKDF2-HMAC-SHA256). */
export const DEFAULT_ITERATIONS = 600_000;
/** Argon2id cost: 64 MiB, 3 passes, one lane (above OWASP's minimum of 19 MiB, 2 passes). */
export const ARGON2_COST = { memoryKiB: 65_536, iterations: 3, parallelism: 1 } as const;
export type Argon2Cost = { memoryKiB: number; iterations: number; parallelism: number };

type Pbkdf2 = { name: "PBKDF2-SHA256"; iterations: number; salt: string };
type Argon2 = { name: "argon2id"; salt: string } & Argon2Cost;
type Hkdf = { name: "HKDF-SHA256"; salt: string };

/** A copy of the data key, sealed with a key made from a secret. */
interface Lock {
  kind: "passphrase" | "recovery";
  kdf: Argon2 | Hkdf;
  /** The data key, sealed. */
  sealed: string;
}

/** `kenning/vault.json`. */
export type VaultFile =
  | {
      /** First format: the key is the passphrase's PBKDF2 output. */
      format: 1;
      kdf: Pbkdf2;
      /** `CHECK`, sealed with the key: opening it proves the key. */
      check: string;
    }
  | {
      format: 2;
      /** Stays the same across passphrase changes (devices keep their sync state). */
      id: string;
      check: string;
      locks: Lock[];
    };

/** What identifies a vault for a device's sync state. */
export const vaultId = (v: VaultFile): string => (v.format === 1 ? v.kdf.salt : v.id);

export interface SyncKey {
  enc: CryptoKey;
  mac: CryptoKey;
  /** The 64 key bytes, to remember on this device instead of the passphrase. */
  raw: Uint8Array;
}

/** The passphrase does not open this vault. */
export class WrongPassphraseError extends Error {
  override readonly name = "WrongPassphraseError";
  constructor() {
    super("This passphrase does not open your synced data.");
  }
}

/** A file in the sync place cannot be opened with this key (damaged, or another vault). */
export class SealedFileError extends Error {
  override readonly name = "SealedFileError";
}

const subtle = () => globalThis.crypto.subtle;

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The key from its 64 bytes (`SyncKey.raw`). */
export async function keyFromRaw(raw: Uint8Array): Promise<SyncKey> {
  if (raw.length !== 64) throw new Error("A sync key has 64 bytes.");
  const bytes = raw.slice();
  const [enc, mac] = await Promise.all([
    subtle().importKey("raw", bytes.slice(0, 32), { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]),
    subtle().importKey("raw", bytes.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
  ]);
  return { enc, mac, raw: bytes };
}

async function derive(passphrase: string, salt: Uint8Array, iterations: number): Promise<SyncKey> {
  const base = await subtle().importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    512,
  );
  return keyFromRaw(new Uint8Array(bits));
}

/**
 * Seal `plain` with the data key. With `path`, the file is bound to it (`KSY2`): opened under
 * any other path it is refused. Without, it is a value inside a file (`KSY1`), as in vault.json.
 */
export async function seal(key: SyncKey, plain: Uint8Array, path?: string): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const params: AesGcmParams = { name: "AES-GCM", iv };
  if (path !== undefined) params.additionalData = new TextEncoder().encode(path);
  const ct = new Uint8Array(await subtle().encrypt(params, key.enc, plain as BufferSource));
  const magic = path !== undefined ? MAGIC_PATH : MAGIC;
  const out = new Uint8Array(magic.length + iv.length + ct.length);
  out.set(magic, 0);
  out.set(iv, magic.length);
  out.set(ct, magic.length + iv.length);
  return out;
}

const starts = (bytes: Uint8Array, magic: Uint8Array) => magic.every((b, i) => bytes[i] === b);

/**
 * Open a sealed file. A file bound to a path (`KSY2`) opens only under that `path`; one of the
 * first format opens anywhere.
 */
export async function unseal(key: SyncKey, sealed: Uint8Array, path?: string): Promise<Uint8Array> {
  const bound = starts(sealed, MAGIC_PATH);
  if (sealed.length < MAGIC.length + 12 + 16 || (!bound && !starts(sealed, MAGIC))) {
    throw new SealedFileError("This is not a Kenning sync file.");
  }
  const params: AesGcmParams = {
    name: "AES-GCM",
    iv: sealed.slice(MAGIC.length, MAGIC.length + 12),
  };
  if (bound) params.additionalData = new TextEncoder().encode(path ?? "");
  try {
    return new Uint8Array(
      await subtle().decrypt(params, key.enc, sealed.slice(MAGIC.length + 12) as BufferSource),
    );
  } catch {
    throw new SealedFileError(
      bound
        ? "A synced file cannot be opened with this key, or was moved from where it was written."
        : "A synced file cannot be opened with this passphrase.",
    );
  }
}

const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A recovery key as people write it down: 32 letters and digits in groups of four. */
function formatRecovery(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

/** The 20 bytes of a recovery key, or null when `text` is not one (any case, dashes, spaces). */
export function parseRecovery(text: string): Uint8Array | null {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[OI L]/g, (c) => (c === "O" ? "0" : "1"));
  if (!/^[0-9A-HJKMNP-TV-Z]{32}$/.test(clean)) return null;
  const out = new Uint8Array(20);
  let bits = 0;
  let value = 0;
  let i = 0;
  for (const ch of clean) {
    value = (value << 5) | CROCKFORD.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
}

/** The vault asks for more work than any Kenning sets, or is not a vault: it is not used. */
class DamagedVaultError extends Error {
  override readonly name = "DamagedVaultError";
  constructor() {
    super("The sync place holds a vault.json Kenning cannot use. It may be damaged.");
  }
}

const int = (n: unknown, min: number, max: number) =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
const base64ish = (s: unknown) =>
  typeof s === "string" && s.length > 0 && s.length < 4096 && /^[A-Za-z0-9+/=]+$/.test(s);

function checkKdf(kdf: unknown): kdf is Argon2 | Hkdf | Pbkdf2 {
  if (!kdf || typeof kdf !== "object") return false;
  const k = kdf as Record<string, unknown>;
  if (!base64ish(k["salt"])) return false;
  if (k["name"] === "argon2id") {
    return (
      int(k["memoryKiB"], 8, MAX_ARGON2_KIB) &&
      int(k["iterations"], 1, MAX_ARGON2_PASSES) &&
      int(k["parallelism"], 1, MAX_ARGON2_LANES)
    );
  }
  if (k["name"] === "PBKDF2-SHA256") return int(k["iterations"], 1, MAX_PBKDF2_ROUNDS);
  return k["name"] === "HKDF-SHA256";
}

/**
 * `kenning/vault.json` read from the place, checked before anything uses it: its shape, and
 * key derivation within bounds (Argon2id at most 1 GiB and 10 passes, PBKDF2 at most 10
 * million rounds), so a damaged or hostile file cannot make a device run out of memory.
 */
export function parseVault(bytes: Uint8Array): VaultFile {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    throw new DamagedVaultError();
  }
  if (!v || typeof v !== "object") throw new DamagedVaultError();
  if (typeof v["format"] === "number" && v["format"] > 2) {
    throw new Error("This sync data was made by a newer Kenning. Update Kenning to use it.");
  }
  if (!base64ish(v["check"])) throw new DamagedVaultError();
  if (v["format"] === 1) {
    const kdf = v["kdf"] as { name?: unknown } | undefined;
    if (!checkKdf(kdf) || kdf.name !== "PBKDF2-SHA256") throw new DamagedVaultError();
    return v as unknown as VaultFile;
  }
  if (v["format"] !== 2 || typeof v["id"] !== "string" || !Array.isArray(v["locks"])) {
    throw new DamagedVaultError();
  }
  const locks = v["locks"] as unknown[];
  if (locks.length > 8) throw new DamagedVaultError();
  for (const l of locks) {
    const lock = l as Partial<Lock> | null;
    const ok =
      !!lock &&
      (lock.kind === "passphrase" || lock.kind === "recovery") &&
      base64ish(lock.sealed) &&
      checkKdf(lock.kdf) &&
      lock.kdf.name === (lock.kind === "passphrase" ? "argon2id" : "HKDF-SHA256");
    if (!ok) throw new DamagedVaultError();
  }
  return v as unknown as VaultFile;
}

/** The 64 bytes a secret opens: Argon2id for a passphrase, HKDF for a recovery key. */
async function lockKey(secret: string | Uint8Array, kdf: Argon2 | Hkdf | Pbkdf2): Promise<SyncKey> {
  // Checked again here: a vault built in memory never skips the bounds.
  if (!checkKdf(kdf)) throw new DamagedVaultError();
  const salt = fromBase64(kdf.salt);
  if (kdf.name === "argon2id") {
    const out = await argon2id({
      password: secret as string,
      salt,
      parallelism: kdf.parallelism,
      iterations: kdf.iterations,
      memorySize: kdf.memoryKiB,
      hashLength: 64,
      outputType: "binary",
    });
    return keyFromRaw(out);
  }
  if (kdf.name === "HKDF-SHA256") {
    const base = await subtle().importKey("raw", secret as BufferSource, "HKDF", false, [
      "deriveBits",
    ]);
    const bits = await subtle().deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: salt as BufferSource,
        info: new TextEncoder().encode("kenning recovery key"),
      },
      base,
      512,
    );
    return keyFromRaw(new Uint8Array(bits));
  }
  return derive(secret as string, salt, kdf.iterations);
}

async function makeLock(
  kind: Lock["kind"],
  secret: string | Uint8Array,
  dataKey: SyncKey,
  cost: Argon2Cost,
): Promise<Lock> {
  const salt = toBase64(random(16));
  const kdf: Argon2 | Hkdf =
    kind === "passphrase" ? { name: "argon2id", salt, ...cost } : { name: "HKDF-SHA256", salt };
  const key = await lockKey(secret, kdf);
  return { kind, kdf, sealed: toBase64(await seal(key, dataKey.raw)) };
}

/** A passphrase as it is locked: NFC, without spaces around it. */
const tidy = (p: string) => p.normalize("NFC").trim();

/**
 * The forms of a typed passphrase to try: tidied first, then as typed (NFC), which is how
 * locks were made before passphrases were tidied.
 */
const passphraseForms = (p: string) => [...new Set([tidy(p), p.normalize("NFC")])];

/** A new passphrase: long enough, and not something that reads as a recovery key. */
const checkPassphrase = (p: string): string => {
  const t = tidy(p);
  if (t.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  if (parseRecovery(t)) {
    throw new Error(
      "This passphrase reads like a recovery key. Choose words of your own, so the two never mix.",
    );
  }
  return t;
};

/** A new vault: a random data key, locked by the passphrase and by a new recovery key. */
export async function createVault(
  passphrase: string,
  cost: Argon2Cost = ARGON2_COST,
): Promise<{ vault: VaultFile; key: SyncKey; recoveryKey: string }> {
  const tidied = checkPassphrase(passphrase);
  const key = await keyFromRaw(random(64));
  const recovery = random(20);
  return {
    vault: {
      format: 2,
      id: toBase64(random(16)),
      check: toBase64(await seal(key, new TextEncoder().encode(CHECK))),
      locks: [
        await makeLock("passphrase", tidied, key, cost),
        await makeLock("recovery", recovery, key, cost),
      ],
    },
    key,
    recoveryKey: formatRecovery(recovery),
  };
}

/** The data key of a vault from the passphrase or a recovery key, or WrongPassphraseError. */
export async function unlockVault(vault: VaultFile, secret: string): Promise<SyncKey> {
  if (vault.format === 1 && vault.kdf?.name === "PBKDF2-SHA256") {
    for (const form of passphraseForms(secret)) {
      const key = await lockKey(form, vault.kdf);
      try {
        await checkKey(vault, key);
        return key;
      } catch {
        // The next form, if any.
      }
    }
    throw new WrongPassphraseError();
  }
  if (vault.format !== 2) {
    throw new Error("This sync data was made by a newer Kenning. Update Kenning to use it.");
  }
  // What reads as a recovery key tries the recovery lock first, then the passphrase lock: a
  // passphrase set before such passphrases were refused may look like one.
  const tries: [Lock["kind"], string | Uint8Array][] = [];
  const recovery = parseRecovery(secret);
  if (recovery) tries.push(["recovery", recovery]);
  for (const form of passphraseForms(secret)) tries.push(["passphrase", form]);
  for (const [kind, value] of tries) {
    const lock = vault.locks.find((l) => l.kind === kind);
    if (!lock) continue;
    let key: SyncKey;
    try {
      key = await keyFromRaw(await unseal(await lockKey(value, lock.kdf), fromBase64(lock.sealed)));
      await checkKey(vault, key);
    } catch {
      continue;
    }
    return key;
  }
  throw new WrongPassphraseError();
}

/**
 * The vault with a new passphrase for the data key `key` (which must open it). A first-format
 * vault becomes the current format; its recovery lock stays (none yet for a first-format one).
 */
export async function changePassphrase(
  vault: VaultFile,
  key: SyncKey,
  passphrase: string,
  cost: Argon2Cost = ARGON2_COST,
): Promise<VaultFile> {
  const tidied = checkPassphrase(passphrase);
  await checkKey(vault, key);
  const keep = vault.format === 2 ? vault.locks.filter((l) => l.kind !== "passphrase") : [];
  return {
    format: 2,
    id: vaultId(vault),
    check: vault.check,
    locks: [await makeLock("passphrase", tidied, key, cost), ...keep],
  };
}

/** The vault with a new recovery key (the old one stops working), and that key. */
export async function newRecoveryKey(
  vault: VaultFile,
  key: SyncKey,
  cost: Argon2Cost = ARGON2_COST,
): Promise<{ vault: VaultFile; recoveryKey: string }> {
  await checkKey(vault, key);
  if (vault.format !== 2) {
    throw new Error("Change the passphrase first: it brings this sync data to the current format.");
  }
  const recovery = random(20);
  return {
    vault: {
      ...vault,
      locks: [
        ...vault.locks.filter((l) => l.kind !== "recovery"),
        await makeLock("recovery", recovery, key, cost),
      ],
    },
    recoveryKey: formatRecovery(recovery),
  };
}

/**
 * Reject a key that does not open this vault (another vault was set up in the place). A
 * passphrase change keeps the data key, so remembered keys keep working.
 */
export async function checkKey(vault: VaultFile, key: SyncKey): Promise<void> {
  try {
    const text = new TextDecoder().decode(await unseal(key, fromBase64(vault.check)));
    if (text !== CHECK) throw new WrongPassphraseError();
  } catch {
    throw new WrongPassphraseError();
  }
}

/** A file name for a blob id that does not reveal it (hex HMAC). */
export async function hiddenName(key: SyncKey, id: string): Promise<string> {
  const sig = new Uint8Array(
    await subtle().sign("HMAC", key.mac, new TextEncoder().encode(id) as BufferSource),
  );
  return Array.from(sig.slice(0, 20), (b) => b.toString(16).padStart(2, "0")).join("");
}
