# @app/db

Local-first persistence for Kenning (ADR 0002). An append-only `events` table is the source of
truth; every other table is a projection that `rebuild()` can recreate by replaying the log.

## Entry points

| Import         | Contents                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- |
| `@app/db`      | `createRepository`, schema/migrations, ULID/HLC helpers, `contentHash`, types. No drivers |
| `@app/db/node` | `createNodeDriver(path = ":memory:")` on `node:sqlite` (tests, CLI)                       |
| `@app/db/web`  | `createWebDriver(name = "kenning")`: sqlite-wasm + opfs-sahpool in a dedicated worker     |

The root export never imports `node:sqlite` or the web driver, so apps tree-shake cleanly.

## API

```ts
const repo = await createRepository(driver, { deviceId?, now? });

await repo.append(event);              // event row + projection in one transaction
await repo.listTexts();                // TextSummary[], newest first
await repo.getText(id);                // StoredText | null (content + tokens)
await repo.learnerModel("nl");         // LearnerModel (Map<key, {state, pKnown}>)
await repo.word("nl", "huis");         // WordInfo | null
await repo.words("nl", { state: "learning", query: "hu", limit: 50, offset: 0 });
await repo.staircase("nl");
await repo.setting<T>("key");
await repo.lastSnapshot("nl");         // { at, sources } | null
await repo.events(sinceId?);           // StoredEvent[] in id order (for sync)
await repo.rebuild();                  // truncate projections, replay all events (local only)
await repo.close();
repo.deviceId;
```

Public calls are serialised internally (one connection, no interleaved transactions).

Helpers: `contentHash(text)` (SHA-256 hex of UTF-8, synchronous, pure) is the hash a
`TextAnalyzed` event must carry; `createUlidGenerator`, `createHlc` (`tick`/`receive`),
`compareHlc`, `migrate`.

### Semantics

- **TextImported** stores the text, `wordCount` = number of `/\p{L}+/u` matches. Re-importing an
  id replaces content and drops tokens computed for other content.
- **TextAnalyzed** is applied only if `contentHash` equals the stored content's hash, else ignored.
- **TextDeleted** removes text, tokens and reading progress. Progress for unknown texts is ignored.
- **AnkiSnapshotImported** replaces all `anki_words` of that language (latest snapshot wins).
- **WordStateSet** is last-write-wins per `(lang, key)` by HLC, independent of arrival order.
- **Effective word state** (`word`, `words`, `learnerModel`), first match wins:
  1. override: `known` -> pKnown `max(anki p, 0.95)`; `ignored` -> 1; `unknown` -> 0;
     `learning` -> Anki p if Anki also says learning, else 0.3; `seen` -> 0.1
  2. Anki entry as imported
  3. app-created note (`NoteAddedToAnki`) -> `learning`, 0.2
  4. looked up only (`WordLookedUp`) -> `seen`, 0.1
  5. answered in Kenning only (practice, cloze, book) -> `seen`
  6. otherwise absent

  Below the override, app evidence (`word_evidence`, from `ExerciseAnswered`, `ClozeAnswered`
  and `BookExerciseAnswered` with `keys`) is overlaid with `withAppEvidence` from `@app/core`:
  it can raise pKnown and make a word `learning` (`appLearning: true`), never demotes `known` /
  `ignored`, and fades with the repository clock (ADR 0011).
- **RPC** (`rpc.ts`): only allow-listed methods; `append` accepts known event types up to
  `MAX_RPC_EVENT_CHARS`; `rebuild` is not remotely callable.
- "seen" words **are included** in `learnerModel` (state `seen`, pKnown 0.1); consumers that want
  only known/learning words filter by state.

## Using it in the web app (Vite)

```ts
import { createRepository } from "@app/db";
import { createWebDriver } from "@app/db/web";

const driver = await createWebDriver("kenning");
if (!driver.persistent) showBanner("Private mode: data will not be saved");
export const repo = await createRepository(driver);
```

`vite.config.ts`:

```ts
export default defineConfig({
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
});
```

- `@sqlite.org/sqlite-wasm` must be excluded from dependency pre-bundling, otherwise Vite breaks
  the `new URL("sqlite3.wasm", import.meta.url)` lookup inside it.
- `@app/db/web` creates its worker with
  `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`, the form Vite
  recognises; the worker and the `.wasm` asset are emitted into the build automatically.
- opfs-sahpool needs no COOP/COEP headers, but OPFS needs a secure context (https or localhost).
- Only one tab can hold the OPFS pool at a time; a second tab (or private mode) falls back to an
  in-memory database with `persistent === false`.

## Tests and CLI

```ts
import { createNodeDriver } from "@app/db/node";
const repo = await createRepository(await createNodeDriver("/path/to/kenning.db"));
```

## Limitations

- No cross-device sync yet; `events(sinceId)` and `hlc` are the hooks for it. Remote events are
  not yet ingested (only locally appended ones are applied).
- Projections are computed in JS from a few small tables (`words()` loads all words of a
  language); fine for tens of thousands of words.
- Last-write-wins by HLC is implemented only for word overrides; other projections follow log
  (id) order.
- `PRAGMA user_version` tracks the schema; databases from a newer version are rejected.
