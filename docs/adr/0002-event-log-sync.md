# ADR 0002 — Event-sourced local data, encrypted log sync on user-owned storage

**Status:** accepted

**Decision:**

- An append-only `events` table (ULID, device, HLC, type, payload) is the source of truth. SQLite tables are rebuildable projections.
- Sync writes encrypted per-device log files to a pluggable blob store: folder, WebDAV, GitHub, S3, self-host.

**Consequences:**

- No developer-run servers, no general CRDT, zero-knowledge storage.
- The sync engine is ours to test (property tests with shuffled replays).
