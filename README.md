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

## What it is

Kenning is a reading app for people learning Dutch. You give it a text (an article, a PDF, an
EPUB or a photo of a page) and it shows the text at your level. Words you already know are left
as they are, a few new words per page are highlighted for you to learn, and the rest get a short
translation. Words you want to keep become flashcards, which Kenning schedules with FSRS. There
are also exercises, grammar topics from A1 to C1 with examples from your own texts, and
practice for the A2 inburgeringsexamen.

If you already use Anki, Kenning can import your decks, export cards back to Anki, or work with
your Anki collection directly.

## Why

Much of the vocabulary in a new language is learned from reading, but reading is hard when too
many words in a text are unknown. For comfortable reading you need to know about 98% of the
words (Hu and Nation, 2000). Flashcards and graded readers both help with this, but they are
separate: a flashcard app has no idea what you read, and a graded reader has no idea which words
you have learned. Kenning keeps track of your vocabulary and uses it to adapt whatever you read.

## Data and privacy

Kenning is local-first. Your data is stored in a single file on your device. You can also
self-host it and sync between your devices through your own server; sync is end-to-end
encrypted with your passphrase. The dictionary and the translation model run offline. AI
features are optional and use your own API key.

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
