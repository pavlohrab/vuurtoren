# AI in Kenning (bring your own key)

AI is optional. Without it the reader, practice and Anki integration work as before. With it you get:

- **Converse** (`/converse`): a short chat in Dutch with a partner that stays within the words you know, corrects your messages and offers new words for Anki.
- **Explain this sentence** (under the word inspector in the reader).
- **Simplify this page** (in the reader): a rewrite at your coverage target, shown beside the original with both coverage scores. It never replaces the text.
- **Create a story** (Library, a grammar topic page, a course unit): a new text at your level with a few words to learn, saved to your Library ([Stories](#stories)).
- **Fill gaps with AI sentences** (Practice): checked example sentences for words that have too few ([AI example sentences](#ai-example-sentences)).

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

## Stories

**Create a story** opens a dialog: topic, length (short ~150, medium ~300, long ~600 words), kind of text (story, dialogue, news, letter) and a focus:

- **Words to learn now**: words you put first with Learn next, words you looked up while reading, then the shakiest words you are learning (up to 6).
- **This unit's new words** (from a course unit): the unit's words you do not know yet.
- **A grammar topic**: the story features that construction (from a topic page it is preselected).
- **My own words**: type them. The word field is always editable; at most 10 are sent.

How it works (`generateStory` in `packages/ai/src/story.ts`):

1. One request: level (vocabulary estimate), 300 relevant known lemmas (topic and target words first, then words you are learning, then an even sample), the target words, the grammar point and style. JSON answer `{title, text, used_targets}`.
2. The text is analysed by the language server and scored with the reader's matcher (target words count as known; they are meant to be new).
3. Below your coverage target minus 3 points (at least 90%): **one** rewrite request that names the offending words (and any missing target words). The rewrite is kept only if coverage does not drop.
4. Target words are checked in the analysed text (lemma match, separable verbs included), not taken from the model's `used_targets`. The toast after saving names any that are missing.
5. Invalid JSON: the raw answer is saved as the text (you paid for it), with the topic as title, and no rewrite is attempted. Language server down: the story is saved without the checks.

The story is saved as a Library text (`TextImported` with `source: {kind: "ai", provider, model, targets, topic, grammarTopic?}`; older source kinds are unchanged) and opens in the reader. The Library card shows an **AI story** chip. Words from a story go to Anki through the reader's normal Add to Anki.

**Cost.** About 1-2K tokens in and 300-1,200 out per story, roughly double with the rewrite. The dialog shows the estimate for the chosen length. Small models: well under a cent; mid-size: a few cents.

## AI example sentences

Practice exercises need example sentences. Anki notes, your own texts and Tatoeba cover most words; for the rest, the Practice start screen has **Fill gaps with AI sentences** (on by default when a provider is configured).

- For up to **8 words per session** with fewer than 3 usable sentences (and no earlier AI attempt), the app asks for 5 short sentences each (4-14 words) using your vocabulary (`generateSentences` in `packages/ai/src/examples.ts`). The vocabulary list is in a static, cacheable system prompt; the target word goes in the user message.
- Every sentence is **validated by the language server** before use, and dropped otherwise:
  - the target lemma is present (same matcher as the reader; separable verbs count);
  - the other words are known: coverage at least 90% and at most one unknown word;
  - no other target word of the request leaks in;
  - 4-14 words;
  - for a grammar topic, the server's rule-based detector fires for that topic (its marks and note are kept for the exercise).
- Accepted sentences are stored as `SentencesGenerated {lang, key, topic?, sentences:[{text, translation?, target?, marks?, note?}], rejected, provider, model}` events (no table; folded by `generatedSentences(lang)`, also over `/api/rpc`), so they are not generated again. An attempt with nothing accepted is stored too, so a hard word is not retried every session.
- They join the sentence pipeline as `source: "ai"`: after Anki and text sentences, alongside Tatoeba (listed first, so they win a tie). The existing non-AI generators build and grade the exercises; the AI never grades.
- **Grammar topic practice**: a topic with fewer than 6 hit sentences in your texts and Tatoeba gets one request for 5 sentences showing the construction (when a provider is configured). They feed the sentence exercises (scramble); word exercises (gender, perfect...) still need words from real hits.
- The session shows a line such as "5 new AI sentences for 2 items · 1 rejected by the checks". A provider error stops the fill and is shown there; practice continues without it.

**Cost.** One request per word: about 1K tokens in (mostly cacheable) and 200-300 out. A full fill of 8 words is roughly 10K in, 2K out: under a cent on small models.

## What is sent (stories and sentences)

To your provider only: the topic, the target words, the grammar topic's title and one-line summary, your vocabulary estimate and a list of 200-300 known lemmas. No texts from your Library, no Anki content, no keys or identifiers. The generated text and sentences are stored in your data (events), so they are included in backups and sync.

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
| `KENNING_DECK`     | Target deck (default `Kenning::Nederlands`).                               |

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
