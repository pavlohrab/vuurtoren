# syntax=docker/dockerfile:1
# Kenning NLP service. Build context: server/nlp (see deploy/compose.yml).
#
# The Wiktionary dictionary is built AT IMAGE BUILD TIME in a throwaway stage: the 250 MB
# Kaikki download never reaches the final image, only the ~35 MB SQLite file does, and a
# self-hoster gets working /gloss with a plain `docker compose up --build`. The builder uses
# only the standard library, so it does not depend on the (slow) Python dependency layer.
# Reproducibility: Kaikki and Tatoeba only publish a rolling "latest" export, so scripts/ pin the
# SHA-256 + size of the snapshot the data was built from (scripts/pinned_download.py). When
# upstream refreshes, the build stops with a clear message. To build from the new data anyway:
#   docker build --build-arg KAIKKI_ACCEPT_NEW=1 --build-arg TATOEBA_ACCEPT_NEW=1 ...
# (then record the printed digests in the scripts). To use your own copy or mirror:
#   --build-arg KAIKKI_URL=... KAIKKI_SHA256=<hex> (empty = no check) KAIKKI_SIZE=<bytes> (0 = none)
#   --build-arg TATOEBA_BASE_URL=...
#
# The Tatoeba sentence DB (/sentences, and the perfect-tense evidence behind /forms `aux`) is built
# the same way, in a throwaway stage, but that stage needs the Python dependencies (the spaCy
# pipeline analyses ~150k sentences, ~4 min): it therefore starts from the shared `venv` stage, which
# the runtime image copies as well, so the dependencies are installed (and cached) only once. The
# ~30 MB of Tatoeba exports never reach the final image, only the ~50 MB SQLite file.

# ---- Stage 1: dictionary ---------------------------------------------------------------
FROM python:3.12-slim AS dictionary
ARG KAIKKI_URL=https://kaikki.org/dictionary/Dutch/kaikki.org-dictionary-Dutch.jsonl
# Defaults ("-") mean: use the digest and size pinned in scripts/build_dictionary.py.
ARG KAIKKI_SHA256=-
ARG KAIKKI_SIZE=-
ARG KAIKKI_ACCEPT_NEW=0
WORKDIR /build
COPY src/kenning_nlp/__init__.py src/kenning_nlp/dictionary.py src/kenning_nlp/compound.py \
    src/kenning_nlp/wordforms.py src/kenning_nlp/nl.py src/kenning_nlp/
COPY scripts/build_dictionary.py scripts/pinned_download.py scripts/
RUN set -eu; \
    args=""; \
    [ "$KAIKKI_SHA256" = "-" ] || args="$args --sha256=$KAIKKI_SHA256"; \
    [ "$KAIKKI_SIZE" = "-" ] || args="$args --size=$KAIKKI_SIZE"; \
    [ "$KAIKKI_ACCEPT_NEW" = "0" ] || args="$args --accept-new-upstream"; \
    PYTHONPATH=src python scripts/build_dictionary.py --url "$KAIKKI_URL" $args \
    --output /out/dictionary-nl.sqlite

# ---- Stage 2: translation model --------------------------------------------------------
# OPUS-MT nl->en (CTranslate2, ~160 MB) fetched at build time like the dictionary: the script is
# stdlib-only, pins a commit and verifies SHA-256, so the image works offline with a plain
# `docker compose up --build` and no first-request download or writable volume is needed.
FROM python:3.12-slim AS mtmodel
WORKDIR /build
COPY scripts/fetch_mt_model.py scripts/
RUN python scripts/fetch_mt_model.py --output /out/mt-nl-en

# ---- Stage 3: Python environment ---------------------------------------------------------
FROM python:3.12-slim AS venv
RUN pip install --no-cache-dir uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

WORKDIR /app
# Dependencies first (cached unless pyproject/uv.lock change). The spaCy model is a locked
# wheel dependency (nl-core-news-md), so no separate `spacy download` is needed.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev

# ---- Stage 4: sentences ------------------------------------------------------------------
# Needs the dictionary (the pipeline's lemma logic reads it) and the spaCy model.
FROM venv AS sentences
ARG TATOEBA_BASE_URL=https://downloads.tatoeba.org/exports/per_language
ARG TATOEBA_ACCEPT_NEW=0
ENV KENNING_DICT_PATH=/in/dictionary-nl.sqlite
COPY --from=dictionary /out/dictionary-nl.sqlite /in/dictionary-nl.sqlite
COPY scripts/build_sentences.py scripts/pinned_download.py scripts/
RUN set -eu; \
    args=""; \
    [ "$TATOEBA_ACCEPT_NEW" = "0" ] || args="--accept-new-upstream"; \
    python scripts/build_sentences.py --processes 4 --download-dir /tmp/tatoeba \
    --base-url "$TATOEBA_BASE_URL" $args --output /out/sentences-nl.sqlite

# ---- Stage 5: runtime ------------------------------------------------------------------
FROM python:3.12-slim

# Tesseract + Dutch/Ukrainian (English is a dependency of the base package) traineddata.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-nld tesseract-ocr-ukr \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    KENNING_DICT_PATH=/data/dictionary-nl.sqlite \
    KENNING_SENTENCES_PATH=/data/sentences-nl.sqlite \
    KENNING_MT_DIR=/data/mt-nl-en

WORKDIR /app
# The project is installed in editable mode, so /app (src) must sit next to /opt/venv.
COPY --from=venv /opt/venv /opt/venv
COPY --from=venv /app /app

COPY --from=dictionary /out/dictionary-nl.sqlite /data/dictionary-nl.sqlite
COPY --from=sentences /out/sentences-nl.sqlite /data/sentences-nl.sqlite
COPY --from=mtmodel /out/mt-nl-en /data/mt-nl-en

RUN useradd --system --uid 10001 kenning
USER kenning

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["uvicorn", "kenning_nlp.app:app", "--host", "0.0.0.0", "--port", "8000"]
