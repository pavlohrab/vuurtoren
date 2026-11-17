# AI in Kenning (bring your own key)

AI is optional. Without it the reader, practice and Anki integration work as before. With it you get:

- **Converse** (`/converse`): a short chat in Dutch with a partner that stays within the words you know, corrects your messages and offers new words for Anki.
- **Explain this sentence** (under the word inspector in the reader).
- **Simplify this page** (in the reader): a rewrite at your coverage target, shown beside the original with both coverage scores. It never replaces the text.

These buttons are hidden until a provider is configured.

## Providers

Settings, AI. Pick a provider, check the model, paste your key, press **Test**.

| Provider          | Address (preset)                                          | Default model             | Notes                                                                             |
| ----------------- | --------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| Anthropic         | `https://api.anthropic.com`                               | `claude-haiku-5-5`        | Native Messages API, prompt caching on the static prompt. API key, not claude.ai. |
| OpenAI            | `https://api.openai.com/v1`                               | `gpt-5-mini`              |                                                                                   |
| Google Gemini     | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash`        | OpenAI-compatible endpoint, AI Studio key.                                        |
| OpenRouter        | `https://openrouter.ai/api/v1`                            | `google/gemini-2.5-flash` | Many models; some free with rate limits.                                          |
| Groq              | `https://api.groq.com/openai/v1`                          | `llama-3.3-70b-versatile` |                                                                                   |
| DeepSeek          | `https://api.deepseek.com/v1`                             | `deepseek-chat`           |                                                                                   |
| Mistral           | `https://api.mistral.ai/v1`                               | `mistral-small-latest`    |                                                                                   |
| Ollama (local)    | `http://localhost:11434/v1`                               | `llama3.2`                | No key. Start Ollama with `OLLAMA_ORIGINS` set to the app's address.              |
| LM Studio (local) | `http://localhost:1234/v1`                                | `local-model`             | No key. Enable the local server and CORS.                                         |
| Other             | your address                                              | your model                | Anything that speaks the OpenAI Chat Completions API.                             |

Model names change often; the defaults are cheap and fast and you can type any model your provider offers.

**Implementation choice.** `packages/ai` uses `fetch` directly (two small adapters: OpenAI-compatible and native Anthropic) instead of the Vercel AI SDK or the vendor SDKs. The app needs one JSON chat call, a cache breakpoint and good error messages; the SDKs would add hundreds of kB to the browser bundle and hide the exact request shape (headers, `cache_control`) that the tests pin down. Streaming is not implemented; replies are short.

## Privacy and keys

- Requests go **from your browser straight to the provider**. There is no Kenning proxy.
- The key is stored **on this device only**, in the browser's `localStorage` (also when you use the server storage mode). It is never written to the event log, the database, backups, exports or sync, and the server never sees it.
- Optional passphrase: the key is encrypted with AES-GCM (key derived by PBKDF2, 250,000 iterations) via WebCrypto. You unlock it once per session. Without a passphrase the key is stored as plain text, which is only as safe as your browser profile. Use a key with a spend limit.
- Conversation text (your messages, the partner's replies, corrections, new words) **is** stored as events (`ConversationStarted`, `MessageAdded`) in your data, so it is included in backups and sync. Words from your vocabulary (a list of 200-400 lemmas) are sent to the provider with each conversation.
- A passphrase-less key is visible to any script running on the same origin. Kenning loads no third-party scripts.

## What a conversation costs

Each conversation sends a static prompt (rules, level, 200-400 known words, target words), which providers can cache, then the chat history (last 16 messages). Rough numbers for 20 turns: about 60K tokens in, 3K out.

- Small models (Haiku-class, Gemini Flash, Mistral Small): well under one cent.
- Mid-size models: a few cents.
- Local models (Ollama): free.

Settings shows a **local tally** for the month (requests and tokens on this device) and a free-text spend note for you. It is not your provider's bill; set a hard limit in the provider's dashboard.

## How Converse keeps to your vocabulary

1. The system prompt lists your level (vocabulary estimate), the topic, up to 400 relevant known lemmas (topic words, words you are learning, then an even sample of the rest) and target words. Asked for JSON: `{reply, corrections:[{original, corrected, explanation}], new_words:[{lemma, gloss, example}]}`.
2. Each reply is analysed by the language server and its coverage computed against your learner model with the same matcher as the reader (names, numbers and ignored words do not count; declared new words and target words count as known).
3. Below the threshold (your coverage target minus 3 points, at least 90%) the app makes **one** rewrite request that names the offending words.
4. Words that remain unknown are glossed inline. If the language server is down, the check is skipped and the chat continues.
5. If the model answers with invalid JSON, its raw text is shown and no rewrite is attempted.

The coverage chip on each reply shows the final score.

## Claude subscription (Pro / Max): use MCP

Anthropic does not allow third-party apps to use claude.ai logins or route requests through subscription credentials ([ADR 0005](adr/0005-no-claude-oauth-mcp-instead.md)). Kenning never asks for or stores them. Subscribers have two legitimate options:

1. An **API key** from console.anthropic.com (separate billing; check whether your plan includes API credits).
2. The **MCP server** below: your own Claude Desktop or Claude Code drives the conversation under your plan and calls Kenning's tools.

## MCP server (`apps/mcp`)

Needs the server storage mode (the compose stack's `api` service), because the MCP process reads your data over `/api/rpc`.

Tools:

| Tool              | Purpose                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `get_known_words` | `lang`, `limit`, `query`, `state`: words you know (or are learning).   |
| `check_coverage`  | `text`: share of words you know and the unknown words (target 95-98%). |
| `list_texts`      | Your library.                                                          |
| `get_text`        | `id`: one text (truncated at 20,000 characters).                       |
| `add_to_anki`     | `word`, `gloss`, `sentence`: a new card in the target deck.            |

Build it once: `pnpm install && pnpm build`. Environment:

| Variable           | Meaning                                                                    |
| ------------------ | -------------------------------------------------------------------------- |
| `KENNING_URL`      | Address of your Kenning server, e.g. `http://localhost:8080`. Required.    |
| `KENNING_TOKEN`    | Bearer token, needed when the server has sign-in on (also sent to `/nlp`). |
| `KENNING_NLP_URL`  | Language server (default `$KENNING_URL/nlp`).                              |
| `KENNING_ANKI_URL` | AnkiConnect (default `http://127.0.0.1:8765`); `KENNING_ANKI_KEY` if set.  |
| `KENNING_DECK`     | Deck override. By default the language profile decides (ADR 0010).         |

**Claude Code:**

```sh
claude mcp add kenning \
  --env KENNING_URL=http://localhost:8080 --env KENNING_TOKEN=... \
  -- node /path/to/kenning/apps/mcp/dist/main.js
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "kenning": {
      "command": "node",
      "args": ["/path/to/kenning/apps/mcp/dist/main.js"],
      "env": { "KENNING_URL": "http://localhost:8080", "KENNING_TOKEN": "..." }
    }
  }
}
```

Then ask, for example: "Have a B1 Dutch conversation with me about cycling. Keep your Dutch to words I know: call check_coverage on each reply before sending it, and rewrite if it is below 95%." The vocabulary limit can only be enforced through these tool calls; the in-app Converse screen enforces it automatically.
