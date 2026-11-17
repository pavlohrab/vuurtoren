# Project status — 2026-11-17

Working name **Kenning**: an open-source reader that uses your Anki decks as the record of the words you know. Plan: [roadmap.md](roadmap.md). Decisions: [adr/](adr/).

## How to run (dev)

One-time data downloads (git-ignored): `cd server/nlp && uv run python scripts/build_dictionary.py && uv run python scripts/fetch_mt_model.py` (34 MB dictionary + 154 MB translation model).

```sh
pnpm install && pnpm build
pnpm nlp            # NLP service on :8000 (spaCy nl, dictionary, OCR*)
pnpm dev            # web app on http://localhost:5173 (proxies /nlp and /anki)
```

- Open Anki desktop with AnkiConnect (add-on `2055492159`), then use **Settings → Sync from Anki**.
- `?demo` shows mock data instead of your own.
- The Wiktionary dictionary (`server/nlp/data/dictionary-nl.sqlite`, 34 MB, git-ignored) is built with `cd server/nlp && uv run python scripts/build_dictionary.py`.
- *OCR of photos needs Tesseract with Dutch data installed locally (the Docker image includes it).
- Self-hosting: [deploy/README.md](../deploy/README.md) (`docker compose -f deploy/compose.yml up --build`).

## Done

### Foundation (M0)

- Monorepo: pnpm + Turborepo, TypeScript (strict), ESLint, Prettier, Vitest, CI.
- Python side: uv, ruff, pytest.
- Licence: MIT OR Apache-2.0.
- Docs: research notes 01–07, design system, naming, ADRs 0001–0007.

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
  - Explicit write actions, per [ADR 0007](adr/0007-anki-write-actions.md): **Add to Anki** (a _Kenning Word_ note with the sentence, in _Kenning::Nederlands_), **Learn next** (moves the new card to the front of its deck, unsuspending it; needs AnkiConnect API v1), **Mark known** (written to Anki as a 21–35 day interval, also for words not in Anki), **Use Anki's state** (drops a manual mark). Every write is logged as an event and tagged `kenning::reading` / `kenning::known`.
  - Ignore (app-only).
- **Words from this text** (`/read/:id/words`, opened by finishing a text, the reader footer or the Library card): highlighted words, looked-up words and optionally translated ones, each with its sentence and live Anki state, one action per row (Add / Learn next / Mark known / Skip) and a single Apply that never stops on a failure.
- **Server:**
  - Analysis, language detection, gloss, URL/PDF/OCR endpoints.
  - Size limits and timeouts.
  - Docker images and compose file.
- **Quality:**
  - 214 TypeScript and 242 Python tests (3 OCR tests skip without Tesseract).
  - Three independent reviews; all confirmed High/Critical findings fixed. See below.

### Grammar (M5)

- 24 Dutch topic pages (`packages/content`, built into `@app/content`); every detector topic has a page.
- `/grammar`: topics by level with hit counts from your Library; `/grammar/:topic`: explanation, examples from your texts, then Tatoeba, common mistakes, related topics, **Practise**.
- Reader **Grammar** toggle (saved setting): a quiet line under detected constructions; clicking a word shows its topics in the inspector with a link to the page. "Explain this sentence" gets the detected grammar as context.
- Topic exercises reuse the M4 generators (scramble, separable, perfect, de/het, adjective -e) on sentences where the topic was detected.
- Hits are detected once per text by `POST /grammar` and stored as `TextGrammarDetected` events (projection `text_grammar`, schema v4, allow-listed for server storage mode).
- The NLP Docker image precomputes the Tatoeba example cache; at runtime it is read-only.

### Language profile and onboarding ([ADR 0010](adr/0010-language-profile.md))

- **Language profile** per language (`LanguageProfileSet` event, both storage modes): the decks Kenning reads are confirmed by you (detection only suggests), and new words go to per-source decks (`Kenning::Nederlands::Reading`, `::Converse`, `::Stories`; course words per unit or per course). Existing setups are migrated unchanged (old target deck + last synced decks).
- **Sync** reads only the confirmed decks plus Kenning's own and course-mapped decks; with no decks it gives an empty snapshot and a helpful note, not an error.
- **One Add to Anki path** (`addWordToAnki`) for reader, Words from this text, Converse, courses and MCP: one key rule, deck and note type created on first write, tags `kenning`, `nl`, `kenning::from::<source>`. Every Add button names the deck and has a picker.
- **Settings → Language & decks** and a **first-run wizard** (`/welcome`): language, connect Anki, confirm decks or start fresh, where new words go, a quick placement check (app-only), first text.
- MCP `add_to_anki` uses the profile; `KENNING_DECK` is now only an override.

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

1. **Cloze range.** Clozes use words with recall 0.70–0.95. With your decks (SM-2) this rarely triggers. Suggested: 0.60–0.99, preferring the shakier words.

### Your requests (2026-11-17)

