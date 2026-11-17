# ADR 0007 — Explicit write actions to Anki: add, learn next, mark known

**Status:** accepted (2026-11-17). Amends [0003](0003-anki-read-only.md); supersedes the proposed [0006](0006-prioritise-existing-cards.md).

**Context:** The app exists to connect reading with Anki. The user decided (2026-11-17):

- A word **not in the decks** → add it to the Kenning deck.
- A word **in the decks as a new card** → the AnkiMorphs approach ("learn now"): front of its deck's new queue. No warning for decks that haven't been studied recently.
- A **suspended** card is unsuspended by Learn next. A **mature suspended** card counts as known.
- **Mark known must be written to Anki too.** That is the purpose of the app. Manual marks can also be reset.

**Decision:** The app writes to Anki **only on an explicit click** per word. Every write is logged as an event and tagged in Anki:

| Situation                 | Action               | AnkiConnect                                                                       | Tag                |
| ------------------------- | -------------------- | --------------------------------------------------------------------------------- | ------------------ |
| not in Anki               | **Add to Anki**      | `addNote` (Kenning Word, Kenning deck)                                            | `kenning`          |
| new or suspended card     | **Learn next**       | `scheduling.repositionNewCards` (startingFrom 0, shiftExisting false) + unsuspend | `kenning::reading` |
| any state, or not in Anki | **Mark known**       | (`addNote` if needed) then set due date with interval ≥ 21 days (`"21-35!"`)      | `kenning::known`   |
| manually marked           | **Use Anki's state** | none (app-side reset)                                                             | —                  |

- Studied cards are only touched by **Mark known**, which is the user's explicit statement. The app never answers cards, never writes review logs, and never changes FSRS parameters.
- A prioritised or added word is treated as "learning (just added)" in the reader until Anki has reviews for it.
- The next Anki sync confirms the change: a word marked known reads back as a mature review card.

**Consequences:**

- Writes require AnkiConnect with the v1 API for repositioning; legacy actions are used where equivalent (`setDueDate`, `unsuspend`, `addTags`).
- Each write is reversible from Anki's browser by tag. App-side undo is a follow-up.
