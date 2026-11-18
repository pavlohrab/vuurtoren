# Project docs (working name: Kenning)

An open-source app that turns **your Anki deck into a reading and speaking coach**:

- graded reading of your own texts (paste, URL, PDF, photo), with clozes and a capped number of new words;
- **weave reading** for texts far above your level: English with Dutch islands, the dial moving toward Dutch as you grow;
- exercises without AI, and grammar explanations;
- AI conversation with your own key, kept to the words you know;
- new words pushed back to Anki.

## Decisions

- **Languages:** Dutch first, then Ukrainian (with grammar for both).
- **Stack:** TypeScript core + React. Self-hosted web app first → Tauri desktop → Chrome/Firefox extension (WXT) → mobile later.
- **NLP:** Python service (spaCy), run via Docker compose with one worker. It keeps no user data, but holds running OCR jobs and a grammar-example cache (ADR 0004).
- **Data:** an append-only SQLite event log, either local in the browser (OPFS) or in one file on your own server (ADR 0008). Sync to user-owned storage (folder, WebDAV, GitHub) is planned (M7), not built.
- **Anki:** the record of known words, read via AnkiConnect. Kenning writes only on an explicit click: Add to Anki, Study first in Anki, Mark known (ADR 0007). Answers given in Kenning feed its own learner model, never Anki (ADR 0011). Never AnkiWeb, never rslib.
- **AI:** bring your own key; MCP server for Claude/ChatGPT subscribers; no Claude OAuth.
- **License:** MIT OR Apache-2.0.

## Index

- **[STATUS.md](STATUS.md)**: what is done, what is next, open decisions, known issues.

- [algorithms.md](algorithms.md): how the non-AI algorithms work (learner model, Dutch analysis, reading planner, practice, grammar, Anki writes), with their real thresholds.
- [ai.md](ai.md): AI providers, privacy, costs, MCP setup.
- [exam.md](exam.md): the Exam section (A2 inburgeringsexamen practice and mock exams).
- [roadmap.md](roadmap.md): the approved plan with milestones M0–M8 and Phases 2–4.
- Research
  - [01 Market & competitors](research/01-market.md)
  - [02 Anki integration](research/02-anki-integration.md)
  - [03 Algorithms](research/03-algorithms.md)
  - [04 Architecture & sync](research/04-architecture.md)
  - [05 AI / BYOK / Claude policy](research/05-ai-byok.md)
  - [06 Weave reading](research/06-weave-reading.md)
  - [07 M1 findings on a real collection](research/07-m1-findings.md)
  - [08 The inburgeringsexamen at A2](research/08-inburgering-a2.md)
- Design
  - [Design system](design/design-system.md)
  - [Naming](design/naming.md)
  - [Courses: study along a textbook](design/courses.md)
  - [Words already in Anki](design/anki-existing-words.md)
- [review-2026-11.md](review-2026-11.md): the 2026-11 review (UI/UX, architecture, bugs) and the status of each item.
- ADRs: [0001](adr/0001-ts-core-react.md) · [0002](adr/0002-event-log-sync.md) · [0003](adr/0003-anki-read-only.md) · [0004](adr/0004-python-nlp-service.md) · [0005](adr/0005-no-claude-oauth-mcp-instead.md) · [0007](adr/0007-anki-write-actions.md) · [0008](adr/0008-server-storage-mode.md) · [0009](adr/0009-login-for-public-deployments.md) · [0010](adr/0010-language-profile.md) · [0011](adr/0011-learning-signals.md) · [0006 (proposed, superseded by 0007)](adr/0006-prioritise-existing-cards.md)
