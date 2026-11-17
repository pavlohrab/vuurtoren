# ADR 0011: Learning signals feed the learner model

**Status:** accepted (2026-11-17). Builds on [0003](0003-anki-read-only.md) and [0007](0007-anki-write-actions.md). Fixes review item #2.3 ([review-2026-11.md](../review-2026-11.md)).

**Context:** Practice results, reader cloze answers and book exercise answers never changed a word's state. A word mastered in Practice stayed "New" in the reader. Anki is the record of known words (ADR 0003), and Kenning writes to it only on an explicit click (ADR 0007), so these signals cannot go to Anki either.

**Decision:**

- **Answers are app evidence.** `ExerciseAnswered` (practice), a new `ClozeAnswered {lang, key, correct, hinted, at}` (the first answer per reader blank) and `BookExerciseAnswered` (now with `lang` and the `keys` the item tests) each add to a per-word `word_evidence` projection: weighted correct count (a hinted cloze counts 0.5), wrong count, newest answer time and whether it was correct. The update is a sum plus a max, so it is independent of event order and replays are deterministic.
- **One rule, in `@app/core` (`withAppEvidence`), applied by `composeWord` below the manual mark:** `pApp = 0.8 · c / (c + w + 1) · 0.5^(days since the newest answer / 30)`, halved when the newest answer was wrong.
  - Anki `known` / `ignored` and any manual mark are never changed. App evidence never demotes a word and never makes it `known`.
  - Otherwise `pKnown = max(base, pApp)`. An `unknown`, `seen` or absent word becomes `learning` when at least 3 weighted correct answers, the newest one correct, and `pApp ≥ 0.5`. The UI calls it **"Learning (in Kenning)"** (`WordInfo.appLearning`).
  - Evidence fades with a 30-day half-life, so Anki's state takes over again when the learner stops answering.
- **Anki stays read-only.** Nothing here writes to Anki. To make a card, the learner still clicks Add to Anki or Study first in Anki.
- The domain commands (add, study first, mark known, Anki's state, app-only states) live in `@app/anki` (`profile.ts`, `commands.ts`) with one key rule, so every client records the same events (rest of review item A5).

**Consequences:**

- Schema migration 7 adds `word_evidence`; `PROJECTION_VERSION` 8 rebuilds it from existing `ExerciseAnswered` events, so past practice counts at once.
- `composeWord` and the learner model depend on the clock (for the fade). Projections stay a pure function of the log; tests pass a fixed `now`.
- Older apps skip `ClozeAnswered` (review item A1). The RPC accepts only known event types.
- Passive exposure (reading a word without looking it up) is not evidence yet. The thresholds are a first guess and are documented in [algorithms.md §1.7](../algorithms.md#17-learning-in-kenning-app-evidence).
