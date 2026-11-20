/**
 * Per-device API key storage. Keys NEVER enter the event log, the database, backups or sync:
 * they live in the browser's localStorage, optionally encrypted with a
 * passphrase (PBKDF2 -> AES-GCM via WebCrypto). Without a passphrase the key is stored as plain
 * text, which protects nothing against someone with access to the browser profile.
 */

/** The subset of the Web Storage API used here (injectable for tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class WrongPassphraseError extends Error {
  override readonly name = "WrongPassphraseError";
  constructor() {
    super("Wrong passphrase.");
  }
}

interface Stored {
  v: 1;
  /** Present when the key is encrypted. */
  enc?: { salt: string; iv: string; ct: string };
  /** Plain key (only when not encrypted). */
  key?: string;
}

const PREFIX = "vuurtoren.ai.key.";
const PBKDF2_ITERATIONS = 250_000;

const b64 = (b: ArrayBuffer | Uint8Array): string => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function read(storage: KeyValueStorage, provider: string): Stored | null {
  try {
    const raw = storage.getItem(PREFIX + provider);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    // unreadable entry: treated as no saved key (expected; the user enters it again)
    return null;
  }
}

/** Is a key saved for this provider, and does it need a passphrase to read? */
export function keyStatus(
  storage: KeyValueStorage,
  provider: string,
): { saved: boolean; encrypted: boolean } {
  const s = read(storage, provider);
  return { saved: s !== null, encrypted: s?.enc !== undefined };
}

/** Save a key, encrypted when `passphrase` is given. Replaces any earlier key. */
export async function saveKey(
  storage: KeyValueStorage,
  provider: string,
  key: string,
  passphrase?: string,
): Promise<void> {
  if (!key) throw new Error("The key is empty.");
  let stored: Stored;
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await deriveKey(passphrase, salt);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      k,
      new TextEncoder().encode(key),
    );
    stored = { v: 1, enc: { salt: b64(salt), iv: b64(iv), ct: b64(ct) } };
  } else {
    stored = { v: 1, key };
  }
  storage.setItem(PREFIX + provider, JSON.stringify(stored));
}

/**
 * Read the key. Returns undefined when none is saved.
 * @throws WrongPassphraseError when it is encrypted and the passphrase is missing or wrong
 */
export async function loadKey(
  storage: KeyValueStorage,
  provider: string,
  passphrase?: string,
): Promise<string | undefined> {
  const s = read(storage, provider);
  if (!s) return undefined;
  if (!s.enc) return s.key;
  if (!passphrase) throw new WrongPassphraseError();
  try {
    const k = await deriveKey(passphrase, unb64(s.enc.salt));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(s.enc.iv) },
      k,
      unb64(s.enc.ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new WrongPassphraseError();
  }
}

/** Forget the saved key of a provider. */
export function clearKey(storage: KeyValueStorage, provider: string): void {
  storage.removeItem(PREFIX + provider);
}
