<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/logo-light.svg">
    <img alt="vuurtoren" src="docs/images/logo-light.svg" width="300">
  </picture>
</p>

<p align="center">
  <strong>Read Dutch at your level. Keep the words you meet.</strong>
</p>

<p align="center">
  <a href="https://github.com/pavlohrab/Vuurtoren/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/pavlohrab/Vuurtoren/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/pavlohrab/Vuurtoren/actions/workflows/images.yml"><img alt="Images" src="https://github.com/pavlohrab/Vuurtoren/actions/workflows/images.yml/badge.svg"></a>
  <a href="#licence"><img alt="Licence: MIT OR Apache-2.0" src="https://img.shields.io/badge/licence-MIT%20OR%20Apache--2.0-c99a5b"></a>
  <a href="docs/guide/self-host.md"><img alt="Self-hosted sync" src="https://img.shields.io/badge/self--hosted-sync-8f5a1f"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/read-dark.webp">
  <img alt="Vuurtoren's Read page: today's text and reviews, stories at your level and your own texts" src="docs/images/read-light.webp">
</picture>

## Why Vuurtoren

While learning Dutch I used two tools: reading and Anki. The problem is that they never talk to
each other. My decks had no idea what I was reading, and the text had no idea which words I
already knew.

Vuurtoren brings the two together. It knows your words, from its own flashcards or your Anki
decks, and uses them to make any text readable at your level: an article, a PDF, a photo of a
page or your course book. Known words stay as they are, a few new ones are marked to learn, and
the rest get a short translation. One click turns a word into a flashcard, with the sentence you
found it in. There are also exercises, grammar from A1 to C1 and practice for the A2
inburgeringsexamen.

About the name: vuurtoren is Dutch for lighthouse, literally a "fire-tower", one of those
compound pictures Dutch builds so many of its words from. A lighthouse helps you find your way
through unfamiliar water, and that is what I want this app to do for a text.

## What it does

**Reading.** Open a story at your level (there are 35, from A1 to B2, with recorded audio), a web
page, a PDF or a photo of a page from your course book. Vuurtoren keeps a set number of new words
per page and translates the rest above the line, so the text stays readable. Tap a word for its
meaning in that sentence, its grammar and its forms; side by side puts each sentence next to its
English, word paired with word. A course book you own (PDF, EPUB or photos) can be followed unit
by unit.

**Words.** One tap keeps a word, with the sentence you found it in. Your cards are reviewed with
FSRS, the same scheduler Anki uses, a few minutes a day: due cards first, then new words, swiped
or tapped. If you start from nothing, the 5000 most common Dutch words are there from the level
you choose. If you already use Anki, bring your decks in as `.apkg` files, or keep reviewing in
Anki.

**Grammar and the exam.** Inversion, separable verbs, the perfect tense and the rest are marked
where they appear in your texts, with topics from A1 to C1 explained on your own sentences.
Exercises practise what you read, and mock exams prepare the A2 inburgeringsexamen. AI is there
only if you want it, with your own key: stories at your level, sentences explained, a chat
partner who keeps to words you know.

**Your data.** Everything lives on your devices and works offline. Sync passes changes between
them locked with your passphrase, through your own server, WebDAV or a folder Syncthing already
keeps in sync. **Vuurtoren Sync** is coming: sign in on each device and they sync, with nothing to
set up.

## Get Vuurtoren

<p align="center">
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for macOS" src="https://img.shields.io/badge/Download-macOS-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for Linux" src="https://img.shields.io/badge/Download-Linux-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for Android" src="https://img.shields.io/badge/Download-Android-8f5a1f?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="https://vuurtoren.app">vuurtoren.app</a> ·
  <a href="docs/guide/install.md">Install</a> ·
  <a href="docs/guide/sync.md">Sync your devices</a> ·
  <a href="docs/guide/self-host.md">Your own sync server</a>
</p>

## Development

Node ≥ 22, pnpm, [uv](https://docs.astral.sh/uv/), Python ≥ 3.12.

```sh
pnpm install && pnpm build
cd server/nlp && uv run python scripts/build_dictionary.py && uv run python scripts/fetch_mt_model.py && cd -
pnpm nlp     # language server on :8000
pnpm dev     # web app on http://localhost:5173 (add ?demo for demo data)
```

More: [architecture](docs/architecture.md) · [algorithms](docs/algorithms.md) ·
[decisions](docs/decisions.md). Issues and pull requests are welcome.

## Licence

MIT or Apache-2.0, at your option. The content in `content/` (the starter word list) is CC BY-SA
4.0; see [content/LICENSE](content/LICENSE). Vuurtoren is an independent project; it talks to Anki
through the AnkiConnect add-on.
