# ADR 0003 — Anki is the read-only source of knowledge; writes are new notes only

**Status:** accepted, amended by [0007](0007-anki-write-actions.md): explicit per-word write actions (add, learn next, mark known)

**Decision:**

- Read the learner model from Anki: AnkiConnect v1 (FSRS) → legacy → `.colpkg` import.
- In-app exercises use our own ts-fsrs scheduler and never write reviews to Anki.
- Writes are limited to new notes (`notes.createMany`).
- No AnkiWeb sync (ToS). No linking of rslib (AGPL).

**Consequences:**

- Anki's FSRS data stays clean.
- iOS gets Anki data via a snapshot published into our own sync vault.
