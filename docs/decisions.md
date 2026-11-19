# Decisions

The rules the code follows, and why.

## Product

- **Dutch only.** Reading, vocabulary, grammar A1–C1 and A2 inburgeringsexamen practice.
- **Two modes, one owner of the schedule each.** The language profile's mode decides who holds
  the cards:
  - **Native** (the default for new learners): Kenning holds the cards and runs the reviews.
    Anki is not needed.
  - **Connected** (every profile from before modes existed): Anki is the record of known words
    and runs the reviews; Kenning reads your decks through AnkiConnect.
- Kenning never uses AnkiWeb and never links or copies Anki's code (rslib and AnkiDroid are
  AGPL). Package files are read from their file format only.
- **Algorithms first, AI optional.** Every core feature works without AI. AI uses your own key.
- **Licence:** MIT OR Apache-2.0.

## Modes

- Onboarding asks "Do you use Anki?". No: native. Yes: either **Import from Anki and use
  Kenning's scheduler** (the confirmed decks are imported once, then native) or **Keep using
  Anki** (connected).
- A connected profile can switch in Settings → Language & decks with **Move from Anki to
  Kenning**: a one-way import of the confirmed decks and Kenning's own destination decks, with
  notes, cards and the full review history, through AnkiConnect. Anki is only read. The profile
  then becomes native.
- In native mode an `.apkg` or `.colpkg` file can be imported at any time: one deck, several or
  all.
- Kenning never writes reviews or schedules to Anki. Imported notes and cards keep their Anki
  ids.
- The automatic Anki import (on start and every 6 hours) runs only in connected mode.

## Word commands

All word commands go through one command layer in `packages/anki`. Reader, Words, Talk, courses
and MCP all use it, and it acts by the profile's mode.

### Native mode

| Action              | What Kenning does                                                                   |
| ------------------- | ----------------------------------------------------------------------------------- |
| **Add to my words** | adds a Kenning Word note with one card to the deck the language profile chooses     |
| **Study first**     | moves the word's new cards to the front of the new queue and unsuspends them        |
| **Mark known**      | gives the cards an interval of 21–35 days, adding the word first if it has no cards |

Nothing is written to Anki.

### Connected mode: Anki writes

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
- Answers given on the native review screen are reviews of Kenning's own cards, not app
  evidence.

## Language profile

- One profile per language: its mode (native or connected), the decks Kenning reads (confirmed by you, detection only suggests),
  where new words go (default, plus optional decks for reading, Talk, AI, MCP), and the deck rule
  for course words (per unit, per course or default).
- Onboarding at `/welcome` creates it: language → "Do you use Anki?" → (connected or moving:
  connect Anki → confirm decks) → where new words go → the import when moving, or the placement
  check when you start fresh → first text.
- A profile saved without a mode is connected.

## Data

- **Event log.** An append-only `events` table is the source of truth; every other table is a
  projection rebuilt from it. Native cards are events too: notes added or imported, reviews (each
  carrying the card's schedule before and after), undos, deck options and FSRS parameters.
- **Media** of imported cards (images, sounds) are blobs, like covers: not in the log, kept by
  backups.
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
- OCR: RapidOCR (PaddleOCR models, bundled) on a straightened page, Tesseract as the fallback.
  A PDF page uses its text layer unless it has under 40 letters or under 70% Dutch words.
- The desktop app bundles the same server, OCR included.

## Platforms

- One TypeScript core and one React UI for every platform.
- Web (PWA) and desktop (Tauri v2) now. Browser extension and phone later.

## Native scheduler

- FSRS-6 through `ts-fsrs` (MIT). The optimizer is `fsrs-rs` (BSD-3-Clause) compiled to
  WebAssembly, as published by the ts-fsrs project in `@open-spaced-repetition/binding`
  (`binding-wasm32-wasip1`, MIT). It runs in a worker on the device, also offline in the desktop
  app.
- Package files are unzipped with `fflate` (MIT) and decompressed with `fzstd` (MIT); their
  SQLite collection is read with the SQLite build Kenning already ships.

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
