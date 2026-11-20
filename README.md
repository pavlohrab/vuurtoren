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

<table><tr><td width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/reader-dark.webp"><img alt="Reading" src="docs/images/reader-light.webp"></picture></td><td width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/words-dark.webp"><img alt="Your words" src="docs/images/words-light.webp"></picture></td><td width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/practice-dark.webp"><img alt="Practice" src="docs/images/practice-light.webp"></picture></td></tr>
<tr><td align="center"><b>Read</b></td><td align="center"><b>Keep</b></td><td align="center"><b>Practise</b></td></tr></table>

Kenning is an app for learning Dutch by reading. Give it any text, and it shows you which words
you know, which few to learn next, and turns them into flashcards. Free and open source, works
offline, no AI needed.

Kenning is local-first and self-hosted. Your data stays on your device, or on your own server
for all your devices.

## Why Kenning

Reading is how you meet words in real use. But a text full of unknown words is tiring, and
flashcards alone lose the context you learned the word in.

Kenning joins the two. It knows which words you know, so it can make any text readable at your
level, and every new word you keep goes into your flashcards with its sentence.

| You want to…        | Kenning gives you                                                    |
| ------------------- | -------------------------------------------------------------------- |
| **Read**            | Any text at your level: articles, PDFs, EPUBs, photos, your textbook |
| **Remember**        | Flashcards with FSRS reviews, made from what you read                |
| **Practise**        | Exercises, grammar topics A1–C1, the A2 inburgeringsexamen           |
| **Understand**      | Dutch analysis: separable verbs, compounds, an offline dictionary    |
| **Keep it private** | Your data stays on your device or your own server; sync is encrypted |

Already use Anki? Import your decks, export your cards back, or keep studying in Anki.

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
