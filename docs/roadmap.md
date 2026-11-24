# Roadmap

## Next

- **Voice for the cards you create.** Recordings for the words you add, made once with your own
  speech key (Google Cloud, Gemini, OpenAI, ElevenLabs or Azure) and kept on your device.

## Then

- **Review reminders.** If you turn them on, the app reminds you when you have cards to review, at
  most once a day. You can snooze it, and hide how many cards are waiting.
- **Optional gamification.** A weekly goal, like reviewing on 3 days, without points or a streak
  you can lose.

## Later

- **Weave reading.** An English text with Dutch islands that grow as you learn.
- **Vuurtoren Sync.** Sign in on each device and they sync, with nothing to set up.
- **Screen-sized pages.** In paged mode, one swipe moves one screen, also when you turn the phone
  or change the text size.

## Known issues

We're working on these:

- The Windows and macOS installers are built but not yet tested on a real machine.
- When you import a course book, a page can join the page before it, and the outline then says
  "No text on this page".
- A text added on a phone without a language server waits until your computer has prepared it.
  See [On your phone](phones.md).

Hard to fix, because they come from the tools Vuurtoren builds on:

- Reading a photo sometimes glues two words together (_productenwilt_) and reads some tables
  column by column.
- In scanned books, gap-fill exercises can be missed when the scan loses the blanks.
- A few past tenses keep their own form instead of the verb's (_pleegden_, _wierpen_), and verbs
  like _groeien hier op_ are not seen as one verb.
