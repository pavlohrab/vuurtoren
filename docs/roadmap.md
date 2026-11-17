# Plan: open-source, Anki-connected language-learning app (web/desktop first)

## Context
The goal is an open-source app that treats the user's **Anki collection as the record of known vocabulary**. From that it:
- turns imported texts (paste, URL, PDF, photo) into **graded reading**: clozes on words being learned, a capped number of new words, difficulty that rises over time;
- generates **exercises without AI**;
- adds **grammar explanations**;
- offers **AI conversation with the user's own key**, kept to known words;
- pushes new words back to Anki.

**Addition: "weave" reading for texts far above level.** Example: a photo of a Dutch philosophy journal.
- The app OCRs it and translates it into English.
- It **leaves some Dutch words untranslated**: words the user knows, plus a budget of unknown words just above their current level. That band moves up as their Anki vocabulary grows.
- At the end, it pushes the chosen new words to Anki. Anki's own sync carries them to AnkiWeb.
- The reverse also works: an English text with some words swapped into Dutch.

This adds a mode and a translation port. The core architecture does not change.

Research (5 agents, 17 Nov 2026) found no product that combines all of this. The closest are Lector, AnkiBase and Migaku. The positioning: "Your Anki deck, turned into a reading and speaking coach."

**User decisions:**
- **Dutch** first, **Ukrainian** next, with grammar explanations for both.
- **React**.
- **Self-hosted web app first**, then the Tauri desktop app with the same layout. Then the Chrome extension. Mobile much later, but the architecture plans for it.
- License **MIT OR Apache-2.0**.

The project folder `/home/pavlo/WORK/PhD/015_anylanguage` is empty and not a git repo. Node 26 and pnpm are installed; Rust/cargo is **not** (needed for Tauri in M8).

---

## Step 0: Write the research and decisions to the folder (first action after approval)
```
docs/
  README.md                     index + one-page summary of findings & decisions
  research/01-market.md         competitors table, gap analysis, positioning, risks
  research/02-anki-integration.md  AnkiConnect v1/legacy, AnkiDroid provider, iOS, .apkg/.colpkg, AnkiWeb ToS, AGPL
  research/03-algorithms.md     ingestion, learner model, graded reading, exercises, distractors, pseudo-code
  research/04-architecture.md   stack comparison, sync design, GitHub limits
  research/05-ai-byok.md        BYOK, Claude-subscription policy, MCP path, constrained conversation
  research/06-weave-reading.md  immersion dial, translation engines, alignment, Anki push flow
  design/design-system.md       tokens, type, color, components, layout (section below)
  design/naming.md              name shortlist
  adr/0001-ts-core-react.md, 0002-event-log-sync.md, 0003-anki-read-only.md,
  adr/0004-python-nlp-service.md, 0005-no-claude-oauth-mcp-instead.md
```
Content comes verbatim from the agent reports already in this conversation, lightly edited, with sources kept.

---

## App names (check GitHub, domains and trademarks before choosing)
| Name | Why |
|---|---|
| **Kenning** ★ | Dutch *kennen* "to know", English *ken*; also the Old Norse poetic compound. Short, warm, scholarly |
| **Wordhoard** ★ | Old English *word-hord*, a treasury of words: your Anki deck as a hoard |
| Marginalia | Notes in the margins of what you read; reading-first |
| Lemma | The dictionary form, the app's core unit; precise and technical |
| Folio | A leaf of a book; calm, editorial |
| Glossa | Glosses on texts; classical |
| Anylang | The current folder name; neutral, descriptive |

Recommendation: **Kenning**, with Wordhoard as runner-up. Code uses a neutral package scope (`@app/*`) so renaming is cheap.

---

## Architecture (web first, nothing mobile-hostile)

> **As built (2026-11-17).** This is the original plan; [STATUS.md](STATUS.md) says what exists. Differences: there is no `packages/sync` (M7 not started) and no `packages/translate` (M6b not started); `packages/content` holds the grammar pages only. `packages/ai` uses plain `fetch` adapters, not the Vercel AI SDK, and API keys are stored per device (localStorage, optional passphrase encryption), not in IndexedDB. `packages/db` uses plain SQL, not Kysely. The NLP client has no lite fallback (review item A14). A **server storage mode** (`server/api`, one SQLite file on your server, ADR 0008) and sign-in (ADR 0009) were added; **Courses** ([design/courses.md](design/courses.md)) and the **language profile** (ADR 0010) are new features; app answers feed the learner model (ADR 0011).

