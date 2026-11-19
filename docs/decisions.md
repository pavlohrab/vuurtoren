# Decisions

The rules the code follows, and why.

## Product

- **Dutch only.** Reading, vocabulary, grammar A1–C1 and A2 inburgeringsexamen practice.
- **Anki is the record of known words.** Kenning reads your decks through AnkiConnect. It never
  uses AnkiWeb and never links Anki's Rust code (rslib, AGPL).
- **Algorithms first, AI optional.** Every core feature works without AI. AI uses your own key.
- **Licence:** MIT OR Apache-2.0.

## Anki writes

Kenning writes to Anki only when you click, and tags every note it touches.

| Situation                 | Action               | What Kenning does                                                  | Tag                |
| ------------------------- | -------------------- | ------------------------------------------------------------------ | ------------------ |
| not in Anki               | **Add to Anki**      | adds a note to the deck the language profile chooses               | `kenning`          |
| new or suspended card     | **Study first**      | moves it to the front of its deck's new queue and unsuspends it    | `kenning::reading` |
| any state, or not in Anki | **Mark known**       | adds the note if needed, then sets an interval of at least 21 days | `kenning::known`   |
| manually marked           | **Use Anki's state** | nothing in Anki, the app-side mark is removed                      | —                  |

- Kenning never answers cards, never writes review logs and never changes FSRS parameters.
- Answers given in Kenning (practice, clozes, book exercises) are **app evidence**. They can make
  a word "Learning (in Kenning)" but never "known", and they never reach Anki. The formula is in
  [algorithms.md](algorithms.md#17-learning-in-kenning-app-evidence).
- All writes go through one command layer in `packages/anki`. Reader, Words, Talk, courses and
  MCP all use it.

## Language profile

- One profile per language: the decks Kenning reads (confirmed by you, detection only suggests),
  where new words go (default, plus optional decks for reading, Talk, AI, MCP), and the deck rule
  for course words (per unit, per course or default).
- Onboarding at `/welcome` creates it: connect Anki → confirm decks → where new words go →
  placement check if you start fresh → first text.

## Data

- **Event log.** An append-only `events` table is the source of truth; every other table is a
  projection rebuilt from it.
- **Where it lives:**
  - desktop app: one SQLite file in `Documents/Kenning`, with a lock file against two computers
    writing at once;
  - server: one SQLite file behind `server/api`, shared by all your devices;
  - browser only: SQLite in OPFS, one tab at a time.
- **Several devices on one server:** each client checks a cheap change marker on focus and every
  30 s, and refetches when another device wrote. The last write of a setting wins.
- Backups export and import the whole file in every mode.
- Encrypted sync without a server is planned, not built.

## Language server

- Python (`server/nlp`, FastAPI, spaCy `nl_core_news_md`), because Dutch separable verbs and
  grammar detection need a dependency parse. The same analyzer runs on Anki card fields and on
  texts.
- One process, one worker: OCR jobs and the grammar-example cache live in that process.
- Data (dictionary, sentences, translation model) are versioned packs, downloaded and checked on
  start. Analyses carry an analyzer version, and texts are re-analysed once when it changes.
- The desktop app bundles the same server, without OCR.

## Platforms

- One TypeScript core and one React UI for every platform.
- Web (PWA) and desktop (Tauri v2) now. Browser extension and phone later.

## AI

- Your own key: Anthropic, any OpenAI-compatible provider, or a local model. Requests go from your
  device straight to the provider. The key stays on the device, never in the data, backups or
  server.
- Kenning never offers a Claude sign-in and never routes requests through a subscription.
  Subscription users connect their own Claude client through MCP: `/api/mcp` on the server (with
  a per-user token) or the stdio server in `apps/mcp`. Over HTTP, MCP only suggests words. You add
  them in the app.

## Sign-in (public servers)

- Single user. `KENNING_USER` + `KENNING_PASSWORD_HASH` (scrypt), session cookie (`HttpOnly`,
  `Secure`, `SameSite=Lax`), sessions stored hashed in a separate file so backups never hold them.
- Brute-force delay per IP plus a global cap. CSRF checks on every non-GET request.
- nginx gates `/api` and `/nlp` behind the session. If the api is unreachable, `/nlp` stays
  closed.
