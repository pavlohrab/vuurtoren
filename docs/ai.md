# AI (optional, your own key)

Everything in Vuurtoren works without AI. If you add a key from an AI provider, you get a few
extras on top.

- **Talk**: a short chat in Dutch that stays within the words you know and corrects your messages.
- In the reader: **Explain this sentence**, **Simplify this page**, and English from the AI in
  Side by side.
- **Write a story**: a new text at your level about a topic you choose.
- In Practice: new example sentences for your words.
- For the exam: feedback on your writing and speaking.

Without a key these buttons are hidden.

## Providers

Go to Settings → AI, pick a provider, paste your key, pick a model and press **Test**. The list of
models comes from the provider, and you can also type any model name yourself.

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

On a small model, a long chat or a story costs well under a cent. Settings → AI shows a rough
count of what you used this month on this device, but it isn't your bill, so set a spending limit with your
provider if you want one.

## Privacy

Requests go from your device straight to the provider. There is no Vuurtoren server in between. The
key is stored on this device only, so it's never in your data, your backups or on your server. If
you want, you can lock it with a passphrase too.

What the provider gets is the topic, the target words, a grammar point, your vocabulary estimate
and 200 to 400 words you know. Some features also send the text they work on: **Explain this
sentence** sends the sentence, **Simplify this page** sends the page, Side by side with "English
from AI" sends the sentences of the page, Talk sends your messages, and exam feedback sends your
answers. Nothing else from your Library is sent, no Anki content and nothing that identifies you.

Conversations, stories and generated sentences are saved in your data, so your backups include
them.

## How generated text is checked

The AI only writes. Vuurtoren checks what it wrote and never lets the AI grade anything.

A story or a chat message is checked against the words you know. If too many words are new to you,
the AI writes it again once, and the words you still don't know get a translation. An example
sentence is only kept if it is short, really has your word in it, and you know almost all of its
other words.

## Use Vuurtoren from Claude

If you use Claude Code or Claude Desktop, Claude can call Vuurtoren's tools over MCP, under your
own Claude plan. You don't need an API key for this, and Vuurtoren never asks for your Claude login.

The MCP server (`apps/mcp`) runs on your computer and opens the desktop app's data file, so this
needs the desktop app. Settings → AI → **Use with Claude** shows the commands with your data file
filled in.

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

What Claude saves goes into the data file, and the desktop app shows it and syncs it to your other
devices.

| Variable              | Meaning                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `VUURTOREN_DB`        | the desktop app's data file (default: where the app keeps it)                                  |
| `VUURTOREN_NLP_URL`   | language server for `check_coverage` and `save_text`, e.g. `https://vuurtoren.example.com/nlp` |
| `VUURTOREN_NLP_TOKEN` | a sync token of that server, sent as a bearer token                                            |
| `VUURTOREN_ANKI_URL`  | AnkiConnect (default `http://127.0.0.1:8765`)                                                  |
| `VUURTOREN_DECK`      | deck override; by default the language profile decides                                         |
