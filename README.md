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
  <a href="deploy/README.md"><img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-Docker%20%C2%B7%20Dockge-8f5a1f"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/home-dark.webp">
  <img alt="Vuurtoren's Home: continue reading, today's steps and words to learn now" src="docs/images/home-light.webp">
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

Vuurtoren is local-first. Your data lives on your devices, sync is encrypted (through your own
server, a synced folder or WebDAV), and AI is optional, with your own key.

About the name: vuurtoren is Dutch for lighthouse, literally a "fire-tower", one of those
compound pictures Dutch builds so many of its words from. A lighthouse helps you find your way
through unfamiliar water, and that is what I want this app to do for a text.

## Features

- Reading at your level: Read, Cloze and Gloss modes, with a set number of new words per page
- Side by side: each sentence with its English, word paired with word, and a structure view
- Import from a web address, PDF, photo (OCR) or pasted text
- Built-in flashcards with FSRS, tuned to your own reviews
- Start with the 5000 most common Dutch words, with meanings and example sentences, from the level you choose
- Graded stories from A1 to B2: Dutch legends, retold classics and new stories, each with its own English
- Hear words and sentences: recorded clips (female or male voice) where there are any, else your system's voice
- Anki: import and export `.apkg` files, or keep studying in Anki through AnkiConnect
- Click any word for its meaning and forms, offline
- Grammar marked in your texts: inversion, separable verbs, the perfect tense and more
- Practice: meaning, cloze, de/het, separable verbs, perfect tense, word forms, word order, dictation
- Grammar topics from A1 to C1, with examples from your own texts
- Courses: study along a textbook you own (PDF, EPUB or photos), unit by unit
- Practice and mock exams for the A2 inburgeringsexamen
- Optional AI with your own key: Talk, stories at your level, explanations
- Sync between devices through your own server, a synced folder or WebDAV, encrypted
- Desktop app for Windows, macOS and Linux, or self-host with Docker

## Get Vuurtoren

<p align="center">
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for macOS" src="https://img.shields.io/badge/Download-macOS-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Vuurtoren/releases/latest"><img alt="Download for Linux" src="https://img.shields.io/badge/Download-Linux-8f5a1f?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="docs/guide/install.md">Install</a> ·
  <a href="docs/guide/self-host.md">Run it on your server</a> ·
  <a href="docs/guide/sync.md">Sync your devices</a>
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
