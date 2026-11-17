# 04 — Cross-platform stack & sync (Nov 2026)

## Recommended stack

| Layer          | Choice                                                                             | Why                                                                                              |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Core           | **TypeScript** package, no UI or platform deps                                     | Runs in web, extension, Tauri webview, Capacitor and Node. One toolchain.                        |
| UI             | **React** + Vite; Radix/shadcn                                                     | Shared across web, extension, desktop and mobile.                                                |
| Desktop        | **Tauri v2** (stable desktop since Oct 2024)                                       | Small bundles; Rust escape hatch.                                                                |
| Mobile (later) | **Capacitor 8**                                                                    | Mature, native SQLite. Tauri mobile still has WKWebView quirks and App Store guideline 4.2 risk. |
| Web            | Vite PWA, static, nginx Docker                                                     | Trivial to self-host.                                                                            |
| Extension      | **WXT** (MV3, Chrome + Firefox)                                                    | Active; Plasmo is in maintenance mode (partly per WXT's own docs).                               |
| Local DB       | SQLite everywhere: sqlite-wasm/OPFS (web), tauri-plugin-sql, capacitor-sqlite      | One schema, one set of migrations.                                                               |
| NLP            | Python FastAPI (spaCy) as an optional/self-hosted service, plus a TS lite fallback | spaCy is Python-only; Dutch separable verbs need a dependency parse.                             |

**Why not a Rust core:** two build pipelines, debugging across FFI, WASM start-up cost in the extension service worker. The core is business logic, not hot loops. Escape hatch: individual hot functions in Rust→WASM behind the same TS interface.

**Alternatives considered:**

- Flutter: extensions would need a separate JS codebase.
- KMP/Compose: web is Beta, no extension story.
- Expo: no Linux desktop; web SQLite is alpha.
- Electron: heavy, no mobile.
- MAUI: no Linux or web.
- Dioxus: pre-1.0.

Sources:

- https://v2.tauri.app
- https://ionic.io/blog/announcing-capacitor-8
- https://wxt.dev/guide/resources/compare
- https://takazudo-zudo-tauri.pages.dev/pj/zudo-tauri/docs/mobile/wkwebview-gotchas
- https://kotlinlang.org/docs/multiplatform/supported-platforms.html
- https://docs.expo.dev/versions/v55.0.0/sdk/sqlite/

## Sync design: encrypted append-only event log on user-owned storage

```
events(id ULID, device_id, hlc, type, entity, payload JSON)   -- source of truth
  ReviewLogged, WordStateSet, TextImported, TextProgress, ExerciseAnswered,
  CardExported, SettingChanged, Tombstone
projections (rebuildable): lexeme, word_state, text, segment, token_occurrence, ...
```

- **Merging:**
  - Review and exercise events are a set union; the learner model is a deterministic replay.
  - Mutable fields use last-write-wins per field, ordered by HLC.
  - Deletes are tombstones.
  - **No general CRDT needed.** Loro or Automerge only if collaborative rich text is ever wanted.
- **Vault layout** (needs only list/get/put):
  ```
  /<vault>/manifest.json            (KDF salt, schema version)
  /<vault>/log/<device>/<seq>.evt.age
  /<vault>/snapshots/<hlc>.sqlite.age
  /<vault>/blobs/<sha256>.age
  ```
  Each device writes only its own folder, so there are no storage-level conflicts.
- **Encryption:** client-side age/libsodium with an Argon2id passphrase key, so every backend is zero-knowledge. Prior art: Obsidian's Remotely Save plugin.

| Backend                               | Cost       | Notes                                    |
| ------------------------------------- | ---------- | ---------------------------------------- |
| Local folder (Syncthing/iCloud Drive) | 0          | Desktop/Android; iOS via Files           |
| WebDAV/Nextcloud                      | 0          | Browsers need CORS on the server         |
| GitHub private repo                   | 0          | See limits below                         |
| Dropbox/GDrive app folder             | 0          | OAuth PKCE; Google verification          |
| S3/R2/B2/MinIO                        | user pays  | Simple                                   |
| Self-host server                      | user's box | Same blob API                            |
| Electric/PowerSync                    | Postgres   | Server sees the data; not local-first    |
| Evolu/Jazz/Triplit/Zero               | relay      | Evolu closest in spirit but experimental |
| cr-sqlite                             | —          | Stale since 2024                         |

**GitHub as storage:**

- **Limits:** 5,000 REST requests/hour; secondary limits of ~80 content-creating requests/minute and 500/hour.
  - Write one commit per sync via the Git Data API (blobs → tree → commit → ref).
  - Sync no more often than every 5 minutes or on close.
  - Compact old logs into snapshots; stay far from 50/100 MB files.
- **Auth:** a fine-grained token scoped to one repo, or the device flow (browser CORS is flaky).
- The same adapter can target Gitea/Forgejo.
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api

## Staying free

No developer servers: a static web app, user-owned storage and the user's own AI keys. Costs: Apple developer ($99/yr), Google Play (one-off), F-Droid (free).
