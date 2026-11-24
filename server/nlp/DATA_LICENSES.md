# Data licences (server/nlp)

The service code is MIT. The data and models it uses carry their own licences.
Share-alike terms apply to the data, not to the application code.

| Data / model | Used for | Licence | Notes |
| --- | --- | --- | --- |
| Kaikki.org Dutch dictionary (Wiktextract of English Wiktionary) | `POST /gloss`, `data/dictionary-nl.sqlite` | CC BY-SA 4.0 and GFDL (Wiktionary content; Wiktextract code is MIT) | Attribution below. The generated SQLite file is a derivative: if you redistribute it, keep it under CC BY-SA. It is built locally / at Docker build time and is not committed. |
| Kaikki.org Dutch dictionary, morphology | `POST /forms`, the `wordforms` table of `data/dictionary-nl.sqlite` | CC BY-SA 4.0 and GFDL | Verb conjugations, noun plurals / diminutives, adjective forms and separable-verb particles extracted from the same Wiktionary data. |
| Tatoeba sentences (Dutch + English translations) | `POST /sentences`, `data/sentences-nl.sqlite` | CC BY 2.0 FR (some sentences CC0) | Attribution below. Weekly per-language exports from <https://tatoeba.org/downloads>. The generated SQLite file keeps the sentence texts, so redistribute it with the attribution. Built by `scripts/build_sentences.py` / at Docker build time; not committed. |
| OpenTaal word list (Dutch spelling word list) | separable-verb check, `compound-verbs-nl.txt.gz` (58,000 verbs like _meegeven_) | Revised BSD License and/or CC BY 3.0 | From <https://github.com/OpenTaal/opentaal-wordlist>, pinned commit in `scripts/build_compound_verbs.py`. Committed (217 KB); the header line keeps the source. |
| spaCy `nl_core_news_md` word vectors | `POST /similar` | CC BY-SA 4.0 | Same model as above; vectors of the most frequent dictionary lemmas, computed in memory, nothing stored. |
| wordfreq | `zipf` token frequency | Data CC BY-SA 4.0, code Apache-2.0 | Wordfreq bundles data from Wikipedia, subtitles, news, books, Twitter, Reddit and others. |
| spaCy `nl_core_news_md` | tagging, parsing, lemmas | CC BY-SA 4.0 (trained on Dutch UD treebanks) | Downloaded from the explosion/spacy-models release as a locked dependency. |
| simplemma | dictionary lemmas | MIT | |
| Starter word list (`content/starter/nl-5000.json`) | native mode's "most common words" decks | CC BY-SA 4.0 | Built by `scripts/build_starter.py` from wordfreq, the dictionary and sentence packs and spaCy; committed, with its attribution in `content/starter/README.md`. |
| Graded stories (`content/stories`) | the Library's Stories shelf | CC BY-SA 4.0 | Written for Vuurtoren (legends and public-domain classics retold in new words); bundled with their spaCy analysis by `scripts/check_stories.py --write`. |
| PaddleOCR PP-OCRv6 small detection and recognition models, PP-OCR text-direction model (ONNX) | `POST /ocr`, `POST /course/ocr` | Apache-2.0 | Bundled in the `rapidocr` wheel (the `ocr` extra): in the standard Docker image and the desktop sidecar. |
| RapidOCR / ONNX Runtime / OpenCV | OCR inference, page clean-up | Apache-2.0 / MIT / Apache-2.0 | |
| Helsinki-NLP OPUS-MT `opus-mt-nl-en` (original Marian release `opus-2019-12-05`, converted to CTranslate2 int8) | `POST /translate`, `data/mt-nl-en/` (data pack `mt-nl-en`) | Apache-2.0 on the Hugging Face model card; OPUS-MT training data and recipes are CC BY 4.0 | Attribution below. Downloaded and converted by `scripts/fetch_mt_model.py` (SHA-256 pinned); shipped as a data pack, not committed. |
| ctranslate2 / sentencepiece | MT inference | MIT / Apache-2.0 | |
| trafilatura | `POST /extract/url` | Apache-2.0 | |
| pypdfium2 / PDFium | `POST /extract/pdf`, PDF rasterising | BSD-3-Clause / Apache-2.0 | |

## Attribution

Dictionary glosses, parts of speech, genders and pronunciations come from
[Wiktionary](https://en.wiktionary.org), the free dictionary, available under the
[Creative Commons Attribution-ShareAlike 4.0 licence](https://creativecommons.org/licenses/by-sa/4.0/)
(and GFDL), extracted into machine-readable form by
[Wiktextract](https://github.com/tatuylonen/wiktextract) and distributed by
[Kaikki.org](https://kaikki.org). Entries were shortened (at most five glosses per entry) and
reorganised into a SQLite database. Per-entry authorship is in the Wiktionary page histories.
Any client UI that shows glosses should credit "Wiktionary (CC BY-SA)".

Translations come from OPUS-MT (Tiedemann & Thottingal, 2020, "OPUS-MT - Building open
translation services for the World"), model `Helsinki-NLP/opus-mt-nl-en`, trained on OPUS data and
released by the Language Technology Research Group at the University of Helsinki. A client UI that
shows machine translations should say "Machine translation: OPUS-MT (Helsinki-NLP)".

Example sentences come from [Tatoeba](https://tatoeba.org), a collaborative sentence database
whose contributors license their sentences under
[CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/) (a subset under CC0). Sentences and
translations are unmodified; only sentences that have an English translation are kept. A client UI
that shows them should credit "Tatoeba.org (CC BY 2.0 FR)". Per-sentence authorship is on
tatoeba.org/sentences/show/<id>; the SQLite file's `sentences.id` is the Tatoeba sentence id.

## Rebuilding the dictionary

```sh
cd server/nlp
uv run python scripts/build_dictionary.py      # downloads ~250 MB once, writes data/dictionary-nl.sqlite
```

After changing the dictionary build (for example `/forms` morphology) rebuild it with the same
command: The old file is replaced atomically.

## Rebuilding the sentences

```sh
cd server/nlp
uv run python scripts/build_sentences.py       # downloads ~30 MB once, ~4 min with --processes 4
```

## Fetching the translation model

```sh
cd server/nlp
uv run python scripts/fetch_mt_model.py        # ~290 MB download once, writes data/mt-nl-en/ (85 MB)
```
