/**
 * Sync tokens: what a device that keeps its own data sends to `/api/sync` (Settings → Sync).
 * A token opens `/api/sync` and nothing else; it is not a sign-in for the app.
 *
 * Stored next to the sessions in the auth database. Only the SHA-256 of a token is kept: the
 * token is shown once, when made.
 *
 * A sync token belongs to one device: the first device folder it writes to becomes its own
 * (`device`), and it may write only there and to the shared images. It may replace vault.json
 * (a passphrase change, a new recovery key) only when it made that vault or was made with
 * `vault` allowed.
 */
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface TokenInfo {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** The device folder the token writes to, once it has written one. */
  device: string | null;
  /** The token may replace vault.json. */
  vault: boolean;
}

/** Tokens look like `ksync_<43 base64url chars>`. */
const PREFIX = "ksync_";
const PATTERN = /^ksync_[A-Za-z0-9_-]{43}$/;

/** Most tokens kept at once (one per computer or phone is the expected use). */
const MAX_TOKENS = 20;

interface Row {
  id: string;
  label: string;
  created_at: number;
  last_used: number | null;
  device: string | null;
  vault: number;
}

const info = (r: Row): TokenInfo => ({
  id: r.id,
  label: r.label,
  createdAt: r.created_at,
  lastUsedAt: r.last_used,
  device: r.device,
  vault: r.vault === 1,
});

const digest = (token: string): Buffer => createHash("sha256").update(token).digest();

export class TokenStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  /** Write last_used at most this often per token. */
  private readonly touchEveryMs = 60_000;

  constructor(path: string, now: () => number = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS sync_tokens (
        id         TEXT PRIMARY KEY,
        token_hash BLOB NOT NULL UNIQUE,
        label      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used  INTEGER,
        device     TEXT,
        vault      INTEGER NOT NULL DEFAULT 0
      );
    `);
    // A table without the device columns: its tokens get a device at their next write.
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(sync_tokens)").all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!columns.has("device")) this.db.exec("ALTER TABLE sync_tokens ADD COLUMN device TEXT");
    if (!columns.has("vault")) {
      this.db.exec("ALTER TABLE sync_tokens ADD COLUMN vault INTEGER NOT NULL DEFAULT 0");
    }
  }

  /** Make a token; the plain token is returned once and never stored. */

  create(label: string, opts: { vault?: boolean } = {}): TokenInfo & { token: string } {
    if (this.list().length >= MAX_TOKENS) {
      throw new Error(`At most ${MAX_TOKENS} sync tokens; revoke one first.`);
    }
    const token = PREFIX + randomBytes(32).toString("base64url");
    const id = randomBytes(6).toString("hex");
    const createdAt = this.now();
    const clean = label.trim().slice(0, 80) || "A device";
    const vault = opts.vault === true;
    this.db
      .prepare(
        `INSERT INTO sync_tokens (id, token_hash, label, created_at, last_used, vault) VALUES (?,?,?,?,NULL,?)`,
      )
      .run(id, digest(token), clean, createdAt, vault ? 1 : 0);
    return { id, token, label: clean, createdAt, lastUsedAt: null, device: null, vault };
  }

  list(): TokenInfo[] {
    return (
      this.db
        .prepare(
          `SELECT id, label, created_at, last_used, device, vault FROM sync_tokens ORDER BY created_at DESC`,
        )
        .all() as unknown as Row[]
    ).map(info);
  }

  /** One token's details, or null when it was revoked. */
  get(id: string): TokenInfo | null {
    const row = this.db
      .prepare(
        `SELECT id, label, created_at, last_used, device, vault FROM sync_tokens WHERE id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? info(row) : null;
  }

  /** Give a token its device, when it has none yet. True when the device is (now) its own. */
  claimDevice(id: string, device: string): boolean {
    this.db
      .prepare(`UPDATE sync_tokens SET device = ? WHERE id = ? AND device IS NULL`)
      .run(device, id);
    return this.get(id)?.device === device;
  }

  /** Let a token replace vault.json from now on (it made the vault). */
  allowVault(id: string): void {
    this.db.prepare(`UPDATE sync_tokens SET vault = 1 WHERE id = ?`).run(id);
  }

  /** True when a token with this id existed. */
  revoke(id: string): boolean {
    return (
      Number(this.db.prepare(`DELETE FROM sync_tokens WHERE id = ?`).run(id).changes) > 0
    );
  }

  /** The id of a valid token, or null. Looked up by hash, so timing reveals nothing. */
  verify(token: string): string | null {
    if (!PATTERN.test(token)) return null;
    const row = this.db
      .prepare(`SELECT id, last_used FROM sync_tokens WHERE token_hash = ?`)
      .get(digest(token)) as { id: string; last_used: number | null } | undefined;
    if (!row) return null;
    const now = this.now();
    if (row.last_used === null || now - row.last_used >= this.touchEveryMs) {
      this.db.prepare(`UPDATE sync_tokens SET last_used = ? WHERE id = ?`).run(now, row.id);
    }
    return row.id;
  }

  close(): void {
    this.db.close();
  }
}
