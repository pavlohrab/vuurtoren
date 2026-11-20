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

## The problem

You learn words by reading. But a text is only pleasant to read when you know about 98 words in
100 (Hu and Nation, 2000). At 90 you stop on every line to look something up.

So learners split the work. Flashcards for the words, graded readers for the reading. The cards
do not know what you read. The books do not know which words you have.

Kenning puts the two in one place.

## How it works

Kenning knows every word you have learned and how well you still remember it. It uses that to
read any text with you.

Paste an article, open a PDF or an EPUB, or take a photo of a page. Kenning cuts it into pages of
about 150 words. Words you know stay plain. Three new words per page are marked to learn, and you
can change that number. Everything else gets a quiet translation, so you keep reading.

Click a word you want and it becomes a flashcard, with the sentence you found it in. Reviews are
scheduled with FSRS, so each card comes back just before you would forget it. The next time the
word turns up in a text, it stays plain.

Around this there is practice (de/het, separable verbs, the perfect tense, word order), grammar
from A1 to C1 with examples from your own texts, and preparation for the A2
inburgeringsexamen.

Already use Anki? Import your decks, export your cards back, or keep studying in Anki.

## Your data stays yours

Kenning is local-first and self-hosted. Your data is one file on your device, or on your own
server for all your devices. Sync is encrypted with your passphrase before anything leaves the
device. The dictionary and the translation model run offline.

No AI is needed. If you want conversation practice or stories at your level, bring your own key.

## In one sentence

Kenning reads any text with you, gives you a few new words on every page, and makes sure you
keep them.

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
