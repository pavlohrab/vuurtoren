/**
 * ID and clock helpers (pure, no I/O): ULIDs for event ids and a hybrid logical clock (HLC)
 * for cross-device ordering of mutable fields.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

/** Source of random bytes; defaults to Web Crypto (available in browsers and Node). */
export type RandomBytes = (n: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** Encode a millisecond timestamp as 10 Crockford base32 chars (48 bits). */
function encodeTime(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 2 ** 48 - 1) {
    throw new RangeError(`ULID timestamp out of range: ${ms}`);
  }
  let out = "";
  let rest = ms;
  for (let i = 0; i < TIME_LEN; i++) {
    out = CROCKFORD[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** Random part as an array of 16 base32 digit values (0-31). */
function randomDigits(random: RandomBytes): number[] {
  return Array.from(random(RANDOM_LEN), (b) => b % 32);
}

/** Increment a base32 digit array in place (big-endian); throws on overflow. */
function incrementDigits(d: number[]): void {
  for (let i = d.length - 1; i >= 0; i--) {
    const v = d[i] ?? 0;
    if (v < 31) {
      d[i] = v + 1;
      return;
    }
    d[i] = 0;
  }
  throw new Error("ULID random part overflow");
}

/**
 * Create a monotonic ULID generator. IDs from one generator are strictly increasing, even
 * within one millisecond (random part is incremented) or if the clock goes backwards
 * (the last timestamp is reused). Lexicographic order equals generation order.
 * `after` seeds the generator with an existing id so new ids sort after it.
 *
 * @example const next = createUlidGenerator(); next() // "01J..."
 */
export function createUlidGenerator(
  now: () => number = Date.now,
  random: RandomBytes = defaultRandomBytes,
  after?: string,
): () => string {
  let lastMs = -1;
  let digits: number[] = [];
  if (after) {
    // Resume after a persisted id: every new id sorts after it.
    lastMs = ulidTime(after);
    digits = Array.from(after.slice(TIME_LEN), (ch) => CROCKFORD.indexOf(ch));
    if (digits.length !== RANDOM_LEN || digits.includes(-1))
      throw new Error(`Invalid ULID: ${after}`);
  }
  return () => {
    const ms = now();
    if (ms > lastMs) {
      lastMs = ms;
      digits = randomDigits(random);
    } else {
      incrementDigits(digits);
    }
    return encodeTime(lastMs) + digits.map((v) => CROCKFORD[v]).join("");
  };
}

/** Parse the timestamp (ms) out of a ULID. */
export function ulidTime(id: string): number {
  let ms = 0;
  for (const ch of id.slice(0, TIME_LEN)) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) throw new Error(`Invalid ULID: ${id}`);
    ms = ms * 32 + v;
  }
  return ms;
}

/** Random device id (12 hex chars; contains no "-" so HLC strings parse unambiguously). */
export function randomDeviceId(random: RandomBytes = defaultRandomBytes): string {
  return Array.from(random(6), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------------------
// Hybrid logical clock
// ---------------------------------------------------------------------------------------

export interface HlcParts {
  ms: number;
  counter: number;
  deviceId: string;
}

/**
 * Format an HLC as "<ms>-<counter>-<deviceId>". ms and counter are zero-padded (15 / 5
 * digits) so plain string comparison also orders correctly.
 */
export function formatHlc(p: HlcParts): string {
  return `${String(p.ms).padStart(15, "0")}-${String(p.counter).padStart(5, "0")}-${p.deviceId}`;
}

/** Parse an HLC string. Throws on malformed input. */
export function parseHlc(hlc: string): HlcParts {
  const m = /^(\d+)-(\d+)-(.+)$/.exec(hlc);
  if (!m) throw new Error(`Invalid HLC: ${hlc}`);
  return { ms: Number(m[1]), counter: Number(m[2]), deviceId: m[3] as string };
}

/** Total order on HLC strings: by ms, then counter, then device id. Negative if a < b. */
export function compareHlc(a: string, b: string): number {
  const x = parseHlc(a);
  const y = parseHlc(b);
  if (x.ms !== y.ms) return x.ms - y.ms;
  if (x.counter !== y.counter) return x.counter - y.counter;
  return x.deviceId < y.deviceId ? -1 : x.deviceId > y.deviceId ? 1 : 0;
}

export interface Hlc {
  /** Timestamp for a local event; strictly greater than every previous tick/receive. */
  tick(): string;
  /** Merge a remote HLC so later local ticks sort after it. Returns the new clock value. */
  receive(remote: string): string;
  /** Current clock value without advancing it. */
  current(): string;
}

/**
 * Create an HLC for `deviceId`. `initial` restores persisted state (e.g. the last stored
 * hlc) so the clock stays monotonic across restarts.
 */
export function createHlc(deviceId: string, now: () => number = Date.now, initial?: string): Hlc {
  let ms = 0;
  let counter = 0;
  if (initial) {
    const p = parseHlc(initial);
    ms = p.ms;
    counter = p.counter;
  }
  const value = (): string => formatHlc({ ms, counter, deviceId });
  return {
    tick() {
      const wall = now();
      if (wall > ms) {
        ms = wall;
        counter = 0;
      } else {
        counter++;
      }
      return value();
    },
    receive(remote) {
      const r = parseHlc(remote);
      const newMs = Math.max(ms, r.ms, now());
      if (newMs === ms && newMs === r.ms) counter = Math.max(counter, r.counter) + 1;
      else if (newMs === ms) counter++;
      else if (newMs === r.ms) counter = r.counter + 1;
      else counter = 0;
      ms = newMs;
      return value();
    },
    current: value,
  };
}
