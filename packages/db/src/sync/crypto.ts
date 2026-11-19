/**
 * Sync encryption. A passphrase opens the vault: PBKDF2-SHA256 turns it into 64 bytes, the first
 * half an AES-256-GCM key for every file, the second an HMAC-SHA256 key for file names that must
 * not reveal what they hold (blob ids). Every file is `KSY1` + a random 12-byte IV + ciphertext.
 * Web Crypto only: the same code runs in browsers, the desktop app and Node.
 */

const MAGIC = new TextEncoder().encode("KSY1");
const CHECK = "kenning-sync";
/** OWASP's 2023 figure for PBKDF2-HMAC-SHA256. */
export const DEFAULT_ITERATIONS = 600_000;

/** `kenning/vault.json`: how the passphrase becomes the key, and a value to check it with. */
export interface VaultFile {
  format: 1;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  /** `CHECK`, sealed with the key: opening it proves the passphrase. */
  check: string;
}

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
    new TextEncoder().encode(passphrase.normalize("NFC")),
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

export async function seal(key: SyncKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv }, key.enc, plain as BufferSource),
  );
  const out = new Uint8Array(MAGIC.length + iv.length + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ct, MAGIC.length + iv.length);
  return out;
}

export async function unseal(key: SyncKey, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < MAGIC.length + 12 + 16 || MAGIC.some((b, i) => sealed[i] !== b)) {
    throw new SealedFileError("This is not a Kenning sync file.");
  }
  const iv = sealed.slice(MAGIC.length, MAGIC.length + 12);
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv },
        key.enc,
        sealed.slice(MAGIC.length + 12) as BufferSource,
      ),
    );
  } catch {
    throw new SealedFileError("A synced file cannot be opened with this passphrase.");
  }
}

/** A new vault for a passphrase, with a random salt. */
export async function createVault(
  passphrase: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<{ vault: VaultFile; key: SyncKey }> {
  if (passphrase.trim().length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(passphrase, salt, iterations);
  const check = await seal(key, new TextEncoder().encode(CHECK));
  return {
    vault: {
      format: 1,
      kdf: { name: "PBKDF2-SHA256", iterations, salt: toBase64(salt) },
      check: toBase64(check),
    },
    key,
  };
}

/** The key of a vault, or WrongPassphraseError. */
export async function unlockVault(vault: VaultFile, passphrase: string): Promise<SyncKey> {
  if (vault.format !== 1 || vault.kdf?.name !== "PBKDF2-SHA256") {
    throw new Error("This sync data was made by a newer Kenning. Update Kenning to use it.");
  }
  const key = await derive(passphrase, fromBase64(vault.kdf.salt), vault.kdf.iterations);
  await checkKey(vault, key);
  return key;
}

/** Reject a remembered key that no longer opens the vault (the passphrase was changed). */
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
