# 06 — Weave reading & the immersion dial

**Use case:** a photo of a Dutch philosophy journal page, far above the learner's level.

- The app OCRs it and translates it into English.
- Some Dutch words stay untranslated: ones the learner knows, plus a budget of unknown words just above their current level.
- That band rises as the Anki vocabulary grows.
- At the end, the chosen new words go to Anki, and Anki's own sync carries them to AnkiWeb.

The reverse also works: an English text with some words swapped into Dutch, as Toucan does.

Prior art: the _diglot weave_ technique, and Toucan (EN→target on web pages). Neither is tied to an SRS.

## One planner, three renderings

The planner labels each source token:

| Label       | Rule                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| keep-known  | p_known ≥ 0.8                                                                                           |
| keep-target | unknown, frequency rank in `[vocab_est, vocab_est + band]`, ≤ B per segment, prefer repeats in the text |
| gloss       | rare words in target-language mode                                                                      |
| translate   | rare words in weave mode: jargon is translated and never pushed                                         |

| Text coverage | Default rendering                                             |
| ------------- | ------------------------------------------------------------- |
| ≥ 95%         | Target-language graded reading (clozes, new words introduced) |
| 80–95%        | Target language with inline glosses                           |
| < 80%         | **Weave**: base language with target-language islands         |

- The user can override the default with a "density" slider.
- `band` and `B` follow the same staircase controller as graded reading.

## Translation engines (TranslationPort)

1. **LLM (user's own key):** the prompt marks spans `<k>…</k>` and says "copy verbatim". The response is JSON with the woven sentence plus `islands:[{src, gloss}]`. Best quality.
2. **DeepL API (user's own key):** `tag_handling=xml`, `ignore_tags=k`, so marked words pass through untouched. No alignment needed.
3. **Offline (self-host, no AI):** Argos Translate / OPUS-MT on CTranslate2 (nl↔en, uk↔en). Translate the whole sentence, align words with **SimAlign** (multilingual embeddings), then replace the aligned English span with the original Dutch word. Free and private, lower quality.

Contract test: every engine must return all keep-spans verbatim. Cache by `(segment, engine, labels_hash)`.

## Anki flow

- Each island seen counts as a passive exposure (a small p_known bump).
- At the end of a text, a "Words from this text" list shows each lemma, its source sentence (NL), the translation (EN), and a checkbox.
- Checked words go to Anki desktop in one batch via `notes.createMany`. Anki's own sync carries them to AnkiWeb; the app never talks to AnkiWeb directly.

## OCR for journals

- Problems to handle: two columns, footnotes, hyphenation, running headers.
- Approach: Tesseract page segmentation with column detection (PaddleOCR layout as an upgrade), then a dehyphenation and header-stripping pass, then an editable preview.
- **Copyright:** personal use only; never put imported texts in public storage.
