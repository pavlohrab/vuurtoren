# ADR 0004 — Python NLP/OCR/MT service, stateless, with a TS lite fallback

**Status:** accepted

**Context:** Dutch separable verbs and grammar detection need a dependency parse (spaCy `nl_core_news_md`). Ukrainian needs proper morphology. OCR and offline MT are Python-native.

**Decision:**

- `server/nlp` (FastAPI) exposes `/analyze`, `/ocr`, `/pdf`, `/similar`, `/translate`, `/align`.
- It is stateless; results are cached client-side by content hash.
- **The same analyzer runs on Anki card fields and on texts.**
- `packages/nlp-client` also has a lite fallback (Intl.Segmenter + lemma tables).

**Consequences:**

- Self-hosting means Docker compose (web + nlp).
- Desktop either points to a server URL or bundles a PyInstaller sidecar.
