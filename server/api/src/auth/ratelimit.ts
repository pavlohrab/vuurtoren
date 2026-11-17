/**
 * Brute-force protection for sign-in (in memory; a restart forgets it).
 *
 * - Per client IP: the first `freeFailures` mistakes cost nothing, after that each failure
 *   doubles a waiting period (1 s, 2 s, 4 s, ... up to `maxDelayMs`). A success clears it.
 * - Globally: at most `globalMax` failures per `globalWindowMs` across all IPs, which caps a
 *   distributed guessing attack. The price is that such an attack can lock the owner out
 *   for one window as well; for a single-user app that is the right trade.
 */
export interface LimiterOptions {
  freeFailures?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  globalMax?: number;
  globalWindowMs?: number;
  /** Forget an IP this long after its last failure. */
  forgetAfterMs?: number;
  /** Bound on remembered IPs (oldest are dropped first). */
  maxEntries?: number;
  now?: () => number;
}

interface Entry {
  failures: number;
  blockedUntil: number;
  last: number;
}

export type LimitVerdict = { ok: true } | { ok: false; retryAfterMs: number };

export class LoginLimiter {
  private readonly ips = new Map<string, Entry>();
  private readonly recent: number[] = [];
  private readonly o: Required<Omit<LimiterOptions, "now">>;
  private readonly now: () => number;

  constructor(opts: LimiterOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.o = {
      freeFailures: opts.freeFailures ?? 3,
      baseDelayMs: opts.baseDelayMs ?? 1000,
      maxDelayMs: opts.maxDelayMs ?? 15 * 60_000,
      globalMax: opts.globalMax ?? 100,
      globalWindowMs: opts.globalWindowMs ?? 15 * 60_000,
      forgetAfterMs: opts.forgetAfterMs ?? 24 * 3600_000,
      maxEntries: opts.maxEntries ?? 10_000,
    };
  }

  /** May this IP try now? */
  check(ip: string): LimitVerdict {
    const now = this.now();
    this.pruneGlobal(now);
    if (this.recent.length >= this.o.globalMax) {
      return { ok: false, retryAfterMs: this.recent[0]! + this.o.globalWindowMs - now };
    }
    const e = this.ips.get(ip);
    if (e && e.blockedUntil > now) return { ok: false, retryAfterMs: e.blockedUntil - now };
    return { ok: true };
  }

  /** Record a failed attempt. */
  fail(ip: string): void {
    const now = this.now();
    this.recent.push(now);
    this.pruneGlobal(now);
    let e = this.ips.get(ip);
    if (!e || now - e.last > this.o.forgetAfterMs) e = { failures: 0, blockedUntil: 0, last: now };
    e.failures += 1;
    e.last = now;
    const over = e.failures - this.o.freeFailures;
    if (over > 0) {
      e.blockedUntil = now + Math.min(this.o.baseDelayMs * 2 ** (over - 1), this.o.maxDelayMs);
    }
    this.ips.delete(ip); // re-insert: Map order = least recently failed first
    this.ips.set(ip, e);
    while (this.ips.size > this.o.maxEntries) {
      this.ips.delete(this.ips.keys().next().value as string);
    }
  }

  /** A successful sign-in clears this IP's record. */
  success(ip: string): void {
    this.ips.delete(ip);
  }

  private pruneGlobal(now: number): void {
    while (this.recent.length > 0 && this.recent[0]! <= now - this.o.globalWindowMs) {
      this.recent.shift();
    }
    // Never hold more than needed to decide.
    if (this.recent.length > this.o.globalMax)
      this.recent.splice(0, this.recent.length - this.o.globalMax);
  }
}
