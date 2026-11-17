# Courses: study along a textbook, with your own private resources

**Status:** design (2026-11-17). Motivated by learning Dutch with _De Opmaat (NT2 A2)_. The design is generic: any book, course PDF, set of photos or web pages.

## Principles

- **Your resource stays yours.** Imported books live only in your own storage (browser database or your server's volume). Nothing is shipped in the repository or the images, and nothing is uploaded anywhere else. Exporting a "course pack" is your explicit choice, and page images are excluded by default.
- **Structure first, then interactivity.** The app turns a book into units → texts, exercises, word list and grammar points. You can always correct what the importer guessed.
- **Anki stays the memory.** A course unit maps onto your Anki decks (e.g. _De Opmaat A2::Thema 03 – Winkelen_). Course progress _is_ Anki maturity of the unit's words, plus practice results.
- **No AI required.** Rules and the existing NLP do the work. Your own AI key (M6) can help with structuring and with feedback on open writing tasks.

## What the example book looks like (observed, 289 scanned pages, no text layer, no outline)

- **Inhoud:** 10 _Thema's_ (with page numbers), a _Grammatica_ appendix (1 Het verbum: presens, modale verba, perfectum, imperfectum, separabele verba, reflexieve verba, om…te + infinitief; 2 De zinsbouw: hoofdzin, inversie, vraagzin, hoofdzin en bijzin, indirecte rede; 3 pronomen; 4 adjectief; 5 comparatief/superlatief; 6 negatie; 7 pluralis; 8 er), _Transcripten luisterteksten_, _Woordenlijst_.
- **Exercises:** blue "Oefening N" headers, a Dutch instruction line ("Vul de goede vorm van het verbum in.", "Maak het schema compleet.", "Maak zinnen.", "Kies…", "Combineer…"), often a worked _Voorbeeld_, and numbered items with blanks `_____` and a lemma hint in brackets: `Anne _____ (wonen) in Nijmegen.`
- **Footer** with the theme name: "Thema 1 Kennismaken en afspreken 15" → page-to-unit mapping.

## Data model (new events, same event log)

```
Course { id, title, lang, level?, source: {kind: pdf|images|text|url, filename}, created }
Unit   { courseId, n, title, pages: [from, to], ankiDecks: string[] }
Block  { unitId, page, kind: text | exercise | wordlist | grammar | transcript | other, ocrText, bbox? }
BookExercise {
  unitId, number, instruction, type: gapfill | conjugation-table | sentence-building |
      choice | matching | open-task | listening | unknown,
  items: [{ prompt, hint?, answer?, answerSource: book | derived | user, confidence }],
  grammar?: topicId
}
UnitWord { unitId, lemma, article?, pos?, gloss?, source: wordlist | anki | text }
```

Events: `CourseImported`, `UnitDefined`/`UnitEdited`, `BlocksExtracted`, `BookExerciseExtracted`/`Edited`, `UnitWordsSet`, `BookExerciseAnswered` (feeds the same practice FSRS items).

## Import pipeline (server: existing /ocr, /extract/pdf, /analyze)

1. **OCR** (Tesseract `nld`, 300 dpi, per page, in the background with progress). Clean up hyphenation, headers and footers, and blank lines (`_____` → a blank marker). The OCR text is cached per page hash. A 289-page book takes a few minutes on CPU, once.
2. **Outline:** detect the _Inhoud_ page (numbered titles + page numbers) and/or footer theme names → units with page ranges. The **outline editor** lets you confirm or adjust units and ranges in one screen.
3. **Segmentation:** within a unit, split pages into blocks by headers ("Oefening N", "Tekst", "Luisteren", "Lezen", "Grammatica"), and the word list by its two-column layout.
4. **Exercise recognition** (rules, with Dutch instruction keywords + item patterns):
   - **gap-fill with a lemma hint** `X ____ (lemma) Y.` → typed exercise. The answer is **derived**: find the subject (spaCy parse with the blank filled by a placeholder), then conjugate via `/forms` (present / past / perfect from the instruction and context words such as _gisteren_). Flag low confidence. You can correct it once, and it's remembered.
   - **conjugation table** ("Maak het schema compleet", infinitive header row + person rows) → verb-form drills from `/forms`, answers derived.
   - **sentence building** ("Maak zinnen", word chunks separated by `/`) → scramble exercises. Several orders may be valid: accept any order the parser accepts as main clause / inversion with the finite verb in second position, or record the user's answer for review.
   - **choice / matching** ("Kies", "Combineer", lettered options) → multiple choice / matching.
   - **open tasks** ("Schrijf…", "Vertel…", speaking/listening without audio) → shown as book tasks with a notes field. Optional AI feedback later (M6).
   - **unknown** → shown as text with the OCR'd content (still useful while reading the book).
5. **Word list** → unit vocabulary (lemma, article, gloss if present), matched to your Anki notes (exact headword, then lemma).
6. **Reading texts and transcripts** → added to the Library, tagged with course + unit → the existing graded reader (clozes, glosses, Learn next, Words from this text).
7. **Grammar appendix** → grammar topics, linked to units by the topics their exercises practise. This is where M5 (Grammar) plugs in.

## Anki integration

- **Deck mapping:** match unit titles to deck names automatically (fuzzy: "Thema 3 Boodschappen doen en winkelen" ↔ "De Opmaat A2::Thema 03 – Winkelen"). You confirm once.
- **Unit status:** words known / learning / new from the snapshot. "Unit 3: 41 % known, 12 learning, 160 new."
- **Study a unit:** one button runs **Learn next** for the unit's new cards (ADR 0007, logged and undoable), so your Anki sessions follow the book. Unit words that aren't in Anki at all → "Add 18 missing words" (Kenning deck, tagged `kenning::course::<unit>`).
- **Practice:** a unit session = book exercises of that unit (interactive) + generated exercises on the unit's words and grammar ("more like this": same types, with Tatoeba sentences and your own texts). Results go into the same per-word, per-skill FSRS items as normal practice. Anki reviews are never written.

## UI

- **Courses** (new sidebar entry) → course page: units with progress bars (Anki knowledge + exercises done), "Continue Thema 3".
- **Unit page**, with tabs:
  - **Read:** texts and transcripts in the reader.
  - **Exercises:** book exercises, interactive, with "check" and derived answers marked as such.
  - **Words:** unit vocabulary with Anki status and bulk actions.
  - **Grammar:** the unit's topics with explanation (from the book's appendix, OCR'd, for your own use) and practice.
  - **Practice:** a session for this unit.
- **Import wizard:** upload → OCR progress → outline editor → mapping to Anki decks → done.

## Sharing without sharing the book

- **Course pack** = JSON with units, exercise _structures_ and your corrections, without page images or OCR'd prose by default. Someone who owns the same book imports their own PDF and applies the pack to get the corrected structure. Copyrighted text never travels; only coordinates and answers do. Packs can be fully open for free resources (e.g. your own texts, public-domain readers).
- The repository can host **pack schemas and an example pack for a free resource**, never commercial content.

## Phases

- **C1:** Course model + import (PDF/photos) + OCR job + outline detection/editor + texts → Library + word list → unit words + Anki deck mapping + unit status + "Learn next for unit". The value is immediate: the book drives Anki and reading. **About 1–2 weeks** of work.
- **C2:** Book-exercise extraction (gap-fill with derived answers, conjugation tables, sentence building, choice) + exercise UI + unit practice sessions.
- **C3:** "More like this" generation per exercise type, grammar linkage (M5), course packs, optional AI assistance (M6).

## Risks

- **OCR quality on scans** (tables, handwriting in _Voorbeeld_): mitigated by the outline/exercise editor and per-item "fix answer".
- **Derived answers can be wrong** (subject detection, tense). They're shown as derived and are user-correctable; low-confidence items are flagged.
- **Copyright:** personal use only. No shared content beyond structure; packs exclude prose and images by default.
- **Tesseract is needed locally for imports** (the Docker image has it; local dev needs `tesseract` + `nld` data).
