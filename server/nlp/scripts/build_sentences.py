"""Download Tatoeba's Dutch sentences + English translations and build ``data/sentences-nl.sqlite``.

Usage (from server/nlp)::

    uv run python scripts/build_sentences.py             # download (cached) + analyse + build
    uv run python scripts/build_sentences.py --limit 5000 --output /tmp/small.sqlite

Sources (official per-language exports, weekly, https://tatoeba.org/downloads; CC BY 2.0 FR,
see DATA_LICENSES.md)::

    exports/per_language/nld/nld_sentences.tsv.bz2    ~2.5 MB   id <TAB> nld <TAB> text
    exports/per_language/nld/nld-eng_links.tsv.bz2    ~1.1 MB   nld id <TAB> eng id
    exports/per_language/eng/eng_sentences.tsv.bz2    ~25 MB    id <TAB> eng <TAB> text

Only Dutch sentences with at least one English translation are kept. The analysis is the same
spaCy pipeline as ``POST /analyze/text`` (lemmas, separable verbs), so the lemmas match the app's.
"""

from __future__ import annotations

import argparse
import bz2
import sys
import time
from collections.abc import Iterator
from pathlib import Path

from pinned_download import PinMismatchError, download_verified

from vuurtoren_nlp.models import TextAnalysis
from vuurtoren_nlp.pipeline import analyze_doc, get_nlp
from vuurtoren_nlp.sentences import Analyzer, build_sentence_db

BASE_URL = "https://downloads.tatoeba.org/exports/per_language"
# Tatoeba publishes only the current weekly export (no dated archive), so we pin the SHA-256 of
# the exports the shipped data was built from (all last modified 2026-11-14):
# file name -> (path under the base URL, sha256, size in bytes).
FILES = {
    "nld_sentences.tsv.bz2": (
        "nld/nld_sentences.tsv.bz2",
        "822bb83c9a5be3b2d0f40c3aa7fb9acfb9d30e810611a6546d50c046b37c94cb",
        2_503_155,
    ),
    "nld-eng_links.tsv.bz2": (
        "nld/nld-eng_links.tsv.bz2",
        "5bba968054525cc0d224c4b559016ed7cb8eb2dcfa44e1a81244ebfb094d0c39",
        1_071_856,
    ),
    "eng_sentences.tsv.bz2": (
        "eng/eng_sentences.tsv.bz2",
        "3b5b3ecfcac5037b09f81ef048fa16fedc4d24838db5b6fbeedca1dfab374cbf",
        24_947_715,
    ),
}
DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def read_tsv(path: Path) -> Iterator[list[str]]:
    """Rows of a bz2-compressed Tatoeba TSV (blank / short lines skipped)."""
    with bz2.open(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 2:
                yield parts


def load_pairs(directory: Path) -> Iterator[tuple[int, str, str]]:
    """``(nld id, Dutch, English)``; with several translations the shortest English one."""
    english_ids: dict[int, list[int]] = {}
    for row in read_tsv(directory / "nld-eng_links.tsv.bz2"):
        if row[0].isdigit() and row[1].isdigit():
            english_ids.setdefault(int(row[0]), []).append(int(row[1]))
    wanted = {e for ids in english_ids.values() for e in ids}
    english = {
        int(r[0]): r[2]
        for r in read_tsv(directory / "eng_sentences.tsv.bz2")
        if len(r) >= 3 and r[0].isdigit() and int(r[0]) in wanted
    }
    for row in read_tsv(directory / "nld_sentences.tsv.bz2"):
        if len(row) < 3 or not row[0].isdigit():
            continue
        sid = int(row[0])
        candidates = [english[e] for e in english_ids.get(sid, []) if e in english]
        if candidates:
            yield sid, row[2], min(candidates, key=len)


def spacy_analyzer(n_process: int) -> Analyzer:
    """Analyser backed by the service's spaCy pipeline (``n_process`` worker processes)."""
    nlp = get_nlp("nl")

    def analyze(texts: list[str]) -> list[TextAnalysis]:
        return [analyze_doc(d) for d in nlp.pipe(texts, batch_size=128, n_process=n_process)]

    return analyze


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", type=Path, default=DATA_DIR / "sentences-nl.sqlite")
    ap.add_argument("--download-dir", type=Path, default=DATA_DIR / "tatoeba")
    ap.add_argument("--limit", type=int, default=0, help="only the first N sentence pairs (test)")
    ap.add_argument("--processes", type=int, default=1, help="spaCy worker processes")
    ap.add_argument(
        "--base-url",
        default=BASE_URL,
        help="where the exports live (e.g. a mirror or your own dated snapshot)",
    )
    ap.add_argument(
        "--accept-new-upstream",
        action="store_true",
        help="build from the downloaded exports even if they differ from the pinned snapshot",
    )
    ap.add_argument("--keep-downloads", action="store_true", help="keep the downloaded exports")
    args = ap.parse_args()

    downloaded = []
    for name, (path, sha256, size) in FILES.items():
        dest = args.download_dir / name
        if not dest.exists():
            try:
                download_verified(
                    f"{args.base_url.rstrip('/')}/{path}",
                    dest,
                    f"Tatoeba {name}",
                    sha256,
                    size,
                    args.accept_new_upstream,
                    "vuurtoren-build-sentences",
                )
            except PinMismatchError as e:
                print(f"error: {e}", file=sys.stderr)
                return 2
            downloaded.append(dest)

    t0 = time.perf_counter()
    pairs = load_pairs(args.download_dir)
    if args.limit:
        pairs = (p for _, p in zip(range(args.limit), pairs, strict=False))
    stats = build_sentence_db(pairs, spacy_analyzer(args.processes), args.output)
    print(
        f"Built {args.output}: {stats.sentences} sentences ({stats.candidates} analysed), "
        f"{stats.occurrences} occurrences over {stats.lemmas} lemmas, "
        f"{stats.aux_verbs} verbs with perfect-tense evidence "
        f"in {time.perf_counter() - t0:.0f}s ({args.output.stat().st_size / 1e6:.0f} MB)"
    )
    if not args.keep_downloads:
        for dest in downloaded:
            dest.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
