# 02 — Anki integration (verified 17 Nov 2026)

**Summary:**

- **Desktop / extension:** AnkiConnect.
- **Android:** AnkiDroid ContentProvider. Since 2.25 it includes FSRS fields; it has no review log.
- **iOS:** AnkiMobile can only add notes; there is no read API.
- **AnkiWeb sync:** forbidden for third-party clients.
- Current Anki desktop: 26.09.4 (4 Nov 2026).

## 1. AnkiConnect (add-on 2055492159)

- Moved to https://git.sr.ht/~foosoft/anki-connect; the GitHub repo is archived. Requires Anki ≥ 26.08 and listens on `127.0.0.1:8765`.
- **Legacy API** (`POST /`, `{"action","version":6}`): 122 actions, including:
  - `findCards`, `cardsInfo`, `findNotes`, `notesInfo`, `getIntervals`, `getReviewsOfCards`, `cardReviews`, `addNotes`, `canAddNotesWithErrorDetail`, `storeMediaFile`, `sync`.
  - No FSRS fields.
- **v1 API** (`POST /api/v1`, JSON-RPC 2.0): 94 methods, including:
  - `notes.search/getMany/createMany`, `cards.search/getMany`, `scheduling.get`, `reviews.list` (paged by `afterId`, up to 1000 per page), `packages.export`, `collection.sync`, `api.describe`.
  - Scheduling state includes `fsrsMemory {difficulty, stabilityDays}`, `desiredRetention`, `intervalDays` and `lapses`.
  - Retrievability isn't returned; compute it, or search with `prop:r`, `prop:s`, `prop:d`.
  - Docs: API_V1.md and API_LEGACY.md in the repo.
- **CORS:**
  - Allowed origins live in `webCorsOriginList` (default `http://localhost`).
  - A new origin calls `access.requestPermission`, which shows a prompt in Anki. This is how Yomitan works.
  - Optional `apiKey`: a Bearer token on v1, a `key` field in the body on legacy.
  - A self-hosted https website must be whitelisted by the user (the Jiten approach).
- **Limits:**
  - Desktop only; Anki must be running with the right profile open.
  - Writes fail while that note is open in the editor.
- **Alternative:** Tsunagi (add-on 666370974, experimental), with an AnkiConnect compatibility layer, events and a TS client.

## 2. AnkiWeb & self-hosted sync

- **AnkiWeb terms** allow only Anki, AnkiMobile, AnkiDroid and AnkiUniversal: "does not currently allow access from browser extensions or other third-party clients". The protocol is undocumented and changes. **Do not build on it.** https://ankiweb.net/account/terms
- **Self-hosted sync server** (allowed; https://docs.ankiweb.net/sync-server.html):
  - `anki --syncserver`, `python -m anki.syncserver` or `cargo install anki-sync-server`.
  - Configured with env vars `SYNC_USER1=user:pass`, `SYNC_BASE`.
  - A third-party client must embed rslib's sync code and track its version.
- **Licensing:**
  - Anki is **AGPL-3.0-or-later**. Linking rslib or pylib makes your app AGPL.
  - Talking to AnkiConnect over HTTP, or reading SQLite with your own code, does **not**.
  - AnkiDroid's backend is GPL-3.0.

## 3. Collection files

- `collection.anki2` is SQLite (schema V18). **Open it read-only, and only while Anki is closed.**
- `notes(id, guid, mid, tags, flds)`: fields are joined by `\x1f` and contain HTML.
- `cards(id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, data)`: the `data` JSON holds `s`, `d`, `dr`, `decay`, `lrt`.
- `revlog(id ms, cid, ease, ivl, lastIvl, factor, time, type)`: no FSRS memory.
- `.apkg/.colpkg` are zip files. New-style exports contain `collection.anki21b`, which is **zstd-compressed SQLite**, plus a protobuf `meta`. Media files are zstd-compressed too. A parser needs only zstd + SQLite + protobuf, so it's doable in JS/WASM without the AGPL.
- A generated `.apkg` is a universal way to write new notes, including into AnkiMobile.

## 4. Mobile

- **AnkiDroid provider** `com.ichi2.anki.flashcards`:
  - Permission `com.ichi2.anki.permission.READ_WRITE_DATABASE`; Android 11+ also needs a `<queries>` entry.
  - Reads notes, models, decks and cards. Card columns: `interval`, `queue`, `due`, `reps`, `lapses`, `fsrs_stability`, `fsrs_difficulty`, `fsrs_desired_retention`, `fsrs_decay`, `last_review_time_secs` (2.25+).
  - Writes: `addNotes`, media.
  - No review log.
  - Prior art: AnkiconnectAndroid.
- **AnkiMobile (iOS):** URL schemes only.
  - `anki://x-callback-url/addnote?type=&deck=&fld<Name>=&tags=` adds one note at a time.
  - `infoForAdding` returns names via the pasteboard.
  - **No read API.** https://docs.ankiweb.net/ankimobile/url-schemes
- **iOS strategy for us:** the desktop app or self-host server publishes an "Anki snapshot" into the app's own sync vault, and mobile reads that.

## 5. Embedding rslib

It works: AnkiDroid uses it over JNI, and Amgi (an iOS app, AGPL) does too. But it brings the AGPL, a big binary and version tracking, and syncs legitimately only with a self-hosted server. **Not for us**; write our own `.apkg` parser instead.

## 6. Mapping cards to words

- **Pick the field per note type**, using a heuristic: short values (1–3 tokens), names like Word/Expression/Front/Target, unique across notes. Fall back to the sort field. Always let the user confirm with a preview.
- **Clean the field text:** strip HTML, `{{c1::x::hint}}`, `[sound:]`, furigana `漢字[かんじ]` and `<ruby>`. Normalise case and width.
- **Sentence cards:** credit the bold or clozed target word fully, other tokens weakly or not at all.
- **AnkiMorphs reference:** each morph takes the highest interval of any card containing it. `interval_for_known_morphs = 21`. An option uses FSRS stability instead.
- **Thresholds:**
  - **Known:** interval ≥ 21 days, or FSRS S ≥ 21.
  - **Learning:** 1–20 days.
  - Suspended mature cards count as known.
- **Probability model:** R(t) = (1 + f·t/S)^(−decay). For FSRS-4.5/5, f = 19/81 and decay = 0.5; FSRS-6 learns decay per preset.

## 7. Integration matrix

| Platform        | Read                                     | Fallback                            | Write                                 |
| --------------- | ---------------------------------------- | ----------------------------------- | ------------------------------------- |
| Web (self-host) | AnkiConnect (origin whitelist)           | `.colpkg` upload, parsed in WASM/JS | `notes.createMany` / `.apkg` download |
| Desktop (Tauri) | AnkiConnect v1 → legacy                  | Read-only SQLite (Anki closed)      | `notes.createMany`                    |
| Extension       | AnkiConnect + `access.requestPermission` | `.apkg` upload                      | AnkiConnect                           |
| Android         | AnkiDroid provider                       | `.colpkg`                           | Provider `addNotes`                   |
| iOS             | Snapshot from the sync vault             | `.colpkg` via Files                 | `addnote` URL / `.apkg`               |

**Build order:**

1. Snapshot model and mapping engine.
2. AnkiConnect adapter.
3. `.apkg` parser.
4. AnkiDroid plugin.
5. iOS write path.