```
packages/core (TS, pure)  ── learner model, graded-reading planner, exercise generators,
                             FSRS scheduler (ts-fsrs), event log + projections, ports
packages/ui (React)        ── design system + feature components (Reader, WordInspector…)
packages/anki              ── AnkiConnect client (v1 JSON-RPC, legacy v6 fallback), .apkg/.colpkg parser
packages/nlp-client        ── NlpPort: server impl (spaCy) + lite fallback (lemma tables, Intl.Segmenter)
packages/ai                ── provider adapters (Vercel AI SDK: OpenAI-compat/Anthropic/Gemini/Ollama),
                              prompt templates, coverage-validation loop
packages/sync              ── encrypted event-log sync engine + adapters (folder, WebDAV, GitHub)
packages/db                ── SQLite schema + migrations (Kysely); drivers: sqlite-wasm/OPFS (web), tauri-plugin-sql
packages/content           ── grammar topic library (Markdown+frontmatter), per-language packs build scripts
apps/web                   ── Vite + React PWA (static, nginx in Docker)
apps/desktop               ── Tauri v2 wrapper (M8)
apps/extension             ── WXT, Chrome then Firefox (Phase 2)
apps/mcp                   ── MCP server exposing learner model to Claude Desktop/Code (M6)
packages/translate         ── TranslationPort: llm (BYOK) | deepl (BYOK) | server (offline MT + alignment)
server/nlp                 ── Python FastAPI: /analyze, /ocr, /pdf, /similar, /translate, /align
                              spaCy nl (+uk later); Argos/OPUS-MT (CTranslate2); SimAlign — MT models optional profile
deploy/compose.yml         ── web + nlp (+ optional WebDAV) — the self-host story
```

**Key decisions**
- **Local-first.** Learner data lives in the browser (SQLite WASM on OPFS) or desktop SQLite. The server is **stateless analysis only**, so self-hosting stays simple and private. _(Superseded in part: ADR 0008 adds an optional server storage mode; the NLP service holds OCR jobs in memory, ADR 0004 amendment.)_
- **NLP runs in Python (spaCy `nl_core_news_md`).** Dutch needs a dependency parse for separable verbs ("Ik bel je morgen **op**" → *opbellen*, via the `compound:prt` relation), for the perfect tense and for word order. **Anki card fields and texts go through the same analyzer**, which is what makes lemma matching reliable. Results are cached by content hash. A lite TS fallback keeps the app usable without the server.
- **Anki is read-only for knowledge.** In-app exercises use the app's own FSRS scheduler. Anki gets writes only for new notes. _(Amended: ADR 0007 adds Study first in Anki and Mark known on explicit clicks; ADR 0011 lets app answers raise the app's own learner model.)_ Never use AnkiWeb sync, and never link rslib (AGPL).
- **Event-sourced data from day one.** `events` (ULID, device, hybrid logical clock, type, payload) is the source of truth; tables are rebuildable projections. Sync adapters arrive in M7 without changing the schema.
- **AI comes from the browser with the user's own key.** No proxy. For Claude subscribers: the MCP server, never OAuth.

**Immersion dial: one reader, one planner, three renderings**

For each segment, the same planner labels every source token with one of four labels:

| Label | Rule |
|---|---|
| **keep-known** | p_known ≥ 0.8 |
| **keep-target** | unknown, frequency rank in the band `[vocab_est, vocab_est + band]`; at most B per segment |
| **gloss** | everything else in Dutch mode |
| **translate** | everything else in weave mode; rare jargon is always translated and never pushed to Anki |

How the labels render:

| Coverage of the text | Default rendering |
|---|---|
| ≥ 95% | **Dutch graded**: clozes on learning words, new words introduced |
| 80–95% | **Dutch + glosses**: rare words glossed inline |
| < 80% (e.g. philosophy journal) | **Weave**: English base, Dutch islands (keep-known + keep-target) |

- The user can override the default with a slider ("Dutch density").
- `band` and `B` grow with the same staircase controller as graded reading.
- **Reverse weave (EN → NL):** same labels on an English source, but Dutch words are inserted for English words whose Dutch equivalent is known or a target. This is useful in the Chrome extension on English pages.

