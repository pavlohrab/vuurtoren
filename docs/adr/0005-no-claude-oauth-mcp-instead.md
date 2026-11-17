# ADR 0005 — BYOK for AI; MCP server for subscription users; never handle Claude OAuth

**Status:** accepted

**Context:** Anthropic forbids third-party apps from offering claude.ai login or routing requests through subscription credentials (Claude Code legal page; Agent SDK docs; enforced in 2026).

**Decision:**

- AI via user keys: OpenAI-compatible, Anthropic, Gemini, Ollama, DeepL for translation.
- Ship an MCP server (`apps/mcp`) so users can drive conversations from their own Claude/ChatGPT apps.
- Possibly add OpenAI "Sign in with ChatGPT" (sanctioned for open-source/local apps).

**Consequences:** compliant. The subscription UX lives in the user's chat client.
