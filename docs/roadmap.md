# Roadmap

## Next

1. **Vuurtoren Cloud** is coming: a hosted service behind sync, with accounts and a hosted
   language server for phones.
2. **Anki in the self-hosted stack.** Headless Anki with your AnkiWeb login, read-only.
3. **Weave reading.** An English text with Dutch islands that grow as you learn.
4. **Phone apps.** Android first, then iPhone, from the same Tauri project. See
   [Phones](phones.md).

## Native mode

**Not planned:** a general flashcard editor, Anki add-ons, a card browser beyond Words.

## Sync

- **Vuurtoren Cloud:** the same sync and a hosted language server for devices that can't run one,
  such as phones. To build: accounts, storage limits per account.
- **One device, one data file.** The desktop app refuses a sync folder that holds its own data
  folder, and warns when it sees another computer syncing under its device id (a data file
  copied or shared between computers).
- **Live push.** Devices pull every 15 seconds while open; a server could tell them at once when
  another device wrote.
- **Checks before Vuurtoren Cloud:** a run against a real Nextcloud (the test
  `apps/web/src/sync/real.test.ts` takes its address), and an outside review of the encryption
  code.
- **Hosting:** one stack of three containers: `vuurtoren` (web app, sign-in and sync),
  `vuurtoren-nlp` (the language server; phones need it) and, only for Keep using Anki, `anki`
  (headless, read only). Self-hosting and Vuurtoren Cloud run the same stack.

## Vuurtoren Cloud design

- **Accounts.** One account is one learner, signed in with email and password (scrypt) or a
  passkey. Signing in a device gives it a sync token; the account page lists devices and can
  remove one.
- **Storage.** Object storage (S3-compatible). Every account has its own prefix,
  `accounts/<account id>/`, holding the same layout as any sync place (`vuurtoren/vault.json`,
  `vuurtoren/devices/…`, `vuurtoren/blobs/…`). Files are sealed on the device, as with every sync
  place: the service stores them and cannot read them.
- **Sync API.** The `/api/sync` of a self-hosted server, append-only: a device creates files in
  its own folder and in blobs, and removes only its own folded segments. Nothing overwrites
  another device's file.
- **Tokens bound to devices.** Each token belongs to one device id and one account. It reads the
  whole account and writes only that device's folder and blobs. Removing a device revokes its
  token.
- **Quotas.** Storage per account and requests per minute. Over the storage quota, sending is
  refused with a clear message in Settings → Sync; receiving keeps working, so no device falls
  behind.
- **Hosted language server.** Phones send texts to it for analysis, grammar, translation and
  OCR. Texts sent to the hosted language server are processed and not stored: they live in
  memory for the request, are never written to disk or logs, and the results go straight back
  to the device, which keeps them in its own analysis cache. Requests are counted per account for
  the quota, by size only.
- **Same stack.** Vuurtoren Cloud runs the self-hosted stack with accounts and object storage
  switched on; self-hosting stays single-user and free.

## Known issues

- Windows and macOS installers are built by CI but not tested on a real machine.
- In course import a page can merge into the previous one, and the outline then shows "No text
  on this page".
- OCR sometimes glues two words together (_productenwilt_), and reads some tables column by
  column.
- Exercise recognition on scanned books misses gap fills whose blanks the OCR loses.
- spaCy leaves some past tenses unchanged (_pleegden_, _wierpen_) and misses "hier/daar …
  particle" verbs (_groeien hier op_).
- The staircase tracks a target coverage that the planner doesn't use.
- Connected mode doesn't read FSRS-6 decay per preset; 0.5 is assumed. Native mode uses the
  decay of its own parameters.
- Anki's FSRS parameters are not read from older-format (JSON) deck packages.
