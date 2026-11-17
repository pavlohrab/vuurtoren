# ADR 0002 — Event-sourced local data, encrypted log sync on user-owned storage

**Status:** accepted

**Decision:**

- An append-only `events` table (ULID, device, HLC, type, payload) is the source of truth. SQLite tables are rebuildable projections.
- Sync writes encrypted per-device log files to a pluggable blob store: folder, WebDAV, GitHub, S3, self-host.

**Consequences:**

- No developer-run servers, no general CRDT, zero-knowledge storage.
- The sync engine is ours to test (property tests with shuffled replays).

**Amendment (2026-11-17, after the 2026-11 review):**

- Sync (M7) is not built yet. The log also lives in one file on the user's own server in server mode (ADR 0008).
- Conflict rules are per projection, not a set union of events: last write wins by HLC for word marks, language profiles and settings; additive sums for app evidence (ADR 0011); "newest `at`" for practice and book answers. Replay is still ordered by ULID, and texts and courses have no tombstones yet; both must change before M7 (review items A2, A3, #9).
- Unknown event types are skipped on replay and rejected on the RPC (review item A1, A13); events carry no version yet.
