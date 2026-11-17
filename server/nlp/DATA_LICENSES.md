# Data licences (server/nlp)

The service code is MIT OR Apache-2.0. The data and models it uses carry their own licences.
Share-alike terms apply to the data, not to the application code.

| Data / model | Used for | Licence | Notes |
| --- | --- | --- | --- |
| Kaikki.org Dutch dictionary (Wiktextract of English Wiktionary) | `POST /gloss`, `data/dictionary-nl.sqlite` | CC BY-SA 4.0 and GFDL (Wiktionary content; Wiktextract code is MIT) | Attribution below. The generated SQLite file is a derivative: if you redistribute it, keep it under CC BY-SA. It is built locally / at Docker build time and is not committed. |
| wordfreq | `zipf` token frequency | Data CC BY-SA 4.0, code Apache-2.0 | Wordfreq bundles data from Wikipedia, subtitles, news, books, Twitter, Reddit and others. |
| spaCy `nl_core_news_md` | tagging, parsing, lemmas | CC BY-SA 4.0 (trained on Dutch UD treebanks) | Downloaded from the explosion/spacy-models release as a locked dependency. |
| simplemma | dictionary lemmas | MIT | |
| lingua-language-detector | `/detect` | Apache-2.0 | |
| Tesseract and `nld` / `ukr` / `eng` traineddata | `POST /ocr` | Apache-2.0 | Installed from Debian packages in the Docker image. |
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

## Rebuilding the dictionary

```sh
cd server/nlp
uv run python scripts/build_dictionary.py      # downloads ~250 MB once, writes data/dictionary-nl.sqlite
```
