# syntax=docker/dockerfile:1
# Vuurtoren NLP service. Build context: server/nlp (see deploy/compose.yml).
#
#   docker build server/nlp                          -> vuurtoren-nlp:<tag>       (with OCR)
#   docker build --build-arg OCR=0 server/nlp        -> vuurtoren-nlp:<tag>-slim  (no OCR)
#   docker build -f server/nlp/full.Dockerfile ...   -> vuurtoren-nlp:<tag>-full  (data packs inside)
#
# The image holds code and libraries only. The data (dictionary, Tatoeba sentences, translation
# model; ~100 MB download, ~185 MB installed) are versioned *data packs* on the /data volume:
# at startup the server installs missing or outdated packs in the background, from
# VUURTOREN_PACKS_DIR (bundled archives, the -full image), VUURTOREN_PACKS_URL (release assets) or, with
# neither, by building them here from the pinned upstream sources with scripts/ (~10 minutes,
# once). See vuurtoren_nlp/packs.py and docs/dev/architecture.md ("Data packs").
#
# Size: a small wordfreq-based language detector,
# Dutch-only simplemma data, wordfreq lists only for the detected languages, no tests or bytecode
# in the venv, no build tools in the runtime. Base images are pinned to a patch release (all
# stages share it: the venv is copied between them); .github/dependabot.yml proposes updates.

# ---- Stage 1: Python environment ----------------------------------------------------------
FROM python:3.12.16-slim AS venv
# OCR=1 (default) installs the `ocr` extra: RapidOCR, ONNX Runtime, OpenCV and the bundled
# PaddleOCR models (~30 MB, inside the rapidocr wheel, so OCR works offline from the first start).
ARG OCR=1
# Pinned uv binary from its official image (no pip, nothing extra in the layer).
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_NO_CACHE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
# Dependencies first (cached unless pyproject/uv.lock change). The spaCy model is a locked
# wheel dependency (nl-core-news-md), so no separate `spacy download` is needed.
COPY pyproject.toml uv.lock ./
RUN extra=""; [ "$OCR" = 1 ] && extra="--extra ocr --extra speech"; \
    uv sync --locked --no-dev --no-install-project $extra
# Trim what the service never loads:
#   debug symbols of the compiled extensions (strip: ~220 MB, mostly ctranslate2 and spaCy);
#   simplemma: Dutch only; wordfreq: Dutch (large, for frequencies) + the small lists of the
#   languages /detect knows (vuurtoren_nlp/detect.py); test suites; bytecode (compiled on first
#   start into PYTHONPYCACHEPREFIX instead); setuptools (build-time only).
# binutils (strip) stays in this throwaway stage.
RUN apt-get update && apt-get install -y --no-install-recommends binutils \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; sp=/opt/venv/lib/python3.12/site-packages; \
    find /opt/venv -name '*.so*' -type f -exec strip --strip-unneeded {} +; \
    find "$sp/simplemma/strategies/dictionaries/data" -type f ! -name 'nl.plzma' -delete; \
    find "$sp/wordfreq/data" -type f ! -regex '.*/\(large_nl\|small_\(nl\|en\|de\|fr\|es\|it\|pt\|pl\|uk\|ru\)\)\.msgpack\.gz' -delete; \
    find /opt/venv -depth -type d \( -name tests -o -name __pycache__ \) -exec rm -rf {} +; \
    rm -rf "$sp/setuptools" "$sp"/setuptools-*.dist-info "$sp/pkg_resources" "$sp/_distutils_hack"
COPY src ./src
COPY scripts ./scripts
RUN extra=""; [ "$OCR" = 1 ] && extra="--extra ocr --extra speech"; \
    uv sync --locked --no-dev $extra && find /opt/venv /app -depth -name __pycache__ -exec rm -rf {} +

# ---- Stage 2: runtime ------------------------------------------------------------------
FROM python:3.12.16-slim AS runtime

# OCR=1 (default): RapidOCR (installed above) reads Dutch pages. OCR=0 gives the -slim image:
# everything else works, /ocr and /course/ocr answer 503 with an install hint (GET /health
# shows "ocr": false).

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONPYCACHEPREFIX=/cache/pycache \
    VUURTOREN_DATA_DIR=/data \
    VUURTOREN_PACKS=auto

WORKDIR /app
# The project is installed in editable mode, so /app (src, scripts) must sit next to /opt/venv.
COPY --from=venv /opt/venv /opt/venv
COPY --from=venv /app /app

# /data is the data-pack volume: owned by the service user so a fresh named volume inherits it.
RUN useradd --system --uid 10001 vuurtoren \
    && mkdir -p /cache/course /cache/pycache /data && chown -R vuurtoren /cache /data
USER vuurtoren

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=4)"
# Exactly ONE worker process: course OCR jobs live in this process's memory
# (`GET /course/ocr/{id}` must reach the process that started the job), the grammar-example
# cache and the data packs are written by one process. Blocking work runs in the threadpool, so
# one worker still serves requests concurrently. Do not add --workers or WEB_CONCURRENCY; scale
# with one container per user instead.
CMD ["uvicorn", "vuurtoren_nlp.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
