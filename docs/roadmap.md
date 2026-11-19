# Roadmap

## Next

1. **OCR review.** Page image and text side by side, doubtful words flagged with suggestions.
2. **Better word meanings.** Derivations (_-loos_, _-heid_, _-baar_, linking _-e-_/_-s-_) and the
   meaning taken from the aligned sentence translation.
3. **Anki in the self-hosted stack.** Headless Anki with your AnkiWeb login, read-only.
4. **Weave reading.** An English text with Dutch islands that grow as you learn.
5. **Sync** between devices without a server (folder, WebDAV, GitHub), encrypted.
6. **Phone app.**

## Known issues

- Windows and macOS installers are built by CI but not yet tested on a real machine.
- The desktop app has no OCR. Photo import appears only if Tesseract is installed.
- If the desktop data file can't be opened, the app shows the "Can't reach your Kenning server"
  screen instead of a file error.
- Exercise recognition on scanned books misses gap fills whose blanks the OCR loses.
- spaCy leaves some past tenses unchanged (_pleegden_, _wierpen_) and misses "hier/daar …
  particle" verbs (_groeien hier op_).
- Every Anki sync stores a full snapshot in the event log, and deleted texts stay in it. The log
  needs compaction before sync.
- The staircase tracks a target coverage that the planner doesn't use yet.
- FSRS-6 decay per preset isn't read; 0.5 is assumed.
