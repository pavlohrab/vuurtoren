# ADR 0005 — BYOK for AI; MCP server for subscription users; never handle Claude OAuth

**Status:** accepted

**Context:** Anthropic forbids third-party apps from offering claude.ai login or routing requests through subscription credentials (Claude Code legal page; Agent SDK docs; enforced in 2026).

**Decision:**

- AI via user keys: OpenAI-compatible, Anthropic, Gemini, Ollama, DeepL for translation.
- Ship an MCP server (`apps/mcp`) so users can drive conversations from their own Claude/ChatGPT apps.
- Possibly add OpenAI "Sign in with ChatGPT" (sanctioned for open-source/local apps).

**Consequences:** compliant. The subscription UX lives in the user's chat client.

**Note (2026-11, MCP over HTTP):** the server now serves the MCP tools itself at `/api/mcp` (Streamable HTTP, stateless), so Claude Code / Claude Desktop connect with `claude mcp add --transport http` and a per-user MCP token made in Settings → AI → Use with Claude Code (only its hash is stored; the token opens `/api/mcp` only). Still no OAuth and no subscription credentials pass through Kenning: the user's own Claude client calls Kenning, never the other way round. The stdio server in `apps/mcp` stays for local setups and is the only one with a direct `add_to_anki`; over HTTP, words are only suggested and the learner adds them in the app (ADR 0007).