**Translation port.** Mark keep-spans in the source, then translate while preserving them. Three engines, best first:
1. **LLM (user's own key):** "translate to English; copy `<k>…</k>` spans verbatim". Return JSON with the woven sentence plus the alignment `{dutch, english_gloss}` per island. Best quality, handles word order.
2. **DeepL API (user's own key):** `tag_handling=xml` + `ignore_tags=k`, so marked Dutch words pass through untranslated. No alignment code needed.
3. **Offline, no AI, self-hosted:** Argos Translate / OPUS-MT on CTranslate2 (nl↔en, uk↔en). Translate the whole sentence, then align words with SimAlign, then put the Dutch word back in place of its aligned English span. Lower quality, but free and private.

Results are cached per (segment, engine, labels hash), so moving the dial only re-renders and never re-pays.

**Exposures and Anki**
- Every Dutch island seen counts as a passive exposure (a small p_known bump).
- At the end of each text, a **"Words from this text"** review lists keep-target words: lemma, the Dutch source sentence, its English translation, and a checkbox.
- Checked words are added in one batch (`notes.createMany`) to Anki desktop. Anki's own sync takes them to AnkiWeb; the app never talks to AnkiWeb directly, per its ToS.
- Optional auto-add after N exposures.

**OCR for journals:** two-column layout, footnotes, hyphenation. Use Tesseract page-segmentation with column detection (PaddleOCR layout as an upgrade), a dehyphenation and running-header removal pass, and an editable OCR preview.

**Core data (projections)**
- `lexeme(id, lang, lemma, pos, gender)`
- `word_state(lexeme_id, state, p_known, src)`
- `anki_link(lexeme_id, note_id, card_id, ivl, fsrs_s, fsrs_d, last_review)`
- `text(id, lang, title, src, hash)`, `segment(id, text_id, ord, analysis_json, coverage)`
- `exercise_item(lexeme_id|topic_id, skill, fsrs_state)`, `exercise_log`
- `grammar_hit(segment_id, topic_id, span)`
- `rendering(segment_id, mode, base_lang, engine, labels_hash, json)` (translation/weave cache)
- `exposure(lexeme_id, text_id, kind, ts)`
- `conversation`, `message`, `settings`

---

## UI/UX design system: professional, warm, subtle
**Principles:**
- Reading first.
- Quiet by default; information appears on demand.
- No mascots, streak guilt, confetti or gamified badges. Progress is shown with calm charts.
- Keyboard-first and accessible (WCAG AA, reduced-motion respected).

**Typography** (self-hosted via Fontsource, no Google CDN; every face covers **Latin + Cyrillic** for Ukrainian)
- Reading text: **Literata** (variable serif built for long reading), 19–20px, line-height 1.7, max 66ch.
- UI: **Inter** (variable, tabular numbers), 14/15px base.
- Mono and numbers: **JetBrains Mono** (FSRS values, stats).
- Type scale is 1.2 (12 · 14 · 16 · 19 · 23 · 28 · 34).

**Color tokens** (CSS variables in Tailwind v4 `@theme`; dark mode is the warm-charcoal set)
| Token | Light | Dark |
|---|---|---|
| `--bg` paper | #F8F5EF | #181512 |
| `--surface` | #FFFDF9 | #211D19 |
| `--ink` | #1F1B16 | #ECE6DC |
| `--ink-muted` | #6B6259 | #A39A8F |
| `--line` | #E6DED2 | #342E28 |
| `--accent` (deep teal, actions) | #2F6F6A | #6FB3AC |
| `--accent-warm` (terracotta, highlights) | #B5562E | #E08A62 |
| word `new` (amber tint) | #F3E3C3 bg / #9A6A12 underline | muted equivalents |
| word `learning` (sage) | dotted underline #5E8B6B; opacity = 1 − recall | |
| word `known` | no decoration | |
| `--danger` / `--success` | #A63D3D / #3F7D4E | |

Word states use **underlines and soft tints, never bright highlighter blocks** as LingQ does. Clozes are a hairline-bordered blank sized to the word length.

**Shape and motion:**
- Spacing on a 4px grid; radius 6 (controls) and 10 (cards); 1px borders do the work instead of shadows.
- Shadows only on popovers.
- Motion 150–200ms ease-out.
- Icons: Lucide at 1.5px stroke.
- Components: Radix primitives through shadcn/ui, restyled with the tokens above.

**Layout (web and desktop are identical; the extension reuses the panels)**
```
┌────────┬───────────────────────────────────────────┬──────────────────┐
│ Sidebar│  Top bar: title · coverage 96.4% · 5 new  │  Inspector panel │
│ Library│           · mode [Read|Cloze|Gloss] · ⌘K  │  lemma, gloss,   │
│ Read   │                                           │  forms, Anki     │
│ Practice│      centered reading column (66ch)       │  state, recall,  │
│ Converse│      Literata, generous margins           │  grammar tags,   │
│ Words  │                                           │  [Add to Anki]   │
│ Grammar│                                           │  (collapsible)   │
│ Progress│                                          │                  │
│ ⚙      │                                           │                  │
└────────┴───────────────────────────────────────────┴──────────────────┘
```

**Screens**
- **Onboarding:** connect AnkiConnect, pick note type and word field with a live preview of the parsed words, choose language, short placement check.
- **Library:** a card per text showing coverage %, new-word count and a difficulty band.
- **Import:** paste, URL (Mozilla Readability), PDF, photo. An OCR preview lets the user correct text before saving.
- **Reader:** as in the layout above.
- **Practice:** session queue, one exercise per screen; keys 1–4 or Enter.
- **Converse:** chat with a per-message coverage chip, inline corrections and new-word chips (→ Anki).
- **Words:** filterable table.
- **Grammar:** topic reference with "seen in your texts" examples.
- **Progress:** vocabulary estimate, coverage trend, CEFR estimate.
- **Settings:** Anki, AI providers, sync, export.

---

## Milestones (part-time estimates)
**M0, week 1: foundation**
- Step 0 docs.
- `git init`, pnpm workspaces + Turborepo, TS strict, ESLint/Prettier, Vitest, Python (uv, ruff, pytest).
- GitHub Actions CI. LICENSE-MIT and LICENSE-APACHE.

**M1, weeks 2–4: NLP + Anki snapshot (the "is matching reliable?" gate)**
- `server/nlp`: FastAPI `/analyze` (batch). Pipeline: spaCy nl → tokens {surface, lemma, pos, morph, dep, sent, span}, separable-verb merge, compound split hint, proper-noun/number flag.
- `packages/anki`: version detection (v1 → legacy), `notes.search`/`cards.getMany`/`scheduling.get` (FSRS), field picker heuristic, HTML/cloze/sound cleanup.
- `packages/core/learner`: card → lemma → `word_state` (known if interval or stability ≥ 21 days, else learning with p = R).
- **Checkpoint:** run on your Dutch deck and hand-check 100 random mappings; target ≥ 95% correct.

**M2, weeks 3–5 (parallel): design system and app shell**
- Tokens, fonts, themes, base components, three-column layout, routing (TanStack Router), ⌘K palette.
- Component playground (Ladle).

**M3, weeks 5–8: Library, Import, Reader**
- Imports: Readability, pdf.js (client) with a pypdfium2 fallback, Tesseract `nld`/`ukr` OCR on the server.
- Segmenter and coverage scoring.
- Graded-reading planner: target coverage T starts at 0.98, staircase controller, new-word budget, gloss/introduce/cloze selection.
- Word inspector.
- Glosses and forms from the Kaikki (Wiktionary) Dutch dump; de/het gender included.
- **Add to Anki** with a configurable note type: word, sentence, gloss, source.

**M4, weeks 8–11: Practice engine**
- ts-fsrs scheduler per (item, skill).
- Generators:
  - cloze, typed or multiple choice; meaning multiple choice; matching;
  - **de/het**; **separable-verb placement**; **perfectum hebben/zijn**; adjective -e;
  - sentence scramble; dictation (Web Speech TTS);
  - Tatoeba Dutch sentences that contain only known words plus the target ("i+1").
- Distractors: same part of speech and frequency band, plus fastText similarity from `/similar` (top-50k vectors).

**M5, weeks 10–12: Grammar**
- ~25 Dutch topics in `packages/content/grammar/nl/*.md` (word order V2/inversion, subordinate clauses, separable verbs, perfectum, imperfectum, de/het, diminutives, adjective inflection, er, om…te…).
- Rule detectors on spaCy morph/dep produce grammar hits, which show as reader "spotlights" and link to topic pages and topic exercises.
- Optional "Explain this sentence" (AI).

**M6, weeks 12–14: AI layer** _(built, plus AI stories and validated AI example sentences; not yet run against a real provider)_
- Provider settings and presets: OpenRouter, OpenAI, Anthropic, Gemini, Ollama.
- Key storage: web keeps it passphrase-encrypted in IndexedDB; desktop uses the OS keychain. _(Built as per-device localStorage with optional passphrase encryption; see ai.md.)_
- Conversation:
  - prompt carries the frequency band, 200–400 relevant known lemmas and N target words;
  - reply analyzed by `/analyze` → coverage check;
  - at most one rewrite;
  - JSON corrections and new words.
- Text simplification with re-scoring.
- `apps/mcp`: tools `get_known_words`, `check_coverage`, `add_to_anki`, `get_text`.

**Courses (added 2026-11):** study along a textbook you own. C1 (import, OCR, outline, unit words, deck mapping) is built, with a first version of C2 (book exercises, unit practice); see [design/courses.md](design/courses.md).

**M6b, weeks 14–16: Weave reading (immersion dial)** _(not started as of 2026-11-17)_
- Planner labels (`keep-known`/`keep-target`/`translate`) in `packages/core/planner`, unit-tested against fixtures.
- `packages/translate`:
  - LLM engine (JSON: woven text + islands alignment);
  - DeepL engine (`ignore_tags`);
  - server engine: `/translate` with Argos nl→en and en→nl, `/align` with SimAlign + substitution.
- Reader:
  - Dutch-density slider;
  - Dutch islands get a subtle underline, target words the amber tint; hover shows English, click opens the inspector;
  - toggle for a **parallel view** (original | weave) for dense texts.
- End-of-text "Words from this text" review → batch Add to Anki with the source sentence and translation.
- Reverse weave (EN → NL), shared later with the extension.
- **Checkpoint:** photo of a philosophy-journal page →
  - OCR is cleaned;
  - weave at ~10% Dutch;
  - keep-target words are all inside the frequency band;
  - jargon is translated;
  - checked words appear in Anki.

**M7, weeks 16–19: Sync** _(not started; needs review items A1–A4 first)_
- Encrypted event-log files (age/libsodium, Argon2id passphrase): `log/<device>/<seq>.evt`, `snapshots/`, `blobs/`.
- Adapters: folder (File System Access API / Tauri fs), WebDAV, GitHub (one commit per sync, ≥ 5 min interval, compaction).
- Property tests replay shuffled logs.

**M8, weeks 19–21: Desktop (Tauri v2)** _(not started)_
- Install rustup.
- Wrap `apps/web` build; native SQLite driver; keychain; AnkiConnect through the Tauri HTTP plugin (no CORS).
- NLP: connect to a server URL, or a bundled PyInstaller sidecar with `nl_core_news_sm`.
- Releases: AppImage/Flatpak, MSI, DMG.

**Self-host deliverable (ongoing from M1):** `deploy/compose.yml` (nginx web + nlp), Caddy example for HTTPS, docs for whitelisting the site's origin in AnkiConnect.

**Phase 2:**
- Chrome extension (WXT MV3): content script tokenizes pages through the NLP port, inline word states, side panel reusing `WordInspector`, add to Anki, "send page to Library". Then Firefox.
- Extension extras:
  - **Weave any page**: a Dutch page above your level becomes English with Dutch islands.
  - **Reverse weave English pages**: Dutch words swapped in.

**Phase 3: Ukrainian**
- spaCy `uk_core_news` + pymorphy3.
- Stress marks from Wiktionary.
- Grammar topics: 7 cases, aspect pairs, verbs of motion.

**Phase 4:** mobile (Capacitor; AnkiDroid provider; iOS via the desktop-published Anki snapshot).

---

## Verification
- **Unit:**
  - Vitest for learner model, coverage, planner, cloze selection, distractors, FSRS recall (fixtures).
  - pytest for NLP, with Dutch fixtures: separable verbs, perfect tense, diminutives, compounds.
- **Mapping gate (M1):** report script on the real Dutch deck → precision of the card→lemma mapping on a 100-item sample.
- **Integration:** `docker compose up`, open the web app, connect live AnkiConnect, import a NOS.nl article and a phone photo of a page. Check coverage %, clozes on learning words, Add to Anki creating a correct note.
- **E2E:** Playwright smoke tests (onboarding → import → read → practice).
- **Weave:**
  - Planner fixture tests: a given learner model gives deterministic labels, and the target band respects `vocab_est`.
  - Engine contract test: each engine returns every keep-span verbatim; fail if any island is missing.
  - Manual test on a real journal photo.
- **Sync:** two browser profiles syncing through a WebDAV container converge to identical projections.
