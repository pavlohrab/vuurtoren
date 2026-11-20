<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/logo-light.svg">
    <img alt="kenning" src="docs/images/logo-light.svg" width="300">
  </picture>
</p>

<p align="center">
  <strong>Read Dutch at your level. Keep the words you meet.</strong>
</p>

<p align="center">
  <a href="https://github.com/pavlohrab/Kenning/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/pavlohrab/Kenning/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/pavlohrab/Kenning/actions/workflows/images.yml"><img alt="Images" src="https://github.com/pavlohrab/Kenning/actions/workflows/images.yml/badge.svg"></a>
  <a href="#licence"><img alt="Licence: MIT OR Apache-2.0" src="https://img.shields.io/badge/licence-MIT%20OR%20Apache--2.0-c99a5b"></a>
  <a href="deploy/README.md"><img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-Docker%20%C2%B7%20Dockge-8f5a1f"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/home-dark.webp">
  <img alt="Kenning's Home: continue reading, today's steps and words to learn now" src="docs/images/home-light.webp">
</picture>

## Why Kenning

Language learners have relied on two tools for a long time. The first is reading: books,
articles, graded readers. The second is flashcards, which for many of us means Anki. Both work,
and while learning Dutch I used both. The problem is that they never talk to each other. My
decks knew a few thousand words but had no idea what I was reading, and the article in front of
me had no idea which of its words I already knew. So reading meant reaching for a dictionary
every other line, and flashcards meant learning words without the sentences I had met them in.

Kenning is my attempt to bring the two together. It keeps track of the words you know, either in
its own flashcards or in your Anki decks, and uses them to make any text readable at your level.
Words you know are left alone. A few new words on each page are marked for you to learn, and the
rest get a short translation, so you can keep going. When a word is worth keeping, one click
turns it into a flashcard, together with the sentence you found it in. Reviews are scheduled with
FSRS, and the next time that word shows up in a text, you will probably not need the
translation.

The text can be almost anything: an article, a PDF, an EPUB, a photo of a page, or the textbook
from your Dutch course. Around the reader there are exercises (de/het, separable verbs, the
perfect tense, word order), grammar topics from A1 to C1 with examples taken from your own
texts, and practice for the A2 inburgeringsexamen.

## Your data

Kenning is local-first and self-hosted. Everything lives in one file on your device, or on your
own server if you want the same data on all your devices. Sync is encrypted with your passphrase
before anything leaves the device, so the place you sync through cannot read it. The dictionary
and the translation model run offline. AI is optional: if you would like conversation practice
or stories written at your level, you bring your own key.

## Get Kenning

<p align="center">
  <a href="https://github.com/pavlohrab/Kenning/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Kenning/releases/latest"><img alt="Download for macOS" src="https://img.shields.io/badge/Download-macOS-8f5a1f?style=for-the-badge"></a>
  <a href="https://github.com/pavlohrab/Kenning/releases/latest"><img alt="Download for Linux" src="https://img.shields.io/badge/Download-Linux-8f5a1f?style=for-the-badge"></a>
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

MIT or Apache-2.0, at your option. Kenning is an independent project; it talks to Anki through
the AnkiConnect add-on.
