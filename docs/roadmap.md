# Roadmap

## Next

1. **Vuurtoren Sync** at sync.vuurtoren.app: a paid sync place. Sign in, buy, and the device
   becomes the first one to sync; every other device signs in and its data downloads. The same
   flow as a self-hosted server, without hosting anything.
2. **Audio on phones without a server.** One audio pack per voice (about 115 MB) downloaded from
   data.vuurtoren.app and played on the phone; choose female, male or both.
3. **Speech for words without a recording,** made once with your own speech API key (Google
   Cloud, Gemini, OpenAI, ElevenLabs, Azure) and kept with your cards.
4. **Weave reading.** An English text with Dutch islands that grow as you learn.
5. **iPhone,** from the same Tauri project. See [Phones](phones.md).

## Later

From the Android app review (`reports/android-app-review.md`), deferred:

- **Review reminders.** Opt-in local notifications driven by the due queue, at most one a day,
  with snooze and a hidden-count option (review: "First notification design").
- **Gamification tied to recall.** An optional weekly goal such as "Review on 3 days", no XP or
  streak loss (review: "Gamification tied to recall").
- **Screen-sized pages.** One screenful per swipe in paged mode, kept across rotation and font
  size (review: "Reader pages follow text segments").
- **On-device performance.** Measure cold start, first word sheet, answer-to-next-card and
  bridge bytes on a representative phone before more optimising (review: "Measure phone costs").

## Native mode

**Not planned:** a general flashcard editor, Anki add-ons, a card browser beyond Words.

## Sync

- **One device, one data file.** The desktop app refuses a sync folder that holds its own data
  folder, and warns when it sees another computer syncing under its device id.
- **Live push.** Devices pull every 15 seconds while open; a server could tell them at once when
  another device wrote.
- **Checks before Vuurtoren Sync:** a run against a real Nextcloud (the test
  `apps/web/src/sync/real.test.ts` takes its address), and an outside review of the encryption
  code.
- **Texts added on a phone** need the language server. With your own server it analyses them;
  without one, they wait until your desktop app is open and it analyses them, then the result
  syncs back. A hosted language server at vuurtoren.app is possible later, if people ask for it.

## vuurtoren.app

- **data.vuurtoren.app:** the language packs as plain files
  (`packs-<version>/<name>-<version>.tar.gz`). For now a file server on a home server behind a
  Cloudflare Tunnel (`deploy/data-host`); later Cloudflare R2, which charges nothing for
  downloads.
- **sync.vuurtoren.app:** accounts and the sealed sync files.
  - **Sign-in** with an email code (passkeys later): no passwords to store or reset. Signing in
    a device gives it a sync token of its own.
  - **One page,** Your devices: the devices, add one (QR code), remove one, the subscription.
  - **Storage:** every account has its own prefix, `accounts/<account id>/`, with the same layout
    as any sync place. Files are sealed on the device; the service cannot read them.
  - **Sync API:** the `/api/sync` of a self-hosted server, append-only: a device writes only its
    own folder and blobs. Tokens belong to one device and one account.
  - **Quotas:** storage per account and requests per minute. Over the quota, sending is refused
    with a clear message; receiving keeps working.
- **Hosting that scales by itself:** Cloudflare Workers for the API, R2 for the sync files, D1
  for accounts and devices. No servers to run; the cost follows use.
- **Payments:** Paddle or Lemon Squeezy as the merchant of record, so EU VAT and invoices are
  handled for a one-person business.

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
