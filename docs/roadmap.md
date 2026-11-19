# Roadmap

## Next

1. **Better word meanings.** Derivations (_-loos_, _-heid_, _-baar_, linking _-e-_/_-s-_) and the
   meaning taken from the aligned sentence translation.
2. **Native mode.** See below.
3. **Sync.** See below.
4. **Anki in the self-hosted stack.** Headless Anki with your AnkiWeb login, read-only.
5. **Weave reading.** An English text with Dutch islands that grow as you learn.
6. **Phone app.** Native mode and sync; OCR through the phone's own engine (ML Kit on Android,
   Apple Vision on iOS).

## Native mode

Kenning holds your cards and runs the reviews itself. Anki becomes optional.

**Two modes, chosen in onboarding and switchable in Settings:**

- **Native** (default for new users): cards live in Kenning. Add to Anki becomes Add to my words.
- **Connected to Anki** (today's mode, unchanged): Anki is the record of known words; Add to
  Anki, Study first and Mark known write to Anki.
- **Native, with Anki as a destination:** reviews happen in Kenning, and new words can also be
  pushed to an Anki deck, for people who keep Anki on another device.

**Import:**

- `.apkg` and `.colpkg` (old and new formats): notes, cards, media and the full review history.
- One deck, several decks or the whole collection. Vocabulary decks are detected the same way as
  in connected mode.
- Switching from connected to native imports the confirmed decks straight from AnkiConnect.
- Export back to `.apkg`, with review history, so leaving Kenning is always possible.

**Scheduler (FSRS-6, `ts-fsrs`):**

- **Tuned to you.** The FSRS optimizer (`fsrs-rs`, compiled to WebAssembly) trains your
  parameters from the imported history and your reviews in Kenning. It runs again by itself
  every 30 days or 500 reviews, and on request in Settings.
- Target retention per deck (default 0.9), with the expected daily load shown before you
  change it.
- Learning and relearning steps, a maximum interval, random spread of due dates.
- Workload spread across days, lighter days of the week, related cards kept apart.
- Imported cards keep their memory state: the history is replayed, nothing restarts.

**What only Kenning can do:**

- **Reading evidence.** A due word you met and understood in a text without looking it up
  counts as a light review: its due date moves later by a capped amount. A lookup counts
  against it. These never replace a real review and are kept out of the optimizer's training
  data.
- Practice answers and reader clozes feed the same card, so one word has one memory state.
- Reviews show the word's sentences from your own texts.

**Review screen:**

- Front, back, Again / Hard / Good / Easy, keys 1–4 and Space, undo.
- Vocabulary and cloze notes rendered natively; images and audio. Other Anki templates are
  shown in a simple fallback view.
- Today's count on Home; due words in Words; review history per word in the inspector.

**Not planned:** a general flashcard editor, Anki add-ons, a card browser beyond Words.

## Sync

Your data on every device, with the event log as the unit of sync.

- **Kenning Cloud** (paid, about €3–4 a month or €30 a year, lower for students and poorer
  countries): end-to-end encrypted sync and a hosted language server for devices that can't run
  one, such as phones.
- **Free alternatives:** your own Kenning server (works today), or a folder you already sync
  (Syncthing, Dropbox, iCloud Drive), WebDAV or a private GitHub repository, all encrypted.
- Conflicts are resolved per kind of data: reviews and answers merge, settings and word marks
  take the latest change.
- Before sync: event versions, compaction of Anki snapshots and deleted texts, and replay in
  clock order across devices.

## Known issues

- Windows and macOS installers are built by CI but not yet tested on a real machine.
- If the desktop data file can't be opened, the app shows the "Can't reach your Kenning server"
  screen instead of a file error.
- In course import a page can merge into the previous one, and the outline then shows "No text
  on this page".
- OCR sometimes glues two words together (_productenwilt_), and reads some tables column by
  column.
- Exercise recognition on scanned books misses gap fills whose blanks the OCR loses.
- spaCy leaves some past tenses unchanged (_pleegden_, _wierpen_) and misses "hier/daar …
  particle" verbs (_groeien hier op_).
- Every Anki sync stores a full snapshot in the event log, and deleted texts stay in it. The log
  needs compaction before sync.
- The staircase tracks a target coverage that the planner doesn't use yet.
- FSRS-6 decay per preset isn't read; 0.5 is assumed.
