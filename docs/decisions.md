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
- In native mode your decks can be exported to an `.apkg` at any time, with their schedule,
  memory and review history, to import in Anki or keep as a copy.
- A native profile can move back once with **Move to Anki** (Settings → Language & decks):
  words become notes of Kenning's note type in their own decks (notes that came from Anki stay
  as they are there), cards reviewed in Kenning get their next due date with that gap as their
  interval, and, as an experimental option, the review history goes in with real answer times,
  plus each card's exact interval, reviews and lapses. The profile then becomes connected.
  Notes of other types without a word stay out; the `.apkg` export carries them.
- Apart from Move to Anki, Kenning never writes reviews or schedules to Anki. Imported notes and
  cards keep their Anki ids.
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
- Onboarding at `/welcome` creates it: language (only when there is more than one) → "Do you use
  Anki?" → (connected or moving: connect Anki → confirm decks) → where new words go → the import
  when moving, or the placement check when you start fresh → first text. The stepper shows three
  fixed parts: Getting started, Your words, First text.
- A profile saved without a mode is connected.

## Data

- **Event log.** An append-only `events` table is the source of truth; every other table is a
  projection rebuilt from it, apart from blobs and the analysis cache. Native cards are events
  too: notes added or imported, reviews (each carrying the card's schedule before and after),
  undos, deck options and FSRS parameters.
- **Analyses are a cache on each device.** A text's tokens and grammar hits come from the
  language server, so they are derived data, not events: each device keeps its own (the server
  keeps them for server mode), one per text, valid for its content and analyzer version, and
  never synced. A text is analysed again when its device has no analysis of the current content,
  or when the device's analyzer arrived after the analysis was made. Logs from earlier versions
  still hold `TextAnalyzed` and `TextGrammarDetected` events; they fill the cache, so nothing is
  analysed again after an update.
- **Media** of imported cards (images, sounds) are blobs, like covers: not in the log, kept by
  backups.
- **Where it lives:**
  - desktop app: one SQLite file in `Documents/Kenning`, with a lock file against two computers
    writing at once;
  - server: one SQLite file behind `server/api`, shared by all your devices;
  - browser only: SQLite in OPFS, one tab at a time.
- **Several devices on one server:** each client checks a cheap change marker on focus and every
  30 s, and refetches when another device wrote. The last write of a setting wins.
- **Sync** (Settings → Sync), for devices that keep their own data (the desktop app, the browser's
  own storage, later phones): each device's events travel through a place you choose — your
  Kenning server, a folder you already sync (desktop app), WebDAV or a private GitHub repository —
  encrypted on the device with your passphrase. The place only stores sealed files; each device
  writes only its own. The passphrase is never stored; the key it opens is kept on the device.
- Conflicts by kind of data: the log is replayed in clock order across devices, so the latest
  setting, word mark or profile wins; reviews and answers merge (an answer to a card another
  device answered meanwhile applies to the card as it is now).
- Events carry a version: an older app keeps newer events without applying them until it is
  updated.
- Backups export and import the whole file in every mode.

## Several devices

- **One model: event sync.** Each device keeps its own data and its own log. Devices exchange
  events through a sync place, replay them in hybrid-clock order and reach the same state:
  latest wins for settings and marks, reviews and answers merge. This is the only way two copies
  of your data come together.
- **Server mode is a thin client.** The web app opened on your Kenning server reads and writes
  that server's database directly and keeps no copy, so there is nothing to merge. It will become
  a syncing client: a copy in the browser that syncs with the server like any other device.
- **Words.** _Kenning server_ is the stack you host (web app, API, language server). _Server
  mode_ is the web app working on that server's database. A _sync place_ is where devices
  exchange events; your Kenning server is one, next to a synced folder, WebDAV and GitHub.
- **A data file belongs to one computer.** The desktop app's lock file only keeps two apps from
  writing at once; it is not a way to share data. Sharing one database file between computers
  (a cloud-synced Documents folder, a network drive) is not combined with event sync: the
  computers would share one device id and one log. Keep the desktop data folder out of synced
  folders, and use Sync to bring computers together. Two checks guard this rule (see the
  roadmap): a sync folder that holds the data folder is refused, and two computers using one
  device id get a warning.

## Language server

- Python (`server/nlp`, FastAPI, spaCy `nl_core_news_md`), because Dutch separable verbs and
  grammar detection need a dependency parse. The same analyzer runs on Anki card fields and on
  texts.
- One process, one worker: OCR jobs and the grammar-example cache live in that process.
- Data (dictionary, sentences, translation model) are versioned packs, downloaded and checked on
  start. Analyses carry an analyzer version; a text is analysed again once when the device's
  analyzer is newer than its analysis.
- OCR: RapidOCR (PaddleOCR models, bundled) on a straightened page, Tesseract as the fallback.
  A PDF page uses its text layer unless it has under 40 letters or under 70% Dutch words.
- The desktop app bundles the same server, OCR included.

## Platforms

- One TypeScript core and one React UI for every platform.
- Web (PWA) and desktop (Tauri v2) now. Browser extension and phone later.

## Desktop app security

The bundled page can do more than a web page (its database file, a sync folder, requests without
CORS), so what it may do is narrowed in Rust, where a script injected into the page cannot
change it:

- **Content Security Policy** (`tauri.conf.json`): the app's own scripts and WebAssembly (SQLite,
  the optimizer), images and media from blobs and data URLs, and connections to the app itself,
  its IPC, the bundled language server (`kenning-nlp:`) and http(s) for AI providers and GitHub.
  No frames, plugins or form posts. Inline `style` attributes stay allowed (React uses them).
  `tauri dev` runs without it (Vite's dev server needs inline scripts).
- **Database statements** (`db_exec`): the app's SQL runs as before, but a statement may not open
  other files (`ATTACH`, `VACUUM INTO`), drop the events table or its append-only trigger, rename
  it or drop its columns, edit the schema by hand or load extensions. Compaction still deletes
  events, so this guards against reshaping the history and reaching past the file, not against
  every change.
- **Sync requests** (`sync_fetch`) go only to addresses the user allowed: the app asks in its own
  dialog the first time a sync place's address is used (a refusal holds until the app restarts).
  Redirects are followed only within the same address, the page cannot set Host, cookies or
  connection headers, no cookies are kept, and an answer is read only up to 64 MB.
- **Sync folder**: links inside it are not followed (a device syncing the same folder could
  otherwise point Kenning's reads and writes elsewhere); the chosen folder itself may be a link.
- **Sync key**: `apps/web/src/sync/keyStore.ts` keeps the 64-byte data key in the system keychain
  (macOS Keychain, Windows Credential Manager, the Secret Service on Linux), or in a file only
  this user can read when there is no keychain. In a browser it keeps the key encrypted under a
  non-extractable AES key in IndexedDB. Sync still keeps the key in local storage until it moves
  to this store.

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