- [x] **Gloss mode: optional blanks.** Off by default; the "Blanks off/on" button in the Gloss toolbar is saved.
- [x] **More cloze help.** Meaning tooltip on focus (it stays visible once you ask for help) → first letter → first half of the word → reveal. Credit 1 / 0.5 / 0.25 / 0.
- [x] **No clozes on function words** (_met, de, hij, …_). Only content words are blanked.
- [x] **Every word should have a meaning, also when it is not in Anki.** Compounds are translated from their parts (100% coverage on a 5-paragraph news text), and the inspector and the end-of-text list show the **sentence translated** by an offline model (OPUS-MT nl→en, on your own server, no key). New Anki cards get it on their back.
  - The dictionary already covers about 99% of word tokens in news text.
  - **Compounds** (_souvenirwinkel_) get nothing at the moment. In progress: translation from their parts (souvenir · shop).
  - Next: a context-aware sentence translation for the few remaining words, and for choosing the right sense. Options: an offline MT model on the server, or the user's own AI key (M6).
- [ ] **Learn next / Mark known on the real Anki.** Built and tested against a fake Anki; your first real click is the first live test.

### Next milestones

- **M3 leftovers:**
  - Weave reading (English base text with Dutch islands, [research/06](research/06-weave-reading.md)).
- **M4 Practice:** exercises without AI (cloze, meaning, de/het, separable verbs, perfect tense with hebben/zijn, dictation) with their own FSRS scheduler.
  - App side built: Anki example sentences in the snapshot, `ExerciseAnswered` events and `practice_items` projection, practice services (live + mock), Practice screen (start, session with keyboard shortcuts, summary), sidebar due badge and a Progress section. It runs on a temporary engine shim (`apps/web/src/practice/engineShim.ts`); switch `engine.ts` to `@app/core` after merging the real engine.
- **M5 Grammar:** about 25 Dutch topics, detectors on the analysis, highlighted examples in the reader.
- **M6 AI** (bring your own key): built, see [ai.md](ai.md).
  - `packages/ai`: OpenAI-compatible and native Anthropic adapters (plain `fetch`, prompt caching on the static prompt), presets (OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Mistral, Ollama, LM Studio), per-device key storage with optional passphrase encryption (never in the event log or backups).
  - Converse screen: vocabulary-constrained conversation (coverage check, one rewrite, inline glosses), corrections of your messages, new-word chips with Add to Anki; history as `ConversationStarted` / `MessageAdded` events (no new table; works in local and server mode).
  - Reader: Explain this sentence, Simplify this page (side by side, re-scored). Hidden without a provider.
  - `apps/mcp`: stdio MCP server (`get_known_words`, `check_coverage`, `list_texts`, `get_text`, `add_to_anki`) for Claude Desktop / Claude Code.
  - Not yet tried against a real provider (tests use fake providers and a local mock server); model defaults need a first live check. No streaming.
- **Courses** ([design](design/courses.md)): study along a textbook you own. C1 built:
  - Import one PDF or several page photos; the NLP server OCRs it in a background job (`POST /course/ocr`, polled with progress, cached per page, up to 400 pages / 200 MB).
  - Outline detection from the contents page and the theme footers (printed-page offset), with an outline editor that checks page ranges.
  - Reading texts and transcripts go to the Library (tagged `course:<id>:<unit>`); the word list becomes each unit's words; units are matched to Anki decks (fuzzy, confirmed once; a mapped deck supplies the words when there is no word list).
  - Unit status (known / learning / new / not in Anki) from the snapshot, and per unit **Learn next** (ADR 0007: new cards only, repositioned in book order, unsuspended, logged per word) and **Add missing words** (tagged `kenning::course::<book>::<unit>`).
  - Also present, as a first version of C2: book exercises (gap-fill with derived answers, conjugation tables, sentence building, choice) with Check / Fix answer, and unit practice. Events and queries work in both storage modes (`/api/rpc` allow-list).
  - Not yet: a run on the real 289-page book with Tesseract; course packs, "more like this" quality and grammar linkage (C3).
- **M7 Sync** (folder / WebDAV / GitHub, encrypted). **M8 Desktop** (Tauri). Then the browser extension, Ukrainian, mobile.

### Known issues / technical debt

- **Staircase:** its _target coverage_ is tracked but not used by the planner yet. Only the new-word budget adapts. Planned use: recommending texts and pages of the right difficulty in the Library.
- **One tab only (browser mode):** a second tab now sees "Kenning is open in another tab" with "Use here instead" (Web Locks + BroadcastChannel). A private window still falls back to an in-memory database, with a banner. In server mode (compose) there is no such limit.
- **Language is hard-coded to Dutch** in several places. Ukrainian needs language-aware caches, analysis and dictionaries.
- **Analysis gaps** (recall misses):
  - Some past tenses left unchanged by spaCy (_pleegden_, _wierpen_).
  - "hier/daar … particle" verbs (_groeien hier op_).
  - Reordered idioms (_nodig hebben_).
- **Performance on very long texts:**
  - Plans are recomputed for every text in the Library after changes.
  - Opening a text reads all its tokens.
  - Every Anki sync stores a full snapshot in the event log; that needs compaction before M7.
- **Deleted texts stay in the event log** until compaction (needed before sync).
- **Concurrent finishes:** `finishSegment` is read-modify-write on the staircase. Not atomic, but harmless with one tab.
- **FSRS-6 decay** per preset isn't read yet; 0.5 is assumed (FSRS is off in your collection).
- **The demo (mock) data** only approximates the real behaviour.
- **Not yet built:** Docker images (compose validated only), Tesseract OCR end-to-end on this machine, the GitHub/CI run itself (local gates pass).
