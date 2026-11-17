# 05 — Bring-your-own AI & Claude-subscription policy (17 Nov 2026)

## BYOK

- **Lowest common denominator: an OpenAI-compatible client** with a configurable baseURL. It covers OpenRouter, Groq, DeepSeek, Mistral, Gemini (compatibility endpoint), Ollama (`:11434/v1`), LM Studio and llama.cpp.
  - Add a native Anthropic adapter for prompt caching.
  - TS library: **Vercel AI SDK** (`ai` + `@ai-sdk/*`). Python: LiteLLM.
- **Free option:** OpenRouter `:free` models allow 20 requests/minute; 50/day, or 1,000/day once the account has bought $10 of credits.
- **On-device models:**
  - WebLLM (WebGPU).
  - Chrome Prompt API: extensions only; languages limited to en/ja/es/de/fr.
  - Apple Foundation Models: 4K context.
  - ML Kit GenAI.
  - Use them for glossing and grading, not as the main conversation engine.
- **Key storage:**
  - Desktop: OS keychain (`keyring` crate in Tauri).
  - Extension: `chrome.storage.local`, never `sync`.
  - Web: passphrase-encrypted in IndexedDB.
  - Never sync keys, never put them in Anki or exports.
- **CORS:**
  - Anthropic: header `anthropic-dangerous-direct-browser-access: true`.
  - OpenAI: `dangerouslyAllowBrowser`.
  - Ollama: `OLLAMA_ORIGINS`.
  - Extension host permissions bypass CORS.
- **Cost:** 20 turns ≈ 60K in / 3K out.
  - Haiku-class models: under $0.01.
  - Sonnet 5.5 ($2/$10 per M): about $0.15, or about $0.05 with caching.
  - Default to cheap models.

## Can the app use a user's Claude Pro/Max subscription? **No (not via OAuth or login).**

- Claude Code legal page (https://code.claude.com/docs/en/legal-and-compliance):
  - "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users … may not collect, store, or intermediate Claude.ai credentials or session tokens."
  - Enforcement may happen without notice.
- Agent SDK docs: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products."
- Enforcement in 2026: server-side blocks in January; OpenCode removed its OAuth in March; OpenClaw and other harnesses were blocked in April.
- **Spawning the user's own `claude -p`:**
  - A user wiring it up for personal use is plausibly fine (unmodified binary, own subscription).
  - Shipping it as a built-in "use your Claude subscription" backend is a grey-to-prohibited area.
  - At most, offer an unsupported "custom command" option.
- **Legitimate alternatives:**
  - API key; Max/Ultra plans reportedly include monthly API credits — verify before relying on it.
  - **OpenAI "Sign in with ChatGPT"** is officially available to open-source and local apps (https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) — verify before relying on it.
  - Gemini CLI OAuth is forbidden for third-party tools; use AI Studio keys instead.

## MCP: the clean subscription path

- Ship an MCP server with tools `get_known_words`, `check_coverage(text)`, `get_text`, `add_to_anki`, `save_correction`, plus prompts such as "start a B1 conversation about X".
- The user's Claude Desktop, Claude Code or ChatGPT then drives the session under their own plan.
- Downsides:
  - The UX lives in their chat app, not ours.
  - The vocabulary constraint can only be enforced through tool calls.

## Vocabulary-constrained conversation

- **Evidence:**
  - Prompting with a CEFR level alone drifts over a conversation (arXiv 2505.08351).
  - SRS-Stories masks banned tokens during decoding (arXiv 2512.18362).
  - Level-targeted simplification as a lexical-constraint task (arXiv 2502.11457).
- **Pipeline:**
  1. System prompt: level, ≥ 95–98% coverage target, ≤ N new words per turn marked `[[word]]`, topic, short known-lemma list.
  2. Lemmatize the reply and compute coverage. Proper nouns, numbers and cognates count as known.
  3. If coverage is too low, send one rewrite request naming the offending words. If that fails too, gloss them.
  4. Local models: soft logit penalties work better than hard grammars.
  5. Ask for structured JSON `{reply, corrections:[{orig,fixed,rule}], new_words:[{lemma,gloss,example}]}` and push the new words to Anki.
- **Token budget:**
  - 3,000 lemmas cost about 6–12K tokens.
  - Instead, send the frequency band plus 200–400 relevant known words plus the N target words.
  - Put the static prompt first and cache it.
