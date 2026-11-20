/**
 * Sign-in sessions in their own small SQLite file (`VUURTOREN_AUTH_DB`, default
 * /data/auth.sqlite), separate from the user's data so a backup export or import never
 * contains or replaces them.
 *
 * Only the SHA-256 of a session id is stored: a leaked auth file does not let anyone sign in.
 * Lookups are by that hash, so timing differences reveal nothing about a valid id.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";

export interface SessionOptions {
  /** Inactivity timeout, renewed on use (sliding). Default 30 days. */
  idleMs?: number;
  /** Absolute lifetime from sign-in. Default 180 days. */
  maxMs?: number;
  /** Renew `expires_at` at most this often per session (limits writes). Default 5 min. */
  touchEveryMs?: number;
  now?: () => number;
}

export interface Session {
  user: string;
  createdAt: number;
  expiresAt: number;
  /** Set when this lookup extended the expiry: the cookie should be re-sent. */
  renewed: boolean;
}

/** Session ids are 32 random bytes, base64url (43 characters). */
const ID_RE = /^[A-Za-z0-9_-]{43}$/;

const digest = (id: string): Buffer => createHash("sha256").update(id).digest();

export class SessionStore {
  readonly idleMs: number;
  readonly maxMs: number;
  private readonly touchEveryMs: number;
  private readonly now: () => number;
  private readonly db: DatabaseSync;
  private readonly credentials: ReadonlySet<string>;

  /**
   * @param path SQLite file (":memory:" for tests)
   * @param credentials fingerprints of the credentials configured now; a session made with
   *   any other one (password, username or token changed) is no longer valid
   */
  constructor(path: string, credentials: readonly string[], opts: SessionOptions = {}) {
    this.credentials = new Set(credentials);
    this.idleMs = opts.idleMs ?? 30 * 86_400_000;
    this.maxMs = opts.maxMs ?? 180 * 86_400_000;
    this.touchEveryMs = opts.touchEveryMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") {
      try {
        chmodSync(path, 0o600);
      } catch {
        /* not ours to change (e.g. a read-only bind mount); keep going */
      }
    }
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id_hash    BLOB PRIMARY KEY,
        user       TEXT NOT NULL,
        credential TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);
    `);
    this.prune();
  }

  /** Start a session; returns the id to put in the cookie (never stored). */
  create(user: string, credential: string): { id: string; expiresAt: number } {
    if (!this.credentials.has(credential)) throw new Error("Unknown credential.");
    const now = this.now();
    const id = randomBytes(32).toString("base64url");
    const expiresAt = Math.min(now + this.idleMs, now + this.maxMs);
    this.db
      .prepare(
        "INSERT INTO sessions (id_hash, user, credential, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(digest(id), user, credential, now, now, expiresAt);
    this.prune();
    return { id, expiresAt };
  }

  /** Resolve a cookie value to a live session (renewing it), or null. */
  lookup(id: string | undefined): Session | null {
    if (!id || !ID_RE.test(id)) return null;
    const key = digest(id);
    const row = this.db
      .prepare(
        "SELECT user, credential, created_at, last_seen, expires_at FROM sessions WHERE id_hash = ?",
      )
      .get(key) as
      | {
          user: string;
          credential: string;
          created_at: number;
          last_seen: number;
          expires_at: number;
        }
      | undefined;
    if (!row) return null;
    const now = this.now();
    if (row.expires_at <= now || !this.credentials.has(row.credential)) {
      this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(key);
      return null;
    }
    if (now - row.last_seen < this.touchEveryMs) {
      return {
        user: row.user,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        renewed: false,
      };
    }
    const expiresAt = Math.min(now + this.idleMs, row.created_at + this.maxMs);
    this.db
      .prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id_hash = ?")
      .run(now, expiresAt, key);
    return { user: row.user, createdAt: row.created_at, expiresAt, renewed: true };
  }

  /** End one session (unknown ids are ignored). */
  revoke(id: string | undefined): void {
    if (!id || !ID_RE.test(id)) return;
    this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(digest(id));
  }

  /** End every session ("sign out all devices"). Returns how many were ended. */
  revokeAll(): number {
    return Number(this.db.prepare("DELETE FROM sessions").run().changes);
  }

  count(): number {
    return (this.db.prepare("SELECT count(*) AS n FROM sessions").get() as { n: number }).n;
  }

  /** Drop expired sessions and sessions from other credentials. */
  prune(): void {
    const now = this.now();
    const stale = (
      this.db.prepare("SELECT DISTINCT credential FROM sessions").all() as {
        credential: string;
      }[]
    ).filter((r) => !this.credentials.has(r.credential));
    for (const r of stale) {
      this.db.prepare("DELETE FROM sessions WHERE credential = ?").run(r.credential);
    }
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }

  close(): void {
    this.db.close();
  }
}
