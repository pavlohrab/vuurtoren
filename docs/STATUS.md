# Project status — 2026-11-18

Working name **Kenning**: an open-source reader that uses your Anki decks as the record of the words you know. Plan: [roadmap.md](roadmap.md). Decisions: [adr/](adr/).

## How to run (dev)

One-time data downloads (git-ignored): `cd server/nlp && uv run python scripts/build_dictionary.py && uv run python scripts/fetch_mt_model.py` (34 MB dictionary + 85 MB int8 translation model). In Docker the same data are versioned data packs on the `/data` volume (server/nlp/src/kenning_nlp/packs.py).

```sh
pnpm install && pnpm build
pnpm nlp            # NLP service on :8000 (spaCy nl, dictionary, OCR*)
pnpm dev            # web app on http://localhost:5173 (proxies /nlp and /anki)
```

- Open Anki desktop with AnkiConnect (add-on `2055492159`), then use **Settings → Sync from Anki**.
- `?demo` shows mock data instead of your own.
- The Wiktionary dictionary (`server/nlp/data/dictionary-nl.sqlite`, 34 MB, git-ignored) is built with `cd server/nlp && uv run python scripts/build_dictionary.py`.
- *OCR of photos needs Tesseract with Dutch data installed locally (the Docker image includes it).
- Self-hosting: [deploy/README.md](../deploy/README.md) (`docker compose -f deploy/compose.yml up --build`); Dockge: [quick card](../deploy/dockge/README.md).
- Version **0.1.0** (root `package.json`, not tagged yet): [CHANGELOG.md](../CHANGELOG.md), [release notes](releases/v0.1.0.md).

## Done

### Foundation (M0)

- Monorepo: pnpm + Turborepo, TypeScript (strict), ESLint, Prettier, Vitest, CI.
- Python side: uv, ruff, pytest.
- Licence: MIT OR Apache-2.0.
- Docs: research notes 01–07, design system, naming, ADRs 0001–0011.

### Anki ↔ words (M1)

- **Auto-detection** of every Dutch deck in your collection (11 decks, 7,422 notes).
  - Picks the word, sentence and gloss fields itself.
  - Uses sentence fields as evidence, because single headwords are hard to identify by language.
- **Learner model:**
  - Known = interval ≥ 21 days with recall ≥ 0.6.
  - Recall comes from SM-2 decay since your last review, or FSRS stability when FSRS is on (it is off in your collection).
  - Multiple decks are merged.
- **Dutch analysis (spaCy + simplemma + Wiktionary forms):**
  - Separable verbs (_bel … op_ → _opbellen_), fused and te-forms.
  - A precision-first lemma choice, plus a precision test set.
- **Gate:** a card's headword is found in its own example sentence for **99.1%** of 7,039 sentences, and 570 of 571 for studied words.
  - Before precision was tuned this was 99.4%, with false matches such as _bellen_ → _bel_.
  - Precision is now covered by 58 hand-labelled sentences.
- `pnpm anki-report` reproduces this on any collection. It is read-only.

### App (M2 + M3)

- **Design system:**
  - Literata (reading) and Inter (interface), both with Cyrillic.
  - Warm paper theme, plus a charcoal dark theme.
  - Calm components, keyboard-first, ⌘K palette.
- **Server storage mode ([ADR 0008](adr/0008-server-storage-mode.md)):** the compose stack's `api` service keeps all data in one SQLite file on a volume, shared by every device (`/api/rpc` allow-list, `/api/export`, `/api/import`, optional `KENNING_TOKEN`). Settings > Your data downloads and restores a backup in both modes. Not yet run in a Docker image here (no daemon access); the pruned `pnpm deploy` layout was run with node and checked in headless Chromium through the Vite proxy.
- **Sign-in ([ADR 0009](adr/0009-login-for-public-deployments.md)):** single-user password (scrypt) with cookie sessions in a separate `auth.sqlite`, rate limit, CSRF guard, nginx `auth_request` on `/api` and `/nlp`, security headers, sign-in screen and Settings > Account; Dockge stack with optional Cloudflare Tunnel (`deploy/dockge/`). Checked with node + Vite proxy in headless Chromium; nginx config and images not run here (no Docker daemon).
- **Local-first storage:**
  - SQLite in the browser (OPFS), on an append-only event log built for sync (desktop and dev; asks for persistent storage, banner on plain http).
  - Survives reloads and the browser's back/forward cache.
