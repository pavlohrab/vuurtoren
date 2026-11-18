# syntax=docker/dockerfile:1
# kenning-nlp:<tag>-full — the standard image plus all data packs inside, for offline installs.
#
#   docker build -t kenning-nlp:local server/nlp
#   docker build -f server/nlp/full.Dockerfile --build-arg BASE=kenning-nlp:local \
#       -t kenning-nlp:local-full server/nlp
#
# The pack archives sit in /opt/kenning-packs (KENNING_PACKS_DIR); at first start the server
# unpacks them onto the /data volume (seconds, no network). Where the archives come from, first
# match wins:
#   1. server/nlp/dist/packs/*.tar.gz in the build context (made beforehand with
#      `uv run python scripts/build_packs.py --out dist/packs`; CI does this natively once, so a
#      multi-arch build does not run spaCy under emulation; the data are the same on every arch);
#   2. --build-arg PACKS_URL=<release assets URL>: downloaded and checked against packs.json;
#   3. otherwise built here from the pinned upstream sources (Kaikki, Tatoeba, OPUS-MT; ~10 min,
#      ~1 GB of downloads). KAIKKI_* and TATOEBA_* build args work as before.
ARG BASE=kenning-nlp:local

# ---- dictionary (standard library only) ----------------------------------------------------
FROM python:3.12.16-slim AS dictionary
ARG PACKS_URL=
ARG KAIKKI_URL=https://kaikki.org/dictionary/Dutch/kaikki.org-dictionary-Dutch.jsonl
# Defaults ("-") mean: use the digest and size pinned in scripts/build_dictionary.py.
ARG KAIKKI_SHA256=-
ARG KAIKKI_SIZE=-
ARG KAIKKI_ACCEPT_NEW=0
WORKDIR /build
COPY src/kenning_nlp/__init__.py src/kenning_nlp/dictionary.py src/kenning_nlp/compound.py \
    src/kenning_nlp/wordforms.py src/kenning_nlp/nl.py src/kenning_nlp/datadir.py src/kenning_nlp/
COPY scripts/build_dictionary.py scripts/pinned_download.py scripts/
# SKIP_BUILD=1 (CI, with dist/packs in the context) or PACKS_URL: nothing to build here.
ARG SKIP_BUILD=0
RUN set -eu; mkdir -p /out; [ -z "$PACKS_URL" ] && [ "$SKIP_BUILD" = 0 ] || exit 0; \
    args=""; \
    [ "$KAIKKI_SHA256" = "-" ] || args="$args --sha256=$KAIKKI_SHA256"; \
    [ "$KAIKKI_SIZE" = "-" ] || args="$args --size=$KAIKKI_SIZE"; \
    [ "$KAIKKI_ACCEPT_NEW" = "0" ] || args="$args --accept-new-upstream"; \
    PYTHONPATH=src python scripts/build_dictionary.py --url "$KAIKKI_URL" $args \
    --output /out/dictionary-nl.sqlite

# ---- sentences + translation model + archives (needs the service's libraries) -------------
FROM ${BASE} AS packs
ARG PACKS_URL=
ARG TATOEBA_BASE_URL=https://downloads.tatoeba.org/exports/per_language
ARG TATOEBA_ACCEPT_NEW=0
USER root
ENV KENNING_DATA_DIR=/out KENNING_PACKS=off
COPY --from=dictionary /out /out
COPY . /ctx
RUN set -eu; \
    if ls /ctx/dist/packs/*.tar.gz >/dev/null 2>&1; then \
      mkdir -p /opt/kenning-packs && cp /ctx/dist/packs/*.tar.gz /opt/kenning-packs/; \
      cp /ctx/src/kenning_nlp/packs.json /app/src/kenning_nlp/packs.json; \
      rm -rf /ctx /out; exit 0; \
    fi; \
    rm -rf /ctx; \
    if [ -n "$PACKS_URL" ]; then \
      python scripts/build_packs.py --out /opt/kenning-packs --download "$PACKS_URL"; exit 0; \
    fi; \
    args=""; [ "$TATOEBA_ACCEPT_NEW" = "0" ] || args="--accept-new-upstream"; \
    python scripts/build_sentences.py --processes 4 --download-dir /tmp/tatoeba \
      --base-url "$TATOEBA_BASE_URL" $args --output /out/sentences-nl.sqlite; \
    python scripts/fetch_mt_model.py --output /out/mt-nl-en; \
    python scripts/build_packs.py --out /opt/kenning-packs --from-data /out; \
    rm -rf /tmp/tatoeba /out

# ---- final -----------------------------------------------------------------------------------
FROM ${BASE}
# packs.json is rewritten by build_packs.py with the digests of the archives built above.
COPY --from=packs /app/src/kenning_nlp/packs.json /app/src/kenning_nlp/packs.json
COPY --from=packs /opt/kenning-packs /opt/kenning-packs
ENV KENNING_PACKS_DIR=/opt/kenning-packs
