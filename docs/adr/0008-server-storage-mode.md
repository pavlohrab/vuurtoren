# ADR 0008: Server storage mode (one SQLite file on the server)

**Status:** accepted

**Context:** ADR 0002 stores data in the browser (SQLite in OPFS). For self-hosting ("one docker compose and forget") that is wrong: each browser and device has its own isolated database, OPFS needs a secure context (https or localhost), only one tab can open it, and clearing site data deletes everything. Sync (M7) is not built.

**Decision:**

- The self-hosted compose stack gets an `api` service (`server/api`, Node, `node:http`, no framework). It opens `/data/kenning.sqlite` (volume `kenning-data`) with the existing node driver and `createRepository`. Everything stays event-sourced; the single process is the single writer, all calls go through one queue.
- The browser talks to it with `createHttpRepository` (`@app/db/http`), which implements `KenningRepository` over `POST /api/rpc {method, args}`. Only an allow-list of repository methods is callable (`packages/db/src/rpc.ts`); there is no raw SQL endpoint. The learner model's `Map` travels as entries.
- Mode selection at startup: `?demo` wins; else a Kenning `GET /api/health` on the same origin means server mode; else browser OPFS mode (desktop, dev, static hosting).
- Backup/restore exists in both modes: `GET /api/export` (`VACUUM INTO`, consistent), `POST /api/import` (SQLite header, `user_version <= SCHEMA_VERSION`, required tables; temp file then atomic rename under the queue; the old data is kept if validation fails); in the browser, worker ops `export`/`import` (pool `exportFile`/`importDb`, old file restored on rejection). An import always assigns a new `device_id`, keeps events as they are and rebuilds projections (the stored `projection_version` is dropped).
- Auth: optional `KENNING_TOKEN` (bearer). Off by default, the API binds to localhost outside Docker, and in compose only nginx can reach it.
- A database newer than the app (`SchemaTooNewError`) never falls back to demo data: a blocking screen offers a backup download and tells the user to update. Browser mode requests `navigator.storage.persist()`, shows a banner on insecure contexts, and guards against a second tab with Web Locks.

**Consequences:**

- Server mode is the recommended self-host setup: one file to back up, shared by all devices, no OPFS or https dependency for storage. There is no multi-user model; whoever has the token (or network access when it is off) has all the data.
- Two devices in browser mode still do not sync. M7 can reuse the event log either way.
- Large Anki snapshots in the log make the file grow (see "Known issues" in STATUS.md); compaction is still needed.
- Every read is an HTTP round trip. Acceptable on a LAN; revisit with batching if it feels slow.
