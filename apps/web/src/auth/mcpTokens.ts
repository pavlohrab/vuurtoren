/**
 * MCP tokens for Claude Code (server/api/src/auth/mcpTokens.ts): list, make (the token is
 * returned once) and revoke. Only in server mode; the session cookie authorises the calls.
 */
export interface McpToken {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

type FetchLike = typeof fetch;
const ambient: FetchLike = (...a) => globalThis.fetch(...a);
const HEADERS = { "content-type": "application/json", "x-kenning": "1" };

async function ok<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
  return body;
}

export function createMcpTokenClient(base = "", fetchImpl: FetchLike = ambient) {
  return {
    async list(): Promise<McpToken[]> {
      const res = await fetchImpl(`${base}/api/auth/mcp-tokens`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      return (await ok<{ tokens: McpToken[] }>(res)).tokens;
    },
    async create(label: string): Promise<McpToken & { token: string }> {
      const res = await fetchImpl(`${base}/api/auth/mcp-tokens`, {
        method: "POST",
        credentials: "same-origin",
        headers: HEADERS,
        body: JSON.stringify({ label }),
      });
      return ok(res);
    },
    async revoke(id: string): Promise<void> {
      const res = await fetchImpl(`${base}/api/auth/mcp-tokens/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: HEADERS,
      });
      await ok(res);
    },
  };
}

/** `claude mcp add` command for this server (no header when sign-in is off). */
export function claudeCodeCommand(url: string, token: string | null): string {
  const header = token ? ` --header "Authorization: Bearer ${token}"` : "";
  return `claude mcp add --transport http kenning ${url}${header}`;
}

/** Claude Desktop config (claude_desktop_config.json), via the mcp-remote bridge. */
export function claudeDesktopConfig(url: string, token: string | null): string {
  const server = token
    ? {
        command: "npx",
        args: ["-y", "mcp-remote", url, "--header", "Authorization:${KENNING_AUTH}"],
        env: { KENNING_AUTH: `Bearer ${token}` },
      }
    : { command: "npx", args: ["-y", "mcp-remote", url] };
  return JSON.stringify({ mcpServers: { kenning: server } }, null, 2);
}
