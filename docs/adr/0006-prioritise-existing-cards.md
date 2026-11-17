# ADR 0006 — The app may prioritise existing new cards on explicit request

**Status:** proposed (amends [0003](0003-anki-read-only.md))

**Context:** Many words a reader meets are already in Anki as _new_ cards deep in a large deck, for example "A Frequency Dictionary of Dutch" (4,603 of 5,168 cards new). ADR 0003 allows only new notes, so the app can neither help nor add a duplicate cleanly. See [design/anki-existing-words.md](../design/anki-existing-words.md).

**Decision:**

- Anki stays the read-only source of **knowledge**. The app never answers, resets or reschedules studied cards, and never writes FSRS or memory state or review logs.
- On an **explicit user action** per word, the app may change the **organisation of cards whose type is `new`**:
  - reposition them (`scheduling.repositionNewCards`, `startingFrom: 0`, never `shiftExisting`);
  - unsuspend them;
  - add `kenning::*` tags;
  - move them to the Kenning deck, only if the user opted in.
- Every such write is logged as an `AnkiCardsPrioritized` event with the previous position, deck and suspension state. It can be reverted from the app while the cards are still new.
- These writes need the AnkiConnect v1 API. Without it the app offers only "Open in Anki".
- Adding a separate note for a word that already exists is allowed only as an explicit secondary action, for example for an alias or lemma match.

**Consequences:**

- Reading can feed the user's existing decks without duplicates. The same approach is used by AnkiMorphs "Learn Card Now".
- Changes reach AnkiWeb through the user's normal (incremental) Anki sync.
- More write surface means contract tests against the v1 schema, and manual tests only on a throwaway profile.
