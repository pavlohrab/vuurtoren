# Changelog

Versions follow [Semantic Versioning](https://semver.org/). Before 1.0 a minor version may change
the data format; the app migrates it and never downgrades it.

## [Unreleased]

- **A Vuurtoren server is a sync place and a language server.** Every device keeps its own data;
  the app opened from the server keeps its copy in the browser and chooses **This server** in
  Settings → Sync. `/api/rpc`, `/api/export`, `/api/import`, `/api/mcp` and MCP tokens are gone.
  **Before you update a server that held your data,** open it and download a backup (Settings →
  Data & backup); after the update, restore it in the browser (or the desktop app) and start
  sync from there.
- The language server accepts a device's sync token as well as a signed-in browser.
- Sync tokens can be allowed to change the passphrase and recovery key.
- The desktop app always runs on this computer; it no longer opens a server's page. Closing it
  sends the last changes first.
- Sync runs at start, a few seconds after a change, every 15 seconds while open and when you
  leave; files that did not sync are listed; a device that lost its key asks for the passphrase.
- GitHub is no longer a sync place. WebDAV is offered in the desktop app.
- Use with Claude: the stdio MCP server opens the desktop app's data file.

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
