# Words that are already in Anki

Status: **implemented per [ADR 0007](../adr/0007-anki-write-actions.md)** (this document is the analysis behind it; the options not chosen there, such as moving cards to the Kenning deck, are not built). Verified against AnkiConnect v1 on Anki 26.08.1 (`api.describe`, read-only calls only).

## 1. Problem

> I meet _boodschap_ while reading. It is already in "A Frequency Dictionary of Dutch", but as a new card at position ~2,950 of 4,603. I want to learn it **now**.

Today the inspector shows a disabled "In Anki" button. In the real collection, both source decks are mostly new: Frequency has 4,603 new and 565 review cards, and Opmaat has 4,452 new and 56 learning or review cards. All decks share the _Default_ preset (30 new/day, gather order _Deck_). So for most words a reader clicks, "In Anki" means "unlikely to be seen for months".

| State of matched card(s)       | Inspector offers                                                    |
| ------------------------------ | ------------------------------------------------------------------- |
| not in Anki                    | **Add to Anki** (unchanged)                                         |
| new, active                    | **Learn next** (primary) · Open in Anki                             |
| new, suspended                 | **Unsuspend & learn next** · Open in Anki                           |
| new, buried                    | info only: "Buried until tomorrow" (no unbury method in either API) |
| new, in a filtered deck        | info only: "In filtered deck X" (reposition is refused there)       |
| learning / relearning          | info: "Learning in Anki". No action                                 |
| review young (< 21 d) / mature | info: "In review, next due …". No action (reading _is_ a review)    |
| suspended, already studied     | info: "Suspended in Anki". Treated as known (research 02)           |
| several notes                  | one action on the **chosen** note, with a deck picker (see §3)      |
| matched only via alias/lemma   | show the Anki headword. Actions + **Add as separate card**          |

Rule: if _any_ matched card is learning or review, the word is "in progress" and we offer nothing that touches scheduling.

## 2. Options

**A. Reposition to the front of the new queue ("Learn next").** v1 `scheduling.repositionNewCards` with `startingFrom: 0`, `shiftExisting: false`. New-card positions are collection-wide (Frequency 566–5838, Opmaat 26–2254). Position 0 puts the card first in _its own deck's_ new queue when gather order is _Deck_ or _Lowest position_. _Random_ gather orders ignore it.

- No duplicate, no change to the user's deck organisation. The card's own deck/template and FSRS stay intact.
- Same as Anki's Browse → Reposition. It is also exactly what AnkiMorphs "Learn Card Now" does (`reposition_new_cards(start=0, shift_existing=False)` + a `learn-now` tag). AnkiMorphs notes that `shift_existing` forces a **full sync**, so we never set it.
- Exact undo: write back the recorded old position.
  − It only shows up if the user studies that deck (or a parent). The per-deck daily limit still applies: if the user has used up today's 30 new cards in Frequency, the card comes tomorrow. Parent limits apply on top (v3 scheduler).
  − Legacy v6 has no reposition action. The only fallback is `setSpecificValueOfCard` on `due` (raw, needs `warning_check`), which we reject. Without v1 the button is unavailable.

**B. Move the card(s) to the Kenning deck** (`cards.move`, legacy `changeDeck`). Answers "sync to the new deck".

- All reading words in one place, with that deck's own new/day limit.
  − Changes the user's deck organisation. Anki keeps no "original deck" for normal decks (`odid` exists only for filtered decks), so we must remember it. A shared-deck update (AnkiHub/CrowdAnki) may move cards back or fight us.
  − Breaks the current snapshot: sources are (deck, note type) pairs, so a moved Frequency note disappears until the Kenning deck is added as a source for that note type.
  − Still needs A, because the card keeps its position 2,950.
  → Opt-in setting only, never the default.

**C. Tag `kenning::reading` (+ optional filtered deck).** `tags.add` on the note.

- Harmless metadata that syncs. It lets the user build their own filtered deck `tag:kenning::reading is:new`. Filtered decks step outside normal daily limits, and cards return home when learning completes.
  − Neither API can create or rebuild filtered decks (`createFilteredDeck` is absent from this AnkiConnect, and v1 `decks.create` takes only a name). So the filtered deck stays a documented manual recipe.
  → Always done together with A, as a marker and for the user's own searches.

**D. Add a separate Kenning note.** Acceptable only when the match is not the same word: an alias/lemma match (_boodschappen_ vs _boodschap_, particle verbs), a different sense or POS, or the user explicitly wants a sentence card from this text. Otherwise it creates duplicate learning, and sibling burying does not work across notes. Offer as secondary "Add as separate card", not default. (Yomitan offers the same choice: prevent / allow duplicate / view existing note.)

**E. Unsuspend** (`cards.setSuspended {suspended:false}`, legacy `unsuspend`). A suspension may be deliberate, so this only happens on explicit click, combined with A for new cards. For suspended studied cards: no action.

