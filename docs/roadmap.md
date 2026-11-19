# Roadmap

## Next

1. **Native mode, round 2.** See below.
2. **Sync.** See below.
3. **Anki in the self-hosted stack.** Headless Anki with your AnkiWeb login, read-only.
4. **Weave reading.** An English text with Dutch islands that grow as you learn.
5. **Phone app.** Native mode and sync; OCR through the phone's own engine (ML Kit on Android,
   Apple Vision on iOS).

## Native mode

Built: the two modes and the onboarding choice, Move from Anki to Kenning, `.apkg`/`.colpkg`
import, the FSRS-6 scheduler tuned to you, and the review screen. Still to do:

- **Move to Anki** (Settings, native mode, one time): new words become notes, known words get
  mature intervals, and, as an experimental option, your review history with real times plus each
  card's due date and interval. The profile then switches to Keep using Anki.
- **Export to `.apkg`** with review history.
- **Workload:** spread across days, lighter days of the week, related cards kept apart, the
  expected daily load shown before changing target recall.
- **Reading evidence.** A due word you met and understood in a text without looking it up counts
  as a light review: its due date moves later by a capped amount. A lookup counts against it.
  Kept out of the optimizer's training data.
- Practice answers and reader clozes feed the same card, so one word has one memory state.
- Due words in Words, review history per word in the inspector, reviews in Home's week.
- Undo beyond the current session.

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
- Connected mode doesn't read FSRS-6 decay per preset; 0.5 is assumed. Native mode uses the
  decay of its own parameters.
- Anki's FSRS parameters are not read from older-format (JSON) deck packages.
- The newer `.apkg` format is tested only with files built from Anki's published format, not with
  a file exported by Anki.
