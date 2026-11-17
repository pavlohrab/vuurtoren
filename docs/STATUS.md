# Project status — 2026-11-17

Working name **Kenning**: an open-source reader that uses your Anki decks as the record of the words you know. Plan: [roadmap.md](roadmap.md). Decisions: [adr/](adr/).

## How to run (dev)

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
- **Local-first storage:**
  - SQLite in the browser (OPFS), on an append-only event log built for sync.
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
- **Server:**
  - Analysis, language detection, gloss, URL/PDF/OCR endpoints.
  - Size limits and timeouts.
  - Docker images and compose file.
- **Quality:**
  - 214 TypeScript and 242 Python tests (3 OCR tests skip without Tesseract).
  - Three independent reviews; all confirmed High/Critical findings fixed. See below.

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

### Next milestones

- **M3 leftovers:**
  - End-of-text **"Words from this text"** list → add several to Anki at once.
  - Weave reading (English base text with Dutch islands, [research/06](research/06-weave-reading.md)).
- **M4 Practice:** exercises without AI (cloze, meaning, de/het, separable verbs, perfect tense with hebben/zijn, dictation) with their own FSRS scheduler.
- **M5 Grammar:** about 25 Dutch topics, detectors on the analysis, highlighted examples in the reader.
- **M6 AI** (bring your own key): conversation kept to your vocabulary, simplification, MCP server for Claude/ChatGPT subscribers.
- **M7 Sync** (folder / WebDAV / GitHub, encrypted). **M8 Desktop** (Tauri). Then the browser extension, Ukrainian, mobile.

### Known issues / technical debt

- **Staircase:** its _target coverage_ is tracked but not used by the planner yet. Only the new-word budget adapts. Planned use: recommending texts and pages of the right difficulty in the Library.
- **One tab only:** a second tab or a private window falls back to an in-memory database. A banner now says so.
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
