# Changelog

Versions follow [Semantic Versioning](https://semver.org/). Before 1.0 a minor version may change
the data format; the app migrates it and never downgrades it.

## [Unreleased]

## [0.1.0]

First release.

- **Reader**: Read, Cloze and Gloss modes, a new-words budget per page, cloze hints, word
  inspector with Add to Anki, Study first and Mark known.
- **Anki**: deck detection, learner model from SM-2 or FSRS, a language profile that decides
  which decks are read and where new words go.
- **Import**: paste, web address, PDF, photo (OCR), EPUB.
- **Library**, **Words**, **Practice** (own FSRS schedule, never written to Anki), **Grammar**
  (A1–C1 topics found in your texts), **Courses** (study along your textbook), **Exam** (A2
  inburgeringsexamen practice and mock exams).
- **Optional AI** with your own key: Talk, stories, sentence explanations, example sentences.
  MCP server for Claude Desktop and Claude Code.
- **Desktop app** for Linux, Windows and macOS: works offline, data in one file.
- **Self-hosting**: Docker images, one SQLite file shared by your devices, sign-in, backups,
  Dockge stack with optional Cloudflare Tunnel.
