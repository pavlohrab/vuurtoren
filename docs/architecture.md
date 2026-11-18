# Architecture

A short map of the code as it is now: which package owns what, how a click reaches the data,
and where to put new code. The why is in the [ADRs](adr/); the algorithms are in
[algorithms.md](algorithms.md).

## Packages

Dependencies point down; nothing in `packages/` imports from `apps/`.

| Package               | Owns                                                                                                                                                                                 | Depends on                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `packages/core`       | Pure domain logic: learner model and evidence, token matching, reading planner and staircase, practice engine and FSRS, courses, language profile, the `InspectorEntry` DTO. No I/O. | —                                     |
| `packages/content`    | Grammar topics and exam content (Markdown, generated and validated at build).                                                                                                        | —                                     |
| `packages/db`         | The append-only event log, projections and the `KenningRepository` API; drivers for browser SQLite (OPFS worker), Node and HTTP (server mode).                                       | core                                  |
| `packages/anki`       | AnkiConnect client, deck detection, snapshots, and the one command layer for Anki writes (add, study first, mark known; ADR 0007).                                                   | core                                  |
| `packages/nlp-client` | HTTP client of `server/nlp` and the cached practice-data source.                                                                                                                     | —                                     |
| `packages/ai`         | Bring-your-own-key providers, prompts, story / sentence / exam generators and their checks, the per-device key store.                                                                | core                                  |
| `packages/ui`         | Design-system components (reader, word inspector, cards, controls). Renders DTOs from core; no services.                                                                             | core                                  |
| `packages/mcp-tools`  | The MCP tools shared by `apps/mcp` (stdio) and `server/api` (HTTP).                                                                                                                  | core, content, db, ai                 |
| `apps/web`            | The React PWA.                                                                                                                                                                       | all of the above                      |
| `apps/desktop`        | Tauri v2 desktop shell: Connect screen host, Anki bridge, updater ([desktop.md](desktop.md)).                                                                                        | (loads apps/web)                      |
| `apps/mcp`            | stdio MCP server.                                                                                                                                                                    | mcp-tools, core, db, anki, nlp-client |
| `server/api`          | Server storage mode: sign-in, one SQLite file behind RPC, HTTP MCP.                                                                                                                  | mcp-tools, core, db, nlp-client       |
| `server/nlp`          | Python language server: analysis (spaCy), dictionary, forms, sentences, grammar detectors, OCR, translation.                                                                         | —                                     |

## apps/web

```
src/
  main.tsx            boot: demo / server mode / browser mode -> AppServices
  router.tsx          routes (lazy screens)
  shell/              app shell, PageHeader, degraded indicator, sign-in, storage screens
  screens/            one folder per area where it has several files:
    courses/ exam/ grammar/ onboarding/ reader/ settings/ words/
    Home, Library, Import, ReaderPage, Practice, Progress, Converse, ...
  services/           everything the screens call (AppServices), see below
  storage/            startup mode, tab lock, local.ts (localStorage helpers)
  practice/           practice engine glue (core generators, speech)
  format.ts           pct, plural, formatBytes
```

Screens only talk to `AppServices` (`services/types.ts`) through `useServices()`. They never
import `@app/db`, `@app/anki` or `@app/nlp-client` directly.

### Services

`createLiveServices(repo, { remoteChanged?, platform? })` in `services/live.ts` is the
composition root. Each domain module gets only what it needs:

| Module              | Domain                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `platform.ts`       | `Platform`: `fetch` and device storage (review A20); `browserPlatform()` by default.                              |
| `liveSettings.ts`   | Settings (secrets in device storage), the NLP and AnkiConnect clients, Anki connection status.                    |
| `liveLearner.ts`    | Learner-model and staircase cache with a version counter (`changed()` makes plans stale).                         |
| `liveDictionary.ts` | Glosses (card gloss, then Wiktionary), sentence translation, both cached.                                         |
| `liveTexts.ts`      | Import, analysis, Library list, reading plans, lookups, cloze answers, finished segments.                         |
| `liveWords.ts`      | Inspector entry, words of a text, word actions, Anki sync, Words list, suggestions.                               |
| `liveProfile.ts`    | Language profile, deck choices, Anki snapshot of the profile's sources.                                           |
| `livePractice.ts`   | Practice sessions, answers, `buildWordData` (shared with courses).                                                |
| `liveGrammar.ts`    | Grammar hits of a text, topic overview and examples.                                                              |
| `liveAI.ts`         | AI config and keys, stories, conversations, AI sentences, exam items.                                             |
| `liveExam.ts`       | Exam attempts.                                                                                                    |
| `liveCourses.ts`    | Composition of `courses/`: `context` (shared lookups), `import`, `packs`, `views`, `anki`, `practice`, `grammar`. |

`mock*.ts` implement the same `AppServices` for `?demo` and for most screen tests (review A6:
replacing them with the live services over a seeded repository is still open).

## Data flow

```mermaid
flowchart LR
  UI["screen"] -->|"AppServices call"| S["services/live*"]
  S -->|"append(event)"| R["KenningRepository<br/>(@app/db)"]
  R -->|"projections"| S
  S -->|"analyze, gloss, grammar"| N["NlpClient -> /nlp"]
  S -->|"explicit click only"| A["@app/anki -> AnkiConnect"]
  S -->|"plans, models"| C["@app/core (pure)"]
  S -->|"BYOK"| AI["@app/ai -> provider"]
```

- **Writes** are events appended to the log (`TextImported`, `NoteAdded`, `ExerciseAnswered`,
  ...). Projections in `@app/db` turn them into tables; nothing writes a table directly.
- **Reads** go through repository queries; the services cache what is expensive (learner model,
  reading plans, glosses) and drop the caches on `changed()` or when another device wrote
  (server mode, `checkRemoteChanges`).
- **Anki** is read for snapshots and live card state; it is written only by the commands in
  `@app/anki` (ADR 0007), each of which also records its event.
- **Degraded modes** (NLP, Anki, AI, translation, storage) report to one signal
  (`services/degraded.ts`) shown in the top bar.

## Checks

- `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm format:check`
- `pnpm e2e`: Playwright smoke test (`apps/web/e2e`) of import, reader, inspector, text size and
  practice, in demo and browser-storage mode, with the language server and AnkiConnect faked.
- `pnpm knip`: unused files, exports and dependencies.
- `npx madge@8.0.0 --circular --extensions ts,tsx <package>/src`: no import cycles (all clean).
- `server/nlp`: `uv run ruff check && uv run ruff format --check && uv run pytest -q`.
