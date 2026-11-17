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

**Amendment (2026-11-17, after the 2026-11 review):**

- The service keeps no user data but is **not stateless**: course OCR jobs live in process memory and the grammar-example cache is written to disk. It therefore runs as **one process with one worker** (`--workers 1` in the Dockerfile, one replica in compose); blocking work runs in a threadpool (review items A15, B5).
- The TypeScript **lite fallback does not exist**. Without the server the app cannot import or analyse texts (review item A14; planned with the LanguagePack split, #10).
- Endpoints today: `/analyze/text`, `/analyze/terms`, `/detect`, `/gloss`, `/translate`, `/forms`, `/sentences`, `/similar`, `/grammar`, `/grammar/examples`, `/extract/url`, `/extract/pdf`, `/ocr`, `/course/ocr`. `/align` is not built (M6b).
