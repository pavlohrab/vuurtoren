/**
 * Password hashing with scrypt (node:crypto, no dependencies).
 *
 * Stored format (self-describing, safe to paste into a compose `.env`):
 *
 *   scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>
 *
 * `$` is accepted as the separator too (`scrypt$N$r$p$salt$hash`), but never produced: Docker
 * Compose interpolates `$` in `.env` files and compose YAML, which would silently corrupt a
 * pasted hash.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

export interface ScryptParams {
  /** CPU/memory cost, a power of two. */
  N: number;
  r: number;
  p: number;
}

/** OWASP-level defaults: 64 MiB and roughly 100-300 ms per hash on a small server. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 16, r: 8, p: 1 };

const KEY_LEN = 32;
const SALT_LEN = 16;

export interface PasswordHash extends ScryptParams {
  salt: Buffer;
  hash: Buffer;
}

function scrypt(
  password: string,
  salt: Buffer,
  params: ScryptParams,
  keyLen: number = KEY_LEN,
): Promise<Buffer> {
  const opts: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    // scrypt needs 128 * N * r bytes; allow that plus headroom.
    maxmem: 128 * params.N * params.r * 2 + 1024 * 1024,
  };
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFC"), salt, keyLen, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Hash a password into the stored string form. */
export function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<string> {
  return hashPasswordWithSalt(password, randomBytes(SALT_LEN), params);
}

/** Like `hashPassword` with a given salt (for a stable hash of a configured plain password). */
export async function hashPasswordWithSalt(
  password: string,
  salt: Buffer,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<string> {
  const hash = await scrypt(password, salt, params);
  return [
    "scrypt",
    params.N,
    params.r,
    params.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(":");
}

/**
 * Parse a stored hash. Throws a readable error for anything malformed (a wrong value in the
 * environment must stop the server, not silently disable sign-in).
 */
export function parsePasswordHash(stored: string): PasswordHash {
  const parts = stored.trim().split(/[:$]/);
  if (parts[0] === "" && parts.length === 7) parts.shift(); // "$scrypt$..." (leading separator)
  const [alg, n, r, p, salt, hash] = parts;
  const bad = (why: string): never => {
    throw new Error(`KENNING_PASSWORD_HASH is not a valid scrypt hash (${why}).`);
  };
  if (parts.length !== 6 || alg !== "scrypt") bad("expected scrypt:N:r:p:salt:hash");
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || N < 2 ** 10 || N > 2 ** 20 || (N & (N - 1)) !== 0) {
    bad("N must be a power of two between 2^10 and 2^20");
  }
  if (!Number.isInteger(R) || R < 1 || R > 32) bad("r out of range");
  if (!Number.isInteger(P) || P < 1 || P > 16) bad("p out of range");
  const b64 = /^[A-Za-z0-9_\-+/]+=*$/;
  if (!b64.test(salt ?? "") || !b64.test(hash ?? "")) bad("salt or hash is not base64");
  const saltBuf = Buffer.from(salt!, "base64url");
  const hashBuf = Buffer.from(hash!, "base64url");
  if (saltBuf.length < 8 || hashBuf.length < 16 || hashBuf.length > 128)
    bad("bad salt or hash length");
  return { N, r: R, p: P, salt: saltBuf, hash: hashBuf };
}

/** Check a password against a parsed hash in constant time (for equal-length keys). */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  // Derive exactly as many bytes as were stored, so the comparison is always length-equal.
  const key = await scrypt(password, stored.salt, stored, stored.hash.length);
  return timingSafeEqual(key, stored.hash);
}
