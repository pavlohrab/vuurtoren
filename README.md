# Kenning (working name)

**Your Anki deck, turned into a reading and speaking coach.** An open-source, local-first language-learning app:

- graded reading and weave reading of your own texts (paste, URL, PDF, photo);
- exercises without AI, and grammar explanations;
- AI conversation with your own key, kept to the words you know;
- new words pushed back to Anki.

Dutch first, Ukrainian next. Status: **M0 foundation**. See [docs/README.md](docs/README.md) and the [roadmap](docs/roadmap.md).

## Layout

```
apps/web          Vite + React PWA (self-hosted web app)
packages/core     pure TS domain logic (learner model, planner, exercises)
server/nlp        Python FastAPI NLP/OCR/MT service (uv)
docs/             research, design system, ADRs, roadmap
```

## Development

Requirements: Node ≥ 22, pnpm, uv.

```sh
pnpm install
pnpm dev                       # web app at http://localhost:5173
pnpm test && pnpm typecheck && pnpm lint

cd server/nlp
uv sync
uv run uvicorn kenning_nlp.app:app --reload   # http://localhost:8000/health
uv run pytest
```

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
