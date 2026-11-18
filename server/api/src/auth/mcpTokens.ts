/**
 * Per-user MCP tokens: what Claude Code (or another MCP client) sends to `/api/mcp`.
 * Generated and revoked in Settings → AI → Use with Claude Code.
 *
 * Stored next to the sessions in the auth database (never in the user's data, so backups do
 * not carry them). Only the SHA-256 of a token is kept: the token is shown once, when made.
 * A token only opens `/api/mcp`; it is no sign-in for the app or `/api/rpc`.
 */
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface McpTokenInfo {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Tokens look like `kmcp_<43 base64url chars>`: easy to recognise in a config file. */
const MCP_TOKEN_PREFIX = "kmcp_";
const TOKEN_RE = /^kmcp_[A-Za-z0-9_-]{43}$/;
/** Most tokens kept at once (one per computer is the expected use). */
const MAX_MCP_TOKENS = 20;

const digest = (token: string): Buffer => createHash("sha256").update(token).digest();

export class McpTokenStore {
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
      CREATE TABLE IF NOT EXISTS mcp_tokens (
        id         TEXT PRIMARY KEY,
        token_hash BLOB NOT NULL UNIQUE,
        label      TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used  INTEGER
      );
    `);
  }

  /** Make a token; the plain token is returned once and never stored. */
  create(label: string): McpTokenInfo & { token: string } {
    if (this.list().length >= MAX_MCP_TOKENS) {
      throw new Error(`At most ${MAX_MCP_TOKENS} MCP tokens; revoke one first.`);
    }
    const token = MCP_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const id = randomBytes(6).toString("hex");
    const createdAt = this.now();
    const clean = label.trim().slice(0, 80) || "Claude Code";
    this.db
      .prepare(
        "INSERT INTO mcp_tokens (id, token_hash, label, created_at, last_used) VALUES (?,?,?,?,NULL)",
      )
      .run(id, digest(token), clean, createdAt);
    return { id, token, label: clean, createdAt, lastUsedAt: null };
  }

  list(): McpTokenInfo[] {
    return (
      this.db
        .prepare("SELECT id, label, created_at, last_used FROM mcp_tokens ORDER BY created_at DESC")
        .all() as { id: string; label: string; created_at: number; last_used: number | null }[]
    ).map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      lastUsedAt: r.last_used,
    }));
  }

  /** True when a token with this id existed. */
  revoke(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM mcp_tokens WHERE id = ?").run(id).changes) > 0;
  }

  /** The id of a valid token, or null. Looked up by hash, so timing reveals nothing. */
  verify(token: string): string | null {
    if (!TOKEN_RE.test(token)) return null;
    const row = this.db
      .prepare("SELECT id, last_used FROM mcp_tokens WHERE token_hash = ?")
      .get(digest(token)) as { id: string; last_used: number | null } | undefined;
    if (!row) return null;
    const now = this.now();
    if (row.last_used === null || now - row.last_used >= this.touchEveryMs) {
      this.db.prepare("UPDATE mcp_tokens SET last_used = ? WHERE id = ?").run(now, row.id);
    }
    return row.id;
  }

  close(): void {
    this.db.close();
  }
}
