<p align="center">
  <img alt="Vuurtoren, read Dutch at your level: a lighthouse drawn as a blueprint, its beam lighting the name" src="docs/images/banner.webp">
</p>

<p align="center">
  Vuurtoren helps you learn Dutch by reading. It translates the new words in any text, helps you
  learn them and explains the grammar as you read.
</p>

<p align="center">
  <a href="https://github.com/pavlohrab/Vuurtoren/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/pavlohrab/Vuurtoren/actions/workflows/ci.yml/badge.svg"></a>
  <a href="#licence"><img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-c99a5b"></a>
  <a href="https://ko-fi.com/pavlohrab"><img alt="Support on Ko-fi" src="https://img.shields.io/badge/support-Ko--fi-8f5a1f"></a>
</p>

<p align="center">
  <img alt="A Dutch page in Vuurtoren: a lighthouse's beam passes over it, and the new words get their translations" src="docs/images/demo-reading.webp" width="560">
</p>

<p align="center">
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for macOS" src="https://img.shields.io/badge/Download-macOS-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for Linux" src="https://img.shields.io/badge/Download-Linux-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for Android" src="https://img.shields.io/badge/Download-Android-8f5a1f?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://vuurtoren.app">vuurtoren.app</a> ·
  <a href="docs/guide/quick-start.md">Quick start</a> ·
  <a href="docs/guide/install.md">Install</a> ·
  <a href="docs/README.md">Docs</a>
</p>

## Why I made it

While learning Dutch, I became frustrated that you usually either learn the words or read the
texts, but there is no easy way to integrate the two (one that doesn't involve proprietary data
formats and monthly subscriptions).

That's why I made Vuurtoren. It's free and open source.

Vuurtoren is Dutch for lighthouse: _vuur_, fire, on a _toren_, a tower. The name is a metaphor: the
app doesn't take you through the dark waters of Dutch, but it lights up the path and makes it easier
to find your way.

## What it does

**Reading.** Open a story at your level, a web page, a PDF or a photo of a page from your course
book. Vuurtoren picks a few new words on each page to focus on and, based on the words you know,
translates the rest, so the text stays readable. Tap a word to see its meaning in that sentence,
its grammar and its forms. Side by side puts each sentence next to its English and highlights
each word together with its translation.

<p align="center">
  <img alt="The same page in the four reading modes: Read, Gloss, Cloze and Side by side" src="docs/images/demo-modes.webp">
</p>

**Words.** Every word you tap while reading can become a card, with the sentence you found it
in. Cards are reviewed with FSRS, the scheduler [Anki](https://apps.ankiweb.net/) also offers. Import
the Anki decks you already have, so the app knows your level, or keep reviewing in Anki and use
Vuurtoren only for reading. Starting from zero? Vuurtoren comes with about 5000 of the most common
Dutch words.

<p align="center">
  <img alt="A review card swiped to the right: Good" src="docs/images/demo-swipe.webp" width="420">
</p>

**Grammar and the exam.** Grammar such as inversion, separable verbs and the perfect tense is
marked where it appears in your texts, and the Grammar section explains 63 topics from A1 to C1.
Exercises practise what you read, and mock exams prepare you for the A2 inburgeringsexamen. AI is
there only if you want it, with your own key: stories at your level, sentences explained, a chat
partner who keeps to words you know. See [AI](docs/ai.md) for the setup.

**Your data.** Local-first, open source, with encrypted sync. Your words and texts stay on your
devices and work offline, with no account. When you sync, they are locked with your passphrase
before they leave, through your own server, WebDAV or a synced folder. **Vuurtoren Sync** is
planned: sign in on each device and they sync, with nothing to set up.

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/reader-dark.webp">
        <img alt="Reading: a Dutch text with its new words marked, and the card of the word bel, from opbellen" src="docs/images/reader-light.webp">
      </picture>
      <br><sub>Tap a word: its meaning here, and its grammar</sub>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/words-dark.webp">
        <img alt="Your words: the review of the day and the word list" src="docs/images/words-light.webp">
      </picture>
      <br><sub>Your words and the daily review</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/grammar-dark.webp">
        <img alt="A grammar topic explained with examples" src="docs/images/grammar-light.webp">
      </picture>
      <br><sub>Grammar topics, from A1 to C1</sub>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/exam-dark.webp">
        <img alt="The A2 inburgeringsexamen at a glance, with practice per part" src="docs/images/exam-light.webp">
      </picture>
      <br><sub>Practice for the A2 inburgeringsexamen</sub>
    </td>
  </tr>
</table>

How it works, from the words you know to the help on each page, is on
[vuurtoren.app/how](https://vuurtoren.app/how.html), and in full detail in
[docs/dev/algorithms.md](docs/dev/algorithms.md).

## Support

Vuurtoren is free and made by one person. If it helps you, you can support it on
[Ko-fi](https://ko-fi.com/pavlohrab).

## Licence

The code is MIT. The content in `content/` (the starter words and the stories) is CC BY-SA
4.0, because the dictionary and sentence sources it is built from are; see [content/LICENSE](content/LICENSE). Vuurtoren is an independent project; it talks to Anki
through the AnkiConnect add-on.
