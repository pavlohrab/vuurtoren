# Courses: study along a textbook, with your own private resources

**Status:** C1 built (2026-11-17), C2 first version, parts of C3 built (2026-11-18): any textbook (PDF with or without text layer, EPUB, page photos, web pages; multilingual outline words; page-strip outline editor), resumable imports, bulk "Add words to Anki" with preview, unit grammar linked to topic pages, and AI exercises per unit (validated, graded by the book checkers). **Tried on the real book** (_De Opmaat A2_, 289 scanned pages): see [Real-book results](#real-book-results-2026-11-18). The design is generic: any book, course PDF, set of photos or web pages.

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

Events: `CourseImported`, `UnitDefined`/`UnitEdited`, `BlocksExtracted`, `BookExerciseExtracted`/`Edited`, `UnitWordsSet`, `BookExerciseAnswered`. As built, a marked book answer carries the word keys the item tests and feeds those words' app evidence in the learner model ([ADR 0011](../adr/0011-learning-signals.md)); it does not create practice FSRS items.

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
- **Practice:** a unit session = book exercises of that unit (interactive) + generated exercises on the unit's words and grammar ("more like this": same types, with Tatoeba sentences and your own texts). Generated exercises go into the same per-word, per-skill FSRS items as normal practice; book exercise answers feed the learner model as app evidence (ADR 0011). Anki reviews are never written.

## UI

- **Courses** (new sidebar entry) → course page: units with progress bars (Anki knowledge + exercises done), "Continue Thema 3".
- **Unit page**, with tabs:
  - **Read:** texts and transcripts in the reader.
  - **Exercises:** book exercises, interactive, with "check" and derived answers marked as such.
  - **Words:** unit vocabulary with Anki status and bulk actions.
  - **Grammar:** the unit's topics with explanation (from the book's appendix, OCR'd, for your own use) and practice.
  - **Practice:** a session for this unit.
- **Import wizard:** upload → OCR progress → outline editor → mapping to Anki decks → done.

## Any textbook (2026-11-18)

Nothing in the pipeline is specific to the example book any more:

- **Sources:** a PDF (pages with a text layer skip OCR; scanned pages are OCR'd), an **EPUB** (each spine document is a page, no OCR), photos of pages, or a list of **web pages** (one unit each, via `/extract/url`). OCR runs in the profile's language (`lang`; Tesseract `nld`, `deu`, `fra`, ... when the language pack is installed; the server answers with an install hint otherwise).
- **Outline**, in this order: the contents page (headings _Inhoud, Contents, Inhalt, Table des matières, Índice, Зміст..._), entries with or without a unit word (_Thema, Chapter, Unit, Lesson, Lektion, Kapitel, Leçon, Unité, Lección, Unidad, Lezione, Urok..._, `course/vocab.ts`); the printed-page offset from running footers, else from page numbers at the top or bottom of pages, else from finding each contents title on the pages. Without a contents page: running footers (_Thema 3 Winkelen 52_), else unit headings at the top of pages (_Lektion 3: Einkaufen_), plus appendix headings (grammar, transcripts, word list) after the last unit. Unit titles keep the book's own word ("Lektion 3 Einkaufen", "Unit 3 Food", or "3 Food").
- **Exercises:** exercise headers in several languages (_Oefening, Opdracht, Exercise, Activity, Task, Übung, Aufgabe, Exercice, Ejercicio, Esercizio, Ćwiczenie, Вправа..._) and English, German, French and Spanish instruction keywords next to the Dutch ones. Multiple-choice questions (a question line followed by lettered options, with the tick boxes OCR reads as `[ |`, `L |`, `«`) become choice items whatever the instruction says. The task line is found below a situation sentence.
- **Outline editor:** the units on the left (title, kind, page range, **Merge up**, Remove) and every page of the book on the right with its first lines; **Start a unit here** on a page splits the unit that holds it (`splitOutlineAt`, `mergeOutlineRow` in core). Page numbers can still be typed.
- **Resume:** the reading job's id is remembered in the browser. Leaving the wizard (or closing the tab) and coming back offers **Continue**; the server keeps a finished job for an hour, and recognised pages are cached on disk (`KENNING_COURSE_CACHE_DIR`, a volume in compose), so even after a server restart choosing the file again is quick.
- **Server:** pages are rendered one at a time and OCR'd by `KENNING_OCR_WORKERS` Tesseract processes (default half the CPUs, at most 6), published in page order, with the time left in the job status.

Tests: two synthetic books (an English coursebook with "Unit N" contents, running headers and a glossary by unit; a German one with no contents page, "Lektion N" headings and "Übung" exercises) in `packages/core/src/course/anybook.test.ts`; text-layer PDF, EPUB, disk cache and order in `server/nlp/tests/test_course.py`.

## Words to Anki

- **Unit page → Add N words to Anki…** opens a preview of the unit's words that are not in Anki: de/het, a gloss (the word list's, else the dictionary's), and **a sentence from the book's pages** that uses the word (lemma or a form sharing its stem). Words you know and words with a note are skipped and counted; each word can be unticked. **Course page → Add all course words to Anki…** does the same over all units, with the same confirm step.
- The deck comes from the language profile (ADR 0010, `courseDecks`): per unit (the Anki deck the unit is mapped to, else `Kenning::<Lang>::<Course>::<Unit>`), per course, or the default deck; the shared AddToAnki picker overrides it. Every note goes through `addWordToAnki` (tags `kenning::course::<book>::<unit>`, the sentence in the Sentence field), logged as `NoteAddedToAnki`.
- **A different book or someone else's deck:** deck suggestions match unit numbers after any unit word ("Thema 03", "Lektion 2", "Unit 3::Words": the deepest level with a number) and title words. For the user's own _De Opmaat A2_ deck (`De Opmaat A2::Thema 01 – Kennismaken` ... `Thema 10 – Nederland en natuur`, 4,508 notes) every unit gets its deck, including the ones whose titles differ (Vervoer ↔ Onderweg, Verleden, heden, toekomst ↔ Nederland en natuur) by number alone.

## AI per unit (only with a provider)

- **Generate exercises like this unit** (Exercises tab): new gap fills, sentence building, questions about a short text and word–meaning matching, made from the kinds the book's unit uses, the unit's words (new ones first) and the grammar point its texts show most. Every sentence is checked by the language server before it is kept (see [ai.md](../ai.md#unit-exercises)); kept exercises are stored as `UnitExercisesGenerated` events, shown under **Made for this unit** and graded by the same checkers as the book's exercises (numbers from 1001).
- **Create a story** on a unit uses the unit's new words and its main grammar point.
- **Grammar tab:** the topics the unit's own sentences show (rule-based detectors, no AI), each linked to its topic page and its practice; the book's grammar notes follow, folded.

## Real-book results (2026-11-18)

_De Opmaat A2_, 106 MB PDF, 289 scanned pages, no text layer, Tesseract 5.5 `nld`, 12-core laptop, 6 workers:

| Step                | Result                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR (`/course/ocr`) | 211 s for 289 pages (was single-threaded); mean word confidence 0.875; importing the same file again (disk cache, through the app's services): 2.4 s                  |
| Outline             | 13 of 13 units right (10 themes, grammar, transcripts, word list): every start page matches the contents, titles from the footers; 73 ms                              |
| Word lists          | 2,210 entries over 10 units vs the user's own deck: precision 99.4 %, recall 97.5 %, de/het right for 97.1 %                                                          |
| Exercises           | 218 recognised: 34 choice (questions with options), 10 gap fill, 1 table, 1 sentence building, 1 matching, 74 open or listening tasks, 97 unknown (shown as text)     |
| Analysis            | 5-13 s: exercises, derived answers and 121 reading texts and transcripts into the Library                                                                             |
| Words to Anki       | Thema 3: 331 words, 326 with a dictionary gloss, 137 with a sentence from the book; the whole course: 1,868 new words, 1,839 glosses, 885 sentences, preview in 1.2 s |
| Grammar             | 2-3 s per unit; ranked against the course: Thema 4 and 5 lead with the perfect tense, Thema 6 with adjective endings and _er_, Thema 7 with _om … te_ and comparison  |

Without the contents page (blanked), the footers alone still give all 10 themes, 6 with the exact first page and the rest one or two pages late (the theme's title page has no footer), and the word list appendix.

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