**F. Nothing** (status quo). Honest but useless. It stays the behaviour for learning/review cards. "Reset/relearn" (`scheduling.reset`, `setDueDate "0"`) rewrites knowledge state, and we exclude it under ADR 0003.

**Sync / undo.** A, C, E and B are ordinary collection edits (card `mod`/`usn`). They reach AnkiWeb through the user's normal Anki sync, never a full sync (no `shiftExisting`). Anki's own undo (`collection.undo`) only reverts the latest operation, so the app keeps its own undo data in the event log.

## 3. Recommendation

**Default: "Learn next" = C + A (+E when suspended), on explicit click, for new cards only.** B is a setting, "Prioritised words: keep in their deck (default) / move to Kenning deck". D is a secondary button for alias matches.

**Choosing the note** when several match: exact headword before alias; then the deck with the most recent review activity (the one the user actually studies); then the earliest position. The inspector shows "in _A Frequency Dictionary of Dutch_ ▾" so the user can switch. Only one note is prioritised. Learning the same word twice wastes reviews.

**Calls** (v1 JSON-RPC; ids are decimal strings; batched in one request):

1. Read live state, never the stale snapshot. `notes.getMany {ids}` → card ids. `cards.getMany {ids}` → `deck`, `homeDeck`, `scheduling.type/queue/due{kind:"position",position}`.
2. `tags.add {noteIds:[nid], tags:["kenning::reading"]}`
3. if suspended: `cards.setSuspended {ids, suspended:false}`
4. `scheduling.repositionNewCards {cardIds, startingFrom:0, stepSize:1, randomize:false, shiftExisting:false}` → `{changedCount}`
5. (setting B) `decks.create {name}` if missing, then `cards.move {ids, deck:{name:"Kenning::Nederlands"}}`
6. Read-only feedback: `decks.getCounts {deck:{id}}` → "10 new left today in Frequency".

Undo replays the inverse: `repositionNewCards {cardIds:[c], startingFrom:fromPosition}` per card, `cards.move` to `fromDeckId`, `cards.setSuspended true`, `tags.remove`. Undo is refused for any card that is no longer `type:"new"`.

**Event** (new `AppEvent` variant, synced like the others):

```ts
{ type: "AnkiCardsPrioritized"; lang; key; noteId; tag: "kenning::reading";
  cards: { cardId; fromPosition; fromDeckId; wasSuspended }[];
  toPosition: 0; movedToDeck?: string; via: "key" | "alias" }
{ type: "AnkiPrioritizationReverted"; lang; key; noteId; cardIds: number[] }
```

The projection sets `word.prioritizedAt`, and the word counts as "learning soon" (like `NoteAddedToAnki`, pKnown 0.2), so the planner treats it as a target word. Snapshot change: keep per-note matches `{noteId, cardIds, deck, headword, via, cardState}` instead of only merged `noteIds`.

**UI copy**

- new: **Learn next** · _Moves "boodschap" to the front of new cards in A Frequency Dictionary of Dutch. 10 new left today._
- after: **Next in Anki ✓** · _Undo_
- suspended new: **Unsuspend & learn next**
- alias: _Anki has "de boodschap" (matched via lemma)._ **Learn next** · **Add as separate card**
- learning/review: chip _In review · due in 6 days_ (no button); buried: _Buried until tomorrow_
- no v1: _Needs AnkiConnect with API v1 to reorder cards._ **Open in Anki** (`browser.open {query:"nid:…"}` / legacy `guiBrowse`)

**Edge cases.** The note is open in Anki's editor (`editorConflict`): show retry. Random gather order: warn "your deck shows new cards in random order". Card in a filtered deck: reposition refused, show info. Several cards per note (Opmaat has 2 templates): reposition all new cards of the note; sibling burying spaces them. The snapshot is stale relative to Anki: always re-read before writing. Same word prioritised on two devices: idempotent (position 0 again). The user studies a different deck than the one the card lives in: the copy names the deck explicitly.

**Test plan.** Unit tests: state → offered actions table (§1); note choice (exact > alias > recent deck > position); event projection and undo inverse; refusal when the card has left `new`. Contract tests with a mocked fetch: exact JSON-RPC payloads above, partial `items[].error` handling, legacy-only fallback hides the button. Manual, on a **throwaway profile** (never the real collection): reposition a card at position ~3000 → it is first in Study; daily limit exhausted → appears next day; undo restores the position; Anki sync is incremental, not full.

## Open questions

1. Should B ("move to Kenning deck") exist at all, or is A + a filtered-deck recipe enough?
2. Should "Learn next" also apply to notes in decks the user never studies, or should Kenning warn ("you have not studied this deck in 30 days")?
3. Should a mature-but-suspended word stay "known"?
