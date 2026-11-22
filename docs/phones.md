# Vuurtoren on your phone

The phone app is the same app as on your computer. It keeps its own copy of your data and works
offline. What it can't do by itself is prepare a new text, because the Dutch language model is
too big for a phone. Your computer does that for it, or a language server: your own, or later
Vuurtoren Sync.

## What works where

| What                                          | Phone alone | Phone + a language server |
| --------------------------------------------- | :---------: | :-----------------------: |
| Words: reviews, new words, the 5000           |      ✓      |             ✓             |
| Stories, with side by side and grammar marks  |      ✓      |             ✓             |
| Grammar lessons                               |      ✓      |             ✓             |
| A word's meaning from the dictionary          |      ✓      |             ✓             |
| Texts you added on your computer, fully       |      ✓      |             ✓             |
| Recorded audio of words and stories           | phone voice |             ✓             |
| Adding a new text on the phone (paste, photo) |             |             ✓             |
| Sync with your other devices                  |   WebDAV    |             ✓             |

"Fully" means with the meaning of each word in its sentence, the translation of each sentence,
side by side and the grammar marks.

**How the computer helps the phone.** When the desktop app reads a new text, it also prepares
everything the phone needs for it, and sync brings it over with the text. So add a text on your
computer, and read it on your phone, even on a train. This works with every way to sync.

**A text you add on the phone** needs a language server. Without one, it waits: open Vuurtoren
on your computer, and after the next sync the text is ready on your phone too.

## Install

Android: download the `.apk` from the [latest release](https://github.com/pavlohrab/Vuurtoren/releases/latest)
and open it. Your phone asks to allow installs from your browser once.

iPhone: not yet.

## Connect it

Settings → Your devices. See [Sync](guide/sync.md).

Deleting the app deletes its data on the phone. When you install it again it starts fresh; your
data comes back through sync, or from a backup file (Settings → Data & backup).
