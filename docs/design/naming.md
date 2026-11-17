# Naming shortlist

Before deciding, check GitHub org names, `.app`/`.dev`/`.org` domains, app stores and trademarks (EUIPO/USPTO).

| Name            | Why                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| **Kenning** ★   | Dutch _kennen_ "to know", English _ken_; also the Old Norse poetic compound. Short, warm, scholarly. |
| **Wordhoard** ★ | Old English _word-hord_, a treasury of words: your Anki deck as a hoard.                             |
| Marginalia      | Notes in the margins of what you read; reading-first.                                                |
| Lemma           | The dictionary form, the app's core unit; precise and technical.                                     |
| Folio           | A leaf of a book; calm and editorial.                                                                |
| Glossa          | Glosses on texts; classical.                                                                         |
| Anylang         | The current folder name; neutral and descriptive.                                                    |

Recommendation: **Kenning**, with Wordhoard as runner-up. Code uses the neutral scope `@app/*` so renaming is cheap.

# Word states (UI glossary)

One vocabulary for word states on every screen (Library, Reader, inspector, Words, Words from this text, course units). Sentence case everywhere. In code, `<WordStateChip>` and `<AnkiStatusChip>` (`packages/ui/src/WordState.tsx`) are the only way to show them; `WORD_STATE_LABEL` and `ANKI_STATUS_LABEL` hold the words.

| Term         | Internal value             | Meaning                                                                                    | Look                   |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| **Known**    | `known`                    | You know the word (mature in Anki, or marked known).                                       | Teal (accent)          |
| **Learning** | `learning`                 | In progress in Anki or in practice.                                                        | Green (learning line)  |
| **To learn** | planner `introduce` (none) | A new word worth learning now: the amber highlight in the reader, counted as "3 to learn". | Amber fill             |
| **New**      | `unknown`                  | A word you have not learned yet. Counts read "120 new".                                    | Neutral                |
| **Seen**     | `seen`                     | Met while reading, not learned yet.                                                        | Neutral                |
| **Ignored**  | `ignored`                  | Left out of coverage and suggestions (names, English words).                               | Neutral, dashed border |

Anki status is a separate axis, always prefixed so it is never mistaken for a word state:

| Term                   | Internal value | Meaning                                           |
| ---------------------- | -------------- | ------------------------------------------------- |
| **Not in Anki**        | `absent`       | No note for this word in the decks Kenning reads. |
| **In Anki: new**       | `new`          | A card that has never been studied.               |
| **In Anki: learning**  | `learning`     | In Anki's learning steps.                         |
| **In Anki: review**    | `review`       | In review.                                        |
| **In Anki: suspended** | `suspended`    | Suspended in Anki.                                |
| **Anki not reachable** | `unavailable`  | Anki could not be asked.                          |

Related wording:

- **Study first in Anki** (was "Learn next"): moves a word's new card to the front of Anki's queue. The service method stays `learnNext`.
- **Words to learn per page** (reader): the planner's budget of new words highlighted per page. "New words" on the Gloss slider means words in the _New_ state.
- **Coverage** is always labelled with its scope: "This page" (reader top bar) or "Whole text" (Library). The bar is teal: the share of words you know.
- Avoid: "unknown", "Not yet known", "New card", "not in Anki" (lowercase), "Learn next".
