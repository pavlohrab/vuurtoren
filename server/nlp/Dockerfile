# syntax=docker/dockerfile:1
# Kenning NLP service. Build context: server/nlp (see deploy/compose.yml).
#
# The Wiktionary dictionary is built AT IMAGE BUILD TIME in a throwaway stage: the 250 MB
# Kaikki download never reaches the final image, only the ~35 MB SQLite file does, and a
# self-hoster gets working /gloss with a plain `docker compose up --build`. The builder uses
# only the standard library, so it does not depend on the (slow) Python dependency layer.
# Re-run with `--build-arg KAIKKI_URL=...` or `--no-cache` to refresh the dictionary.

# ---- Stage 1: dictionary ---------------------------------------------------------------
FROM python:3.12-slim AS dictionary
ARG KAIKKI_URL=https://kaikki.org/dictionary/Dutch/kaikki.org-dictionary-Dutch.jsonl
WORKDIR /build
COPY src/kenning_nlp/__init__.py src/kenning_nlp/dictionary.py src/kenning_nlp/
COPY scripts/build_dictionary.py scripts/
RUN PYTHONPATH=src python scripts/build_dictionary.py --url "$KAIKKI_URL" \
    --output /out/dictionary-nl.sqlite

# ---- Stage 2: translation model --------------------------------------------------------
# OPUS-MT nl->en (CTranslate2, ~160 MB) fetched at build time like the dictionary: the script is
# stdlib-only, pins a commit and verifies SHA-256, so the image works offline with a plain
# `docker compose up --build` and no first-request download or writable volume is needed.
FROM python:3.12-slim AS mtmodel
WORKDIR /build
COPY scripts/fetch_mt_model.py scripts/
RUN python scripts/fetch_mt_model.py --output /out/mt-nl-en

# ---- Stage 3: runtime ------------------------------------------------------------------
FROM python:3.12-slim

# Tesseract + Dutch/Ukrainian (English is a dependency of the base package) traineddata.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-nld tesseract-ocr-ukr \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    KENNING_DICT_PATH=/data/dictionary-nl.sqlite \
    KENNING_MT_DIR=/data/mt-nl-en

WORKDIR /app
# Dependencies first (cached unless pyproject/uv.lock change). The spaCy model is a locked
# wheel dependency (nl-core-news-md), so no separate `spacy download` is needed.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev

COPY --from=dictionary /out/dictionary-nl.sqlite /data/dictionary-nl.sqlite
COPY --from=mtmodel /out/mt-nl-en /data/mt-nl-en

RUN useradd --system --uid 10001 kenning
USER kenning

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["uvicorn", "kenning_nlp.app:app", "--host", "0.0.0.0", "--port", "8000"]
