# Roadmap

## Next

- **Voice for the cards you create,** made once with your own speech API key (Google Cloud,
  Gemini, OpenAI, ElevenLabs, Azure) and kept locally.

## Then

- **Review reminders.** Opt-in local notifications driven by the due queue, at most one a day,
  with snooze and a hidden-count option.
- **Optional gamification tied to recall.** A weekly goal such as "Review on 3 days", no XP or
  streak loss.

## Later

- **Weave reading.** An English text with Dutch islands that grow as you learn.
- **Vuurtoren Sync.** Sign in on each device and they sync, with nothing to set up.
- **Screen-sized pages.** One screenful per swipe in paged mode, kept across rotation and font
  size.

## Known issues

We're working on these:

- The Windows and macOS installers are built but not yet tested on a real machine.
- When you import a course book, a page can join the page before it, and the outline then says
  "No text on this page".
- A text added on a phone without a language server waits until your computer has prepared
  it. See [On your phone](phones.md).

Hard to fix, because they come from the tools Vuurtoren builds on:

- Reading a photo sometimes glues two words together (_productenwilt_) and reads some tables
  column by column.
- In scanned books, gap-fill exercises can be missed when the scan loses the blanks.
- A few past tenses keep their own form instead of the verb's (_pleegden_, _wierpen_), and verbs
  like _groeien hier op_ are not seen as one verb.
