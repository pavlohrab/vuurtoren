# AI (optional, your own key)

Without AI everything else works. With a provider set you also get:

- **Talk**: a short chat in Dutch that stays within the words you know, corrects your messages and
  offers new words to add.
- **Explain this sentence** and **Simplify this page** in the reader, and the English of **Side by
  side** when "English from AI" is on (the word pairs still come from the offline model).
- **Write a story** (Add text, a grammar topic, a course unit): a text at your level, saved to
  the Library.
- **Fill gaps with AI sentences** in Practice, and **Generate exercises like this unit** in a course.
- Examiner-style feedback on exam writing and speaking.

Without a provider these buttons are hidden. Talk stays in the menu and opens a short set-up
screen instead.

## Providers

Settings → AI: pick a provider, paste the key, pick a model, press **Test**. The model list comes
from the provider; any name can be typed.

| Provider          | Address                                                   | Default model             |
| ----------------- | --------------------------------------------------------- | ------------------------- |
| Anthropic         | `https://api.anthropic.com`                               | `claude-haiku-5-5`        |
| OpenAI            | `https://api.openai.com/v1`                               | `gpt-5-mini`              |
| Google Gemini     | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash`        |
| OpenRouter        | `https://openrouter.ai/api/v1`                            | `google/gemini-2.5-flash` |
| Groq              | `https://api.groq.com/openai/v1`                          | `llama-3.3-70b-versatile` |
| DeepSeek          | `https://api.deepseek.com/v1`                             | `deepseek-chat`           |
| Mistral           | `https://api.mistral.ai/v1`                               | `mistral-small-latest`    |
| Ollama (local)    | `http://localhost:11434/v1`                               | `llama3.2`                |
| LM Studio (local) | `http://localhost:1234/v1`                                | `local-model`             |
| Other             | any OpenAI-compatible address                             | your model                |

Ollama needs `OLLAMA_ORIGINS` set to Vuurtoren's address. LM Studio needs its local server and CORS
on.

**Cost:** a 20-turn conversation, a story or a full sentence fill each cost well under a cent on
small models. Settings shows a local monthly tally; set a hard limit with your provider.

## Privacy

- Requests go from your device straight to the provider. There is no Vuurtoren proxy.
- The key is stored on this device only. It is never in your data, backups or the server.
  An optional passphrase encrypts it (AES-GCM, PBKDF2 250,000 iterations).
- Sent to the provider: the topic, target words, a grammar point, your vocabulary estimate and
  200–400 known lemmas. Some features also send the text they work on: **Explain this sentence**
  sends the sentence, **Simplify this page** sends the page, Side by side with "English from AI"
  sends the sentences of the page, Talk sends your messages, and exam
  feedback sends your answers. Nothing else from your Library, no Anki content and no
  identifiers.
- Conversations, stories and generated sentences are saved in your data, so backups include them.

## How generated text is checked

The AI writes, the algorithms check. Nothing generated is graded by the AI.

- **Talk and stories:** the language server analyses the text and the reader's matcher scores
  coverage against your words. Below your target minus 3 points (at least 90%), one rewrite is
  asked, naming the offending words. It is kept only if coverage doesn't drop. Words still
  unknown are glossed.
- **Example sentences** (up to 8 words per Practice session, 5 sentences each): kept only if the
  target word is really there, coverage is at least 90% with at most one unknown word, no other
  target leaks in, the length is 4–14 words, and for a grammar topic the rule-based detector fires.
  Failed attempts are stored too, so a hard word isn't retried every session.
- **Unit exercises:** gap fills, sentence building and a text with questions, each checked the
  same way, then graded by the book's own checkers.

## Use Vuurtoren from Claude

Your own Claude Code or Claude Desktop calls Vuurtoren's tools over MCP, under your own plan. No API
key needed. Vuurtoren never asks for a Claude login.

The MCP server (`apps/mcp`) runs on your computer and opens the desktop app's data file, so this
needs the desktop app. A browser keeps its data where no other program can read it: sync it with
the desktop app and use Claude there. Settings → AI → **Use with Claude** shows the commands with
your data file filled in.

1. Build the MCP server once: `pnpm install && pnpm build` in a copy of this repository.
2. Add it to Claude Code:

   ```sh
   claude mcp add vuurtoren --env VUURTOREN_DB="/home/anna/Documents/Vuurtoren/vuurtoren.sqlite" \
     -- node /path/to/vuurtoren/apps/mcp/dist/main.js
   ```

   For Claude Desktop, copy the JSON shown in Settings into `claude_desktop_config.json`.

3. Ask, for example: "Write me an A2 story with my words to learn about cycling and save it to
   Vuurtoren."

| Tool                       | Does                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `get_known_words`          | words you know, are learning or have seen                           |
| `get_words_to_learn`       | the reader's "to learn" words of your recent texts, with a sentence |
| `check_coverage`           | share of a text you know, and the unknown words                     |
| `list_texts`, `get_text`   | your Library                                                        |
| `list_courses`, `get_unit` | your courses, a unit's words, grammar and texts                     |
| `get_grammar_topic`        | Vuurtoren's grammar pages                                           |
| `save_text`                | saves a story or exercise to the Library                            |
| `suggest_words_for_anki`   | queues words under **Words → Suggested by Claude**; you click Add   |
| `add_to_anki`              | adds a card right away                                              |

What Claude saves goes into the data file; the desktop app shows it and syncs it to your other
devices.

| Variable              | Meaning                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `VUURTOREN_DB`        | the desktop app's data file (default: where the app keeps it)                                  |
| `VUURTOREN_NLP_URL`   | language server for `check_coverage` and `save_text`, e.g. `https://vuurtoren.example.com/nlp` |
| `VUURTOREN_NLP_TOKEN` | a sync token of that server, sent as a bearer token                                            |
| `VUURTOREN_ANKI_URL`  | AnkiConnect (default `http://127.0.0.1:8765`)                                                  |
| `VUURTOREN_DECK`      | deck override; by default the language profile decides                                         |
