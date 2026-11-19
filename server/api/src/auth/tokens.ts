/**
 * Per-user tokens that open one part of the API and nothing else:
 * - MCP tokens: what Claude Code (or another MCP client) sends to `/api/mcp` (Settings → AI →
 *   Use with Claude Code);
 * - sync tokens: what a device that keeps its own data sends to `/api/sync` (Settings → Sync).
 *
 * Stored next to the sessions in the auth database (never in the user's data, so backups do
 * not carry them). Only the SHA-256 of a token is kept: the token is shown once, when made.
 * No token is a sign-in for the app or `/api/rpc`.
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
  /** The device folder a sync token writes to, once it has written one. */
  device: string | null;
  /** A sync token that may replace vault.json. */
  vault: boolean;
}

/** What a kind of token is called, and how its tokens look (`<prefix><43 base64url chars>`). */
interface TokenKind {
  table: string;
  prefix: string;
  /** Label when none is given. */
  label: string;
  /** Name in messages ("MCP tokens"). */
  name: string;
}

export const MCP_TOKENS: TokenKind = {
  table: "mcp_tokens",
  prefix: "kmcp_",
  label: "Claude Code",
  name: "MCP tokens",
};
export const SYNC_TOKENS: TokenKind = {
  table: "sync_tokens",
  prefix: "ksync_",
  label: "A device",
  name: "sync tokens",
};

/** Most tokens of a kind kept at once (one per computer or phone is the expected use). */
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
  private readonly kind: TokenKind;
  private readonly pattern: RegExp;
  /** Write last_used at most this often per token. */
  private readonly touchEveryMs = 60_000;

  constructor(path: string, kind: TokenKind = MCP_TOKENS, now: () => number = Date.now) {
    this.now = now;
    this.kind = kind;
    this.pattern = new RegExp(`^${kind.prefix}[A-Za-z0-9_-]{43}$`);
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS ${kind.table} (
        id         TEXT PRIMARY KEY,
        token_hash BLOB NOT NULL UNIQUE,
        label      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used  INTEGER
      );
    `);
    // Tokens made before tokens had a device: they get one at their next write.
    const columns = new Set(
      (this.db.prepare(`PRAGMA table_info(${kind.table})`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!columns.has("device")) this.db.exec(`ALTER TABLE ${kind.table} ADD COLUMN device TEXT`);
    if (!columns.has("vault")) {
      this.db.exec(`ALTER TABLE ${kind.table} ADD COLUMN vault INTEGER NOT NULL DEFAULT 0`);
    }
  }

  /** Make a token; the plain token is returned once and never stored. */
  create(label: string, opts: { vault?: boolean } = {}): TokenInfo & { token: string } {
    if (this.list().length >= MAX_TOKENS) {
      throw new Error(`At most ${MAX_TOKENS} ${this.kind.name}; revoke one first.`);
    }
    const token = this.kind.prefix + randomBytes(32).toString("base64url");
    const id = randomBytes(6).toString("hex");
    const createdAt = this.now();
    const clean = label.trim().slice(0, 80) || this.kind.label;
    const vault = opts.vault === true;
    this.db
      .prepare(
        `INSERT INTO ${this.kind.table} (id, token_hash, label, created_at, last_used, vault) VALUES (?,?,?,?,NULL,?)`,
      )
      .run(id, digest(token), clean, createdAt, vault ? 1 : 0);
    return { id, token, label: clean, createdAt, lastUsedAt: null, device: null, vault };
  }

  list(): TokenInfo[] {
    return (
      this.db
        .prepare(
          `SELECT id, label, created_at, last_used, device, vault FROM ${this.kind.table} ORDER BY created_at DESC`,
        )
        .all() as unknown as Row[]
    ).map(info);
  }

  /** One token's details, or null when it was revoked. */
  get(id: string): TokenInfo | null {
    const row = this.db
      .prepare(
        `SELECT id, label, created_at, last_used, device, vault FROM ${this.kind.table} WHERE id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? info(row) : null;
  }

  /** Give a token its device, when it has none yet. True when the device is (now) its own. */
  claimDevice(id: string, device: string): boolean {
    this.db
      .prepare(`UPDATE ${this.kind.table} SET device = ? WHERE id = ? AND device IS NULL`)
      .run(device, id);
    return this.get(id)?.device === device;
  }

  /** Let a token replace vault.json from now on (it made the vault). */
  allowVault(id: string): void {
    this.db.prepare(`UPDATE ${this.kind.table} SET vault = 1 WHERE id = ?`).run(id);
  }

  /** True when a token with this id existed. */
  revoke(id: string): boolean {
    return (
      Number(this.db.prepare(`DELETE FROM ${this.kind.table} WHERE id = ?`).run(id).changes) > 0
    );
  }

  /** The id of a valid token, or null. Looked up by hash, so timing reveals nothing. */
  verify(token: string): string | null {
    if (!this.pattern.test(token)) return null;
    const row = this.db
      .prepare(`SELECT id, last_used FROM ${this.kind.table} WHERE token_hash = ?`)
      .get(digest(token)) as { id: string; last_used: number | null } | undefined;
    if (!row) return null;
    const now = this.now();
    if (row.last_used === null || now - row.last_used >= this.touchEveryMs) {
      this.db.prepare(`UPDATE ${this.kind.table} SET last_used = ? WHERE id = ?`).run(now, row.id);
    }
    return row.id;
  }

  close(): void {
    this.db.close();
  }
}
