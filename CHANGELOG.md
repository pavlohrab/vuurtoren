# Changelog

All notable changes to Kenning. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/) (before 1.0, a minor version may
change the data format; the app migrates it and never downgrades it).

The version lives in the root `package.json` and is shown in Settings > Advanced > Server status.
Release notes for each version: [docs/releases/](docs/releases/).

## [Unreleased]

## [0.1.0] - not yet tagged

The first release: everything built so far, packaged for self-hosting.
Notes: [docs/releases/v0.1.0.md](docs/releases/v0.1.0.md).

### Added

- **Reader** with Read, Cloze and Gloss modes, pages of about 150 words, the amber
  words-worth-learning-now line, the Translations dial, a new-words budget per page, cloze hints
  (meaning, first letter, half the word, reveal) and focus mode.
- **Word inspector**: dictionary form, meaning (your card's gloss first, then Wiktionary), article,
  decks, sentence, live Anki state and grammar of the word; explicit Anki write actions (Add to
  Anki, Study first, Mark known, Use Anki's state), each logged as an event (ADR 0007).
- **Anki as the record of what you know**: deck auto-detection, a learner model from SM-2 or FSRS,
  confirmed decks per language profile, one Add to Anki path for every screen (ADR 0010).
- **Import**: paste, web address (fetched server-side, SSRF-protected), PDF (with OCR fallback),
  photos (OCR), journal clean-up.
- **Library** shelf with generated covers; **Words** hub with filters, bulk actions and the shared
  inspector; **Words from this text** after finishing a text.
- **Practice**: meaning, cloze, de/het, separable verbs, perfect tense, forms, scramble and
  dictation exercises with their own FSRS schedule; never written to Anki.
- **Grammar**: 24 Dutch topic pages, rule-based detection in your texts, quiet margin marks in
  the reader, examples from your Library and Tatoeba, topic exercises.
- **Courses**: study along a textbook you own (PDF, EPUB, photos, web pages): outline, unit words
  matched to Anki decks, book exercises, course packs.
- **Exam preparation** for the A2 inburgeringsexamen: practice and timed mock exams for reading,
  listening, writing, speaking and KNM.
- **AI, bring your own key** (optional): Talk, AI stories, Explain this sentence, Simplify this
  page, validated example sentences; OpenAI-compatible and Anthropic adapters. MCP server for
  Claude Desktop / Claude Code.
- **Storage**: SQLite in the browser (OPFS) or, with the compose stack, one SQLite file on the
  server shared by every device (ADR 0008); backup download and restore in both modes.
- **Sign-in** for public deployments: single user, scrypt password, cookie sessions, rate limit,
  CSRF guard, nginx gate on `/api` and `/nlp`, strict security headers (ADR 0009).
- **Self-hosting**: three images (`kenning-web`, `kenning-api`, `kenning-nlp`, amd64 and arm64) on
  ghcr.io, a compose stack with optional Caddy HTTPS, and a Dockge stack with an optional
  Cloudflare Tunnel.
- Scheduled **backups** as an optional compose service (profile `backup`): snapshots from
  `/api/export` into a folder, with retention.
- **Settings > Advanced > Server status**: app version and commit, where your data lives, database
  state, sign-in on/off, language server version and data files, Anki reachability from this
  browser, secure context; one click copies it for a bug report.
- `scripts/doctor.sh`: the same checks from a shell (also the CI smoke test).
- `/health` of the language server reports which data files are present.
- CI builds the three images on every pull request and push, starts the Dockge stack from them
  and runs the smoke test (page, health, sign-in, data, language server).
- Images are published as `edge` and `sha-<commit>` on every push to `main`, and as `X.Y.Z`,
  `X.Y` and `latest` on `v*` tags.

### Changed

- Images run as non-root users (`nginx`, `node`, `kenning`), with pinned base images (updated by
  Dependabot), cached dependency layers, and `nginx -t` at build time. The api image is now
  Alpine-based and contains only the build output and production dependencies.
- Motion: popovers, menus, tooltips and the command palette scale-fade in; dialogs fade out;
  Library covers and Words rows appear in a short cascade; the inspector slides in instead of
  animating the page grid (no reflow of the reader text); skeletons appear only after 150 ms and
  sweep more softly. Reduced motion turns all of it off.
