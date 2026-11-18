# 10 — Language server footprint (D1)

Measured 2026-11-18 on linux/amd64, legacy Docker builder. "Before" = `main` at 4375a83.

## Image

| Layer / part                   | Before      | After (default) | After `-slim` | After `-full` |
| ------------------------------ | ----------- | --------------- | ------------- | ------------- |
| Debian + Python 3.12 base      | 132 MB      | 132 MB          | 132 MB        | 132 MB        |
| Tesseract (nld, ukr, eng)      | 114 MB      | 112 MB          | —             | 112 MB        |
| `/opt/venv` (Python libraries) | 1 020 MB    | 572 MB          | 572 MB        | 572 MB        |
| app code + scripts             | 1.3 MB      | 0.9 MB          | 0.9 MB        | 0.9 MB        |
| dictionary-nl.sqlite           | 40.5 MB     | volume          | volume        | 14 MB archive |
| sentences-nl.sqlite            | 49.2 MB     | volume          | volume        | 20 MB archive |
| mt-nl-en (translation model)   | 161 MB      | volume          | volume        | 70 MB archive |
| grammar-examples-nl.sqlite     | 0.4 MB      | derived         | derived       | derived       |
| **Total (`docker images`)**    | **2.28 GB** | **818 MB**      | **658 MB**    | **1.03 GB**   |
| Compressed (pull size)         | 755 MB      | 232 MB          | 185 MB        | 336 MB        |

Data packs on the volume after install: 169 MB (download 104 MB: dictionary 14, sentences 20,
MT 70).

## Where the venv went (1 020 → 572 MB; site-packages, MB)

| Package                     | Before | After | How                                                       |
| --------------------------- | ------ | ----- | --------------------------------------------------------- |
| lingua                      | 292    | 0     | replaced by `detect.py` (wordfreq naive Bayes)            |
| ctranslate2 + .libs         | 147    | 76    | `strip --strip-unneeded` of shared libraries              |
| spacy                       | 127    | 17    | strip                                                     |
| wordfreq                    | 58     | ~16   | only `large_nl` + `small_{nl,en,de,fr,es,it,pt,pl,uk,ru}` |
| nl_core_news_md             | 53     | 53    | kept (see below)                                          |
| blis / numpy(.libs) / thinc | 104    | ~75   | strip                                                     |
| simplemma                   | 19     | <1    | Dutch data only                                           |
| `__pycache__` (bytecode)    | 55     | 0     | compiled on first start into `/cache/pycache`             |
| `tests` directories         | 25     | 0     | deleted                                                   |
| setuptools                  | 7      | 0     | build-time only                                           |

All shared-library stripping was verified by running the full pytest suite (775 tests) inside
the final image against the real data.

Remaining big items: spaCy model 53 MB, ctranslate2 74 MB (one library, no CUDA split
available), blis 34 MB, numpy 45 MB, pypdfium2 9 MB, lxml 12 MB, uvloop 16 MB.

## Runtime

| Fresh container                  | Before  | After   |
| -------------------------------- | ------- | ------- |
| `/health` answers                | 2.5 s   | 4.3 s   |
| first `/analyze/text` after that | 3.3–7 s | 4–6.6 s |
| first `/translate`               | 0.9 s   | 0.6 s   |
| RSS after analyze + translate    | ~770 MB | ~750 MB |

The ~1.8 s slower start is the missing bytecode (22 MB compiled into `/cache/pycache` on first
start; a restart of the same container is as fast as before). Trade: 55 MB less image.

## Accuracy

**Language detection** (`/detect`; Tatoeba pairs and dictionary words from our data, n in
brackets): new detector vs lingua.

| Set                                    | lingua | new   |
| -------------------------------------- | ------ | ----- |
| Dutch sentences (1000)                 | 95.6%  | 99.8% |
| English sentences (1000)               | 97.2%  | 99.5% |
| Dutch words, Zipf ≥ 3 (780)            | 63.7%  | 82.9% |
| Dutch rare words, Zipf < 2.5 (1000)    | 69.8%  | 73.1% |
| English glosses, 1–2 words (826)       | 60.4%  | 81.0% |
| de/fr/es/it/pt/pl/uk/ru sentences (11) | 11/11  | 11/11 |

Afrikaans is no longer a candidate (no wordfreq list). The M1 deck auto-detection uses exactly
these field kinds (headwords, glosses, sentences); `pnpm anki-report` needs a live Anki and was
not re-run (leftover).

**spaCy `sm` vs `md`** (pytest precision sets with the real dictionary):

| Gate                             | md            | sm                                                        |
| -------------------------------- | ------------- | --------------------------------------------------------- |
| grammar_cases precision / recall | 1.000 / 1.000 | 0.994 / 0.963                                             |
| lemma precision + pipeline cases | all pass      | 7 failures (lopen, aten, deelnemen, sneed, aantrekken, …) |
| `/similar` (word vectors)        | works         | impossible: no vectors                                    |

Decision: keep `nl_core_news_md` (40 MB more, but the lemma and grammar gates regress and
distractors need the vectors).

**Translation model**: the float32 CTranslate2 conversion (157 MB, quantised to int8 at load) vs
the original OPUS-MT Marian release converted to int8 on disk (84 MB), 60 Tatoeba sentences,
beam 4: 56/60 identical outputs; BLEU vs the Tatoeba references 61.7 → 63.9; same speed. The
four differences are synonyms ("Dinner looks really good" → "The food looks very good"). Kept.

## OCR decision

The default server image keeps Tesseract (course import of scans and photo import are core
server features; 112 MB). `-slim` (`--build-arg OCR=0`) leaves it out: `/ocr` and `/course/ocr`
answer 503 with an install hint and `GET /health` reports `"ocr": false`. The desktop sidecar
should start without OCR (same runtime check) and bundle Tesseract later only if wanted.

## What the desktop sidecar (D4) needs

- PyInstaller (or similar) bundle of `kenning_nlp` with the same trimming: no lingua; Dutch-only
  simplemma; trimmed wordfreq data; spaCy `nl_core_news_md`; ctranslate2 + sentencepiece.
  Expected ~450–550 MB unpacked before compression.
- `KENNING_DATA_DIR` = an app-data directory, `KENNING_PACKS=download`, and either
  `KENNING_PACKS_DIR` = bundled archives (offline installer, +104 MB) or `KENNING_PACKS_URL` =
  public pack host (smaller installer, first-run download). `GET /health` → `packs` drives a
  progress UI; `POST /admin/packs` retries.
- No Tesseract by default (`ocr: false` in `/health`; the UI should hide photo/scan import).
- `PYTHONPYCACHEPREFIX` to a writable cache dir.
- A public place for the pack archives (the repository's releases are private).