- **Import:**
  - Paste.
  - Web address (fetched server-side, with SSRF protection).
  - PDF, with OCR fallback for scans.
  - Photo (OCR).
  - Journal cleanup: hyphenation, page headers and numbers, columns.
- **Reader:**
  - Pages of about 150 words.
  - Word states: amber = words worth learning now (_introduce_); dotted = translated only.
  - Read / Cloze / Gloss modes.
  - The **Translations dial** (Gloss mode only).
  - The **new-words budget**: the exact number per page, filled with less common but never rare words.
  - **Cloze hints**: meaning tooltip → first letter → reveal. Hinted answers count less.
  - An adaptive difficulty controller (staircase).
- **Word inspector:**
  - Dictionary form, meaning (your card's gloss first, then Wiktionary in the right part of speech), article, decks, sentence.
  - Shows the word's live state in Anki, read when it opens (new, suspended, learning, review, or "Anki not reachable").
  - Explicit write actions, per [ADR 0007](adr/0007-anki-write-actions.md): **Add to Anki** (a _Kenning Word_ note with the sentence, in the profile's deck), **Study first in Anki** (learn next: moves the new card to the front of its deck, unsuspending it; needs AnkiConnect API v1), **Mark known** (written to Anki as a 21–35 day interval, also for words not in Anki), **Use Anki's state** (drops a manual mark). Every write is logged as an event and tagged `kenning::reading` / `kenning::known`.
  - Ignore (app-only).
- **Words from this text** (`/read/:id/words`, opened by finishing a text, the reader footer or the Library card): highlighted words, looked-up words and optionally translated ones, each with its sentence and live Anki state, one action per row (Add / Study first / Mark known / Skip) and a single Apply that never stops on a failure.
- **Server:**
  - Analysis, language detection, gloss, URL/PDF/OCR endpoints.
  - Size limits and timeouts (URL fetch: 10 s per read, 20 s in total; upload bodies streamed; decompression bombs rejected).
  - Dockerfiles and compose files (one NLP worker, see ADR 0004). Built and smoke-tested in CI (no Docker daemon on this machine).
- **Quality:**
  - 847 TypeScript and 629 Python tests (56 Python tests skip without the downloaded data or Tesseract).
  - Four reviews; the 2026-11 review and its status: [review-2026-11.md](review-2026-11.md).

### Practice (M4)

- Exercises without AI (meaning, cloze, de/het, separable verbs, perfect tense with hebben/zijn, forms, scramble, dictation) on the `@app/core` engine, with their own FSRS schedule per (word, skill); never written to Anki.
- Sentences from Anki, your texts, validated AI sentences and Tatoeba ([algorithms.md §4](algorithms.md#4-practice)).

### Grammar (M5)

- 24 Dutch topic pages (`packages/content`, built into `@app/content`); every detector topic has a page.
- `/grammar`: topics by level with hit counts from your Library; `/grammar/:topic`: explanation, examples from your texts, then Tatoeba, common mistakes, related topics, **Practise**.
- Reader **Grammar** toggle (saved setting): a quiet line under detected constructions; clicking a word shows its topics in the inspector with a link to the page. "Explain this sentence" gets the detected grammar as context.
- **Grammar of this word** (branch `word-grammar`): every clicked word gets 1–3 plain lines on why it has this form (tense and person ending, weak/strong past, participle, separable verb, te/om te, modal/zou/zullen + infinitive, passive, plural, diminutive, de/het, adjective -e, comparative, pronoun case, er/daar + preposition) and, for a finite verb, the word order of its clause (V2, inversion, question, verb-final), each linked to its topic page with "Focus on this". Computed in the browser from the stored analysis (`explainWord` in `@app/core`, no server call); detector notes fill in topics it does not cover. See [algorithms.md §5.1](algorithms.md#51-word-form-explainer).
- Topic exercises reuse the M4 generators (scramble, separable, perfect, de/het, adjective -e) on sentences where the topic was detected.
- Hits are detected once per text by `POST /grammar` and stored as `TextGrammarDetected` events (projection `text_grammar`, schema v4, allow-listed for server storage mode).
- The NLP Docker image precomputes the Tatoeba example cache; at runtime it is read-only.

### Language profile and onboarding ([ADR 0010](adr/0010-language-profile.md))

- **Language profile** per language (`LanguageProfileSet` event, both storage modes): the decks Kenning reads are confirmed by you (detection only suggests), and new words go to per-source decks (`Kenning::Nederlands::Reading`, `::Converse`, `::Stories`; course words per unit or per course). Existing setups are migrated unchanged (old target deck + last synced decks).
- **Sync** reads only the confirmed decks plus Kenning's own and course-mapped decks; with no decks it gives an empty snapshot and a helpful note, not an error.
- **One Add to Anki path** (`addWordToAnki`) for reader, Words from this text, Converse, courses and MCP: one key rule, deck and note type created on first write, tags `kenning`, `nl`, `kenning::from::<source>`. Every Add button names the deck and has a picker.
- **Settings → Language & decks** and a **first-run wizard** (`/welcome`): language, connect Anki, confirm decks or start fresh, where new words go, a quick placement check (app-only), first text.
- MCP `add_to_anki` uses the profile; `KENNING_DECK` is now only an override.

### Learning signals and one command layer ([ADR 0011](adr/0011-learning-signals.md))

- Practice answers, reader cloze answers (new `ClozeAnswered` event) and book exercise answers feed the learner model as **app evidence**: they raise `pKnown` of words Anki does not call known, fade with a 30-day half-life, never demote and never make a word known. Strong evidence shows as **Learning (in Kenning)** in Words and the inspector. Rule and numbers: [algorithms.md §1.7](algorithms.md#17-learning-in-kenning-app-evidence).
- Add, Study first in Anki, Mark known, Use Anki's state and app-only states are one command layer in `@app/anki` (`profile.ts`, `commands.ts`) with one key rule, used by the reader, Words from this text, course units, the placement check and MCP.

### One learning loop (branch `loop`, 2026-11-17)

- **Home** is a 12-column dashboard: Continue reading (cover, excerpt from where you left off, pages read, coverage), Today steps with done states (practise N due, words waiting for Anki, the course unit), Words to learn now, This week (pages, exercises and words added per day from the event log: repository `activity`), Recent texts, the grammar topic seen most in your texts and a Talk prompt. The top bar shows the date.
- **Reader finish** shows a completion panel (new words met, in Anki, still to decide) with Words from this text, Practise these words, Talk about this text and Next text.
- **Words is the hub**: filters in the URL (`/words?state=&source=text:<id>|unit:<course>/<n>|practice-again&q=&word=`) with chips; rows open the shared inspector (same actions as the reader, `useWordActions`); bulk select → Add to Anki (deck picker), Practise these, Talk about these. Linked from Home, Progress, Words from this text, course units and the Practice summary.
- **Practice**: one note on Practice vs Anki, "N exercises due", `/practice?words=` focus sessions, and a summary that leads on (Practise again, Review these words, Talk about these words, Next text).
- **Talk**: seeded with `?words=&topic=`, sentence-case titles, Save to Library (text source kind `talk`); "Converse" labels say Talk.
- **Settings**: sections (Account, Language & decks, Reading, AI, Data & backup, Advanced) with a sub-nav, autosave and a quiet Saved note; Anki connection and Sync at the top of Language & decks.
- **Library** is a shelf with generated covers per source kind and Continue · page N of M; one page header (title, purpose, primary action) on Library, Practice, Words, Courses, Grammar, Talk, Settings and Progress. Favicon PNGs use the dark tile.

### Exam preparation (branch `exam`, 2026-11-18)

- **Exam** (`/exam`, one nav entry): the A2 inburgeringsexamen at a glance (parts, formats, official durations, estimated pass rules, "last checked 18 November 2026", links to inburgeren.nl/DUO/IND and the official practice exams). Research: [research/08](research/08-inburgering-a2.md); details: [exam.md](exam.md).
- Practice (instant feedback) and timed mock exams for **Lezen, Luisteren** (Dutch Web Speech voice, speed control, two plays in exam mode, transcript after), **Schrijven** (checklist, model answer, grammar links, optional AI feedback), **Spreken** (per-question clock, in-memory recording, model answer, optional AI feedback on a transcript) and **KNM** (by theme or as a 40-question mock).
- Original content in `packages/content/exam/nl-a2` (validated at build): 50 reading and 48 listening questions, 8 writing tasks, 20 speaking prompts, 88 KNM questions over the 8 official themes.
- Results are `ExamAttempt` events (`examAttempts` projection, RPC + HTTP); missed words → Add to Anki / Practise these; an _Exam prep_ step in Home's Today once started; optional AI-written Lezen/Luisteren items with the coverage check.

### Self-hosting polish (branch `selfhost`, 2026-11-18)

- **CI** builds the three images on every PR and push (no push), starts the Dockge stack from them and runs `scripts/doctor.sh` as the smoke test (page, CSP, `/api/health`, 401 without sign-in, sign-in, `/api/info`, `/nlp/health` with data presence, sign-out); image sizes and users in the job summary, non-root enforced.
- **images.yml**: one matrix job; `edge` + `sha-<commit>` on pushes to `main`, `X.Y.Z`, `X.Y`, `latest` on `v*` tags; amd64 + arm64; the web image carries the commit.
- **Images**: pinned bases (node 26.13.1, nginx 1.30.6, python 3.12.16, uv 0.13.9; Dependabot keeps them current), `pnpm fetch` layer caching, unprivileged nginx with `nginx -t` at build time, Alpine api runtime with only `dist/` + production `node_modules`, a tighter `.dockerignore`.
- **First run**: Settings > Advanced > **Server status** (version, data, database, sign-in, language server data files, Anki from this browser, secure context, Copy); `scripts/doctor.sh`; NLP `/health` reports its data files; [Dockge quick card](../deploy/dockge/README.md).
- **Backups**: optional `backup` compose service (profile) with interval and retention; cron recipe; restore documented.
- **Motion** refined within the budget (see [design-system.md](design/design-system.md#motion-budget)); the page grid no longer animates when the inspector opens, so the reader text never reflows in motion.
- **Cleanup**: shared `format.ts` (`pct`, `plural`, `formatBytes`), unused exports removed in screens/theme/exam, quiet test output (jsdom `scrollTo` and download navigation stubbed).

### Library bookshelf (branch `library`, 2026-11-18)

- **Edit details:** title, author, source note and level from a cover's "…" menu (and `updateTextMeta` for the reader). `TextMetaUpdated` event, last write wins per field by HLC, projected into `text_meta`; Home, Continue reading, the reader and search use the edited title ("Use imported title" restores it).
- **Covers:** PDF and photo imports get their first page / the photo as a cover (NLP `POST /thumbnail`, 600×750 WebP; best effort). "Change cover…" takes your own photo with a small 4:5 cropper (drag/arrow keys, zoom), saved as a 600px WebP; "Use plain cover" goes back to the typographic one. `TextCoverSet {textId, blobId|null}`. Images are content-addressed rows of a `blobs` table inside the database (browser: the OPFS file; server: `POST /api/blobs`, `GET /api/blobs/:id`, auth-gated, 2 MB cap), so backups carry them in both modes and `rebuild` keeps them.
- **Shelves:** your own shelves (create, rename, delete; add/remove from the cover menu, by multi-select, or by dragging covers onto a shelf on desktop; a text can be on several) plus automatic ones: Reading now, To read, Finished, and by source (Course books, AI stories, Web, Photos & PDFs, Talk). `ShelfCreated/Renamed/Deleted`, `ShelfTextAdded/Removed`, folded from the log in HLC order (`repo.shelves()`, on the RPC allow-list).
- **Layout:** sideways-scrolling shelf rows with snap and a hairline shelf board, one tab stop per row and arrow keys inside it; an "All texts" grid; search (title, author, note, level; accent-blind); sort by recent, title or coverage. `?demo` seeds three shelves and three image covers.
- Not done: og:image covers for web pages (needs a server-side image fetch), course book page covers (pages are not stored), image covers on Home, orphaned blob clean-up.

### Desktop app, offline (branch `desktop-offline`, 2026-11-18; plan D4)

- **Offline is the default first start**: the bundled home page boots the whole app (`apps/web/src/desktop/local.ts`); "Connect to a Kenning server" moved to Settings > Your data (and the Connect screen offers "Use on this computer"). `desktop.json` gains `mode` and `database`; installs with a saved `serverUrl` keep opening their server.
- **Data**: one SQLite file, `~/Documents/Kenning/kenning.sqlite` (Windows `Documents\Kenning`), opened by Rust (rusqlite, rollback journal) behind the shared `SqlDriver` (`@app/db/native`: JSON IPC, blobs/bigints encoded); same schema, migrations, projections and backup/restore as the browser worker. Settings > Your data: path, Show in folder, Move… (consistent copy with `VACUUM INTO`, switch, old file kept). `kenning.sqlite.lock` (host, pid, last seen) warns when another computer has the file open (Open anyway / Try again); sync-tool conflict copies are named in a notice.
- **Language server sidecar**: `server/nlp/desktop/build_sidecar.py` + `kenning-nlp.spec` (PyInstaller onedir, trimmed like the slim image, no Tesseract; 445 MB unpacked on Linux), bundled as a Tauri resource (`tauri.sidecar.conf.json`). Started on a free 127.0.0.1 port with a random token (`KENNING_NLP_TOKEN`, checked by a new middleware), stopped on exit and when stdin closes (app crash). The page's `/nlp/...` goes to the `kenning-nlp:` protocol, a Rust proxy that adds the token, waits while the server starts, and holds analysis while the dictionary downloads. Packs: `KENNING_PACKS=download` into the app data dir; `/health` now reports download bytes; a calm line above every page shows "Downloading the Dutch dictionary… 14 MB" with progress and Try again. Offline installer variant bundles the archives (`tauri.packs.conf.json`, `KENNING_PACKS_DIR`).
- **OCR**: Import hides Photo and explains when `/health` says `ocr: false` (PDF with text, URL and paste work).
- **CI**: the Desktop workflow builds the sidecar per OS (ubuntu-22.04, windows, macOS arm64 and Intel as separate .dmg; uv cache) before tauri-action, plus an `offline` job (`Kenning_offline_*` assets).
- **Verified locally** (Linux): `tauri build` AppImage + deb; `kenning --self-test` with a temporary HOME: sidecar up, packs installed, a sentence analysed through the page's `/nlp` route, the database file created in `~/Documents/Kenning`, sidecar gone after exit.
- Tests: Rust (`db.rs` values/scripts/backup checks/lock/conflict names, `sidecar.rs` start/fail/ready/env, `proxy.rs` origins, config default, move target), TS (`packages/db/src/native.test.ts` with the shared repository; `apps/web/src/desktop/offline.test.tsx`: first start, lock, setup card, OCR hidden, Settings data file), Python (`test_sidecar.py`, pack progress).
- Not done: TypeScript lite NLP fallback when the sidecar is missing; Windows/macOS builds only verified by CI (not run yet); the public `packs-<version>` release must exist (the repository is private, so first-start downloads 404 until it is published); code signing (D5).

### Desktop app, thin client (branch `desktop`, 2026-11-18; plan D2 + D3)

- `apps/desktop`: Tauri v2 (crates pinned, `@tauri-apps/cli` 2.12.4). The window starts on the bundled web build and shows a **Connect** screen (address, `/api/health` check from Rust, clear errors; "use on this computer only" placeholder for D4); then it navigates to the server, so cookies, CSRF, CSP and sign-in work unchanged and need no server changes. Single instance, remembered window size, external links in the system browser, downloads to Downloads.
- **Anki without setup**: `window.__KENNING_DESKTOP__.ankiFetch` (init script + Rust `anki_fetch`, only `127.0.0.1/localhost:8765`), granted to the saved server origin by a runtime capability; `browserPlatform()` routes AnkiConnect through it when present. Settings > Account: "Change server…".
- **Packaging**: `.github/workflows/desktop.yml` (`v*` tags, manual) with `tauri-action` (pinned): ubuntu-22.04 AppImage + .deb, windows NSIS + .msi, macOS universal .dmg (ad-hoc signed, not notarised); draft release. Unsigned (SmartScreen / Gatekeeper steps in [desktop.md](desktop.md)).
- **Updates**: updater plugin, feed URL from `KENNING_UPDATE_URL` (build) or `desktop.json`; asks before installing. Key pair generated outside the repo; secrets and `latest.json` hosting in [desktop.md](desktop.md#updates).
- Tests: web `src/desktop/desktop.test.tsx` (detection, Anki bridge with the real client, Connect flows); Rust unit tests for address normalisation and the Anki allow-list (`cargo test`).

### Review fixes applied

- **NLP:** lemma precision, UTF-16 offsets, request size limits, one shared key-normalisation rule (Python = TypeScript), particle and R-pronoun false positives.
- **Data:**
  - Clozes are no longer wiped silently when the dictionary is down.
  - One analysis per text, even when opened twice at once.
  - Failed imports are rolled back.
  - Windows line endings handled.
  - The AnkiConnect key is kept out of the event log.
  - Your own deck is always included in the sync.
  - A word you added isn't demoted by the next sync.
  - Glosses are matched by part of speech.
- **UI:**
  - Reader state no longer leaks between texts.
  - Inspector actions can't hit the previously selected word.
  - Banners for unsaved data (private window / second tab) and for demo mode.
  - Errors shown with Retry instead of failing silently.
  - Resume continues at the next unread page.
  - Accurate cloze credit: unanswered or revealed blanks = 0, finished pages aren't resubmitted.
  - Particles are no longer double-clozed.
  - Keyboard handling respects sliders, tabs and dialogs; Esc respects overlays.
  - The Translations dial saves reliably.
  - Mobile header fits at 390 px.
  - The current page's plan is frozen while you read it.
  - Import: separate PDF and photo inputs.
  - Settings test the address you typed.
  - Consistent numbers: "N unknown" in the Library, "N to learn" = amber words in the reader.
  - Database projections are versioned and rebuilt once after an upgrade.

## To do next

### Decisions needed from you

None open. (The cloze range was settled at recall 0.60–0.99.)

### Your requests (2026-11-17)

- [x] **Gloss mode: optional blanks.** Off by default; the "Blanks off/on" button in the Gloss toolbar is saved.
- [x] **More cloze help.** Meaning tooltip on focus (it stays visible once you ask for help) → first letter → first half of the word → reveal. Credit 1 / 0.5 / 0.25 / 0.
- [x] **No clozes on function words** (_met, de, hij, …_). Only content words are blanked.
- [x] **Every word should have a meaning, also when it is not in Anki.** Compounds are translated from their parts (100% coverage on a 5-paragraph news text), and the inspector and the end-of-text list show the **sentence translated** by an offline model (OPUS-MT nl→en, on your own server, no key). New Anki cards get it on their back.
  - The dictionary covers about 99% of word tokens in news text; compounds are glossed from their parts (souvenir · shop).
- [ ] **Study first / Mark known on the real Anki.** Built and tested against a fake Anki; your first real click is the first live test.

### Next milestones

- **M6b Weave reading** (not started): English base text with Dutch islands, planner labels, translation port, density slider ([research/06](research/06-weave-reading.md)).
- **Review follow-ups** (event versions, analyzer version and snapshot compaction, server-mode cache invalidation, demo on live services, sync-safe replay, LanguagePack split): [review-2026-11.md §2](review-2026-11.md#2-the-one-product-plan-priority-order).
- **M6 AI** (bring your own key): built, see [ai.md](ai.md).
  - `packages/ai`: OpenAI-compatible and native Anthropic adapters (plain `fetch`, prompt caching on the static prompt), presets (OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Mistral, Ollama, LM Studio), per-device key storage with optional passphrase encryption (never in the event log or backups).
  - Converse screen: vocabulary-constrained conversation (coverage check, one rewrite, inline glosses), corrections of your messages, new-word chips with Add to Anki; history as `ConversationStarted` / `MessageAdded` events (no new table; works in local and server mode).
  - Reader: Explain this sentence, Simplify this page (side by side, re-scored). Hidden without a provider.
  - **AI stories** (Library, grammar topic page, course unit: "Create a story") saved as Library texts with provenance (`source.kind: "ai"`), coverage check with one rewrite and a target-word check; **AI example sentences** for practice ("Fill gaps with AI sentences", max 8 words per session; grammar topics with few hits), each validated by the NLP server before use and stored as `SentencesGenerated` events.
  - `apps/mcp`: stdio MCP server (`get_known_words`, `check_coverage`, `list_texts`, `get_text`, `add_to_anki`) for Claude Desktop / Claude Code.
  - Not yet tried against a real provider (tests use fake providers and a local mock server); model defaults need a first live check. No streaming.
- **Courses** ([design](design/courses.md)): study along a textbook you own, any textbook. C1 built, C2 first version, parts of C3:
  - Import a PDF (text-layer pages skip OCR), an EPUB, page photos or a list of web pages. Scanned pages are OCR'd by the NLP server in a background job (`POST /course/ocr`, parallel Tesseract workers, progress with time left, pages cached by file hash in memory and in `KENNING_COURSE_CACHE_DIR`, up to 400 pages / 200 MB) in the profile's language. The job id is remembered: leaving the wizard and coming back continues the import.
  - Outline from the contents page, running footers, page numbers or unit headings, with unit, exercise and appendix words in several languages; the outline editor shows every page's first lines and sets a unit boundary with **Start a unit here** / **Merge up**.
  - Reading texts and transcripts go to the Library (tagged `course:<id>:<unit>`); the word list becomes each unit's words (entries such as `achternaam (de)` included); units are matched to Anki decks (unit numbers after any unit word, title words; confirmed once; a mapped deck supplies the words when there is no word list).
  - Unit status from the snapshot; **Study first in Anki** (ADR 0007); **Add words to Anki** for a unit or the whole course with a preview (de/het, gloss, a sentence from the book; known and existing notes skipped; deck from the profile rule, per unit the mapped deck; shared AddToAnki picker; `addWordToAnki`).
  - Book exercises (gap fill with derived answers, conjugation tables, sentence building, multiple-choice questions) with Check / Fix answer. Unit words open the shared Words hub inspector; Practice is the shared `/practice?words=`; Talk is seeded with the unit's words; the Grammar tab lists the grammar topics the unit's texts show, linked to topic pages. Home's Today names the course unit and how much of it is known.
  - With an AI provider: **Generate exercises like this unit** (gap fill, sentence building, questions about a text, matching; every sentence validated by the NLP server; stored as `UnitExercisesGenerated`; graded by the book checkers) and a unit story with its words and grammar point.
  - **Real book** (_De Opmaat A2_, 289 scanned pages): OCR 3.5 min on 6 workers, outline 13/13 units right, word lists 99.4 % precision / 97.5 % recall against the user's own deck, every unit matched to its deck. See [courses.md](design/courses.md#real-book-results-2026-11-18).
  - Not yet: course packs; exercise recognition on scans is still weak for gap fills whose blanks the OCR loses (97 of 218 exercises of the real book are shown as text); no page images in the outline editor (first lines only).
- **M7 Sync** (folder / WebDAV / GitHub, encrypted). **M8 Desktop** (Tauri). Then the browser extension, Ukrainian, mobile.

### Known issues / technical debt

- **Staircase:** its _target coverage_ is tracked but not used by the planner yet. Only the new-word budget adapts. Planned use: recommending texts and pages of the right difficulty in the Library.
- **Several devices (server mode):** each device refreshes within ~30 s (or on focus) when another one changed the data (review A7); a practice session waits until it ends. Edits are not merged: the last write of a setting wins.
- **Degraded modes** (language server, Anki, AI, translation, the Kenning server) show as one quiet indicator in the top bar with details and Retry (review A17).
- **One tab only (browser mode):** a second tab now sees "Kenning is open in another tab" with "Use here instead" (Web Locks + BroadcastChannel). A private window still falls back to an in-memory database, with a banner. In server mode (compose) there is no such limit.
- **Language is hard-coded to Dutch** in several places. Ukrainian needs language-aware caches, analysis and dictionaries.
- **Analysis gaps** (recall misses):
  - Some past tenses left unchanged by spaCy (_pleegden_, _wierpen_).
  - "hier/daar … particle" verbs (_groeien hier op_).
  - Reordered idioms (_nodig hebben_).
- **Performance on very long texts:**
  - Plans are recomputed for every text in the Library after changes (now in one batched pass, review A8).
  - Opening a text reads all its tokens (once; then cached until the learner model changes).
  - Every Anki sync stores a full snapshot in the event log; that needs compaction before M7.
- **Deleted texts stay in the event log** until compaction (needed before sync).
- **Concurrent finishes:** `finishSegment` is read-modify-write on the staircase. Not atomic, but harmless with one tab.
- **FSRS-6 decay** per preset isn't read yet; 0.5 is assumed (FSRS is off in your collection).
- **The demo (mock) data** only approximates the real behaviour. A Playwright smoke test (`pnpm e2e`) runs the main loop in demo mode and against the real services in browser-storage mode (fake language server and AnkiConnect).
- **Not yet run here:** the Docker images (no daemon on this machine; CI builds them and runs the smoke test), Tesseract OCR end-to-end on this machine.
- **Data packs depend on pinned upstream data** (Kaikki, Tatoeba, OPUS-MT): when upstream refreshes, building the packs (`scripts/build_packs.py`, the `-full` image, or a server without `KENNING_PACKS_URL`) fails until the pins are updated (`server/nlp/scripts/pinned_download.py`). The standard image no longer depends on them.
