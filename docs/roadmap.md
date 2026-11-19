# Roadmap

## Next

1. **Kenning Cloud.** The hosted service behind sync: accounts, payments and a hosted language
   server for phones. Sync itself is built and works with your own server today.
2. **Anki in the self-hosted stack.** Headless Anki with your AnkiWeb login, read-only.
3. **Weave reading.** An English text with Dutch islands that grow as you learn.
4. **Phone app.** Native mode and sync; OCR through the phone's own engine (ML Kit on Android,
   Apple Vision on iOS).

## Native mode

Built: the two modes and the onboarding choice, Move from Anki to Kenning and Move to Anki,
`.apkg`/`.colpkg` import and `.apkg` export with history, the FSRS-6 scheduler tuned to you,
workload (due dates on the lightest day, review days, related cards apart, the load of each
target recall), reading and Practice as evidence for the cards, due words, review history per
word, and the review screen with undo across sessions.

**Not planned:** a general flashcard editor, Anki add-ons, a card browser beyond Words.

## Sync

Built: your data on every device through your Kenning server, a folder you already sync (desktop
app), WebDAV or a private GitHub repository, encrypted on the device with your passphrase;
latest-wins for settings and marks, merged reviews and answers, event versions, compaction.

- **Kenning Cloud** (paid, about €3–4 a month or €30 a year, lower for students and poorer
  countries): the same sync and a hosted language server for devices that can't run one, such
  as phones. Still to build: accounts, payments, storage limits per account.
- **Before Kenning Cloud:** test runs against a real Nextcloud, GitHub and Syncthing, and an
  outside review of the encryption code. (Argon2id, changing the passphrase and the recovery key
  are built.)
- **Hosting:** one stack of three containers: `kenning` (web app, API and sync), `kenning-nlp`
  (the language server; phones need it) and, only for Keep using Anki, `anki` (headless, read
  only). Self-hosting and Kenning Cloud run the same stack.

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
