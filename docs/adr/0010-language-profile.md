# ADR 0010: Language profile, per-source deck routing and onboarding

**Status:** accepted (2026-11-17). Builds on [0007](0007-anki-write-actions.md) (explicit writes only). Fixes review items #1, U1, U2 and most of A5 ([review-2026-11.md](../review-2026-11.md)).

**Context:** One global `Settings.targetDeck` received every Anki write (reader, Words from this text, Converse, course "Add missing words"); the MCP server had its own `KENNING_DECK`. The decks Kenning reads were re-detected on every sync and never confirmed, and course-mapped decks were not forced into the snapshot. New users had no onboarding: with no Dutch decks the sync failed with a raw error. Add to Anki was implemented four times with four key rules.

**Decision:**

- **One language profile per language**, stored as a `LanguageProfileSet` event (whole profile, last write wins by HLC) and projected into `language_profiles`. Read with `repository.languageProfile(lang)`, which is on the RPC allow-list, so it works in browser and server storage modes and the MCP server reads it too. Shape (`@app/core` `LanguageProfile`):
  - `sources`: decks the user **confirmed** (`deck`, optional `modelName`, `wordField`, `sentenceField`, `glossField`). Detection is only a suggestion; missing fields are filled in by detection at sync time.
  - `destinations`: `default` plus optional `reading`, `converse`, `ai`, `mcp` decks.
  - `courseDecks`: `unit` (`Kenning::<Lang>::<Course>::<Unit>`), `course` (`Kenning::<Lang>::<Course>`) or `default`.
  - `tags`: put on every note (the language code).
- **Migration:** a user with no profile but a saved `targetDeck` or a previous snapshot gets `migratedProfile`: the old target deck as the only destination (course words too) and the last snapshot's decks as sources. It is saved once, so nothing changes for them. A user with neither has no profile and sees onboarding.
- **Snapshot:** `profileSources` (`@app/anki`) returns the confirmed sources, every existing destination deck (read with Kenning's own note type) and every deck mapped to a course unit; `buildSnapshot(deps, chosen)` reads exactly those. An empty list is a valid empty snapshot ("start fresh"); only blind detection that finds nothing is an error (`NoSourceDecksError`).
- **One add command:** `addWordToAnki` (`@app/anki`) resolves the deck (`resolveDeck`: picker choice > per-source destination > course rule > default), creates the note type and deck when missing, adds the note (reusing an identical one in that deck), tags it `kenning`, the profile tags and `kenning::from::<source>` (course words also `kenning::course::<slug>::<unit>`), and records `NoteAddedToAnki` with one key rule (`wordKey`: the analysed key if the caller has one, else the headword without article or reflexive pronoun, `normalizeKey`d). Reader, Words from this text, Converse, course units and MCP all use it. ADR 0007 still holds: only explicit clicks write, and only new notes (plus Mark known / Learn next, unchanged).
- **UI:** a shared `AddToAnki` control (`@app/ui`) always names the destination deck and offers a picker (Kenning decks, course decks, other Anki decks, New deck…). Settings has a **Language & decks** section (language, decks Kenning reads with note counts and previews, re-detect, where new words go).
- **Onboarding** at `/welcome` (shown when there is no profile, not in `?demo`, not skipped): language → connect Anki → confirm decks (suggestions pre-ticked, or "start fresh") → where new words go (profile saved here) → placement check for start-fresh users (about 60 frequency-ranked words in four bands; ticked words become app-only manual known marks, never written to Anki) → first text (import or a sample). Skippable; the step and choices persist in `localStorage`.
- **MCP:** `add_to_anki` reads the profile over RPC (`mcp` destination, else default). `KENNING_DECK` remains as an override.

**Consequences:**

- A schema migration adds the `language_profiles` table (rebuilt from the log like every projection). Older apps skip the unknown event (review item A1).
- `Settings.targetDeck` is deprecated and only used for migration; the Target deck field left Settings.
- The domain commands for learn next / mark known still live in the web services (rest of A5).
- Ukrainian is listed but disabled until the NLP side supports it (A16).
