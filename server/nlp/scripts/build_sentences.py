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
import urllib.request
from collections.abc import Iterator
from pathlib import Path

from kenning_nlp.models import TextAnalysis
from kenning_nlp.pipeline import analyze_doc, get_nlp
from kenning_nlp.sentences import Analyzer, build_sentence_db

BASE_URL = "https://downloads.tatoeba.org/exports/per_language"
FILES = {
    "nld_sentences.tsv.bz2": f"{BASE_URL}/nld/nld_sentences.tsv.bz2",
    "nld-eng_links.tsv.bz2": f"{BASE_URL}/nld/nld-eng_links.tsv.bz2",
    "eng_sentences.tsv.bz2": f"{BASE_URL}/eng/eng_sentences.tsv.bz2",
}
DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def download(url: str, dest: Path) -> None:
    """Stream ``url`` to ``dest`` (via a .part file), printing the size up front."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "kenning-build-sentences"})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 (fixed https URL)
        total = int(resp.headers.get("Content-Length", 0))
        print(f"Downloading {url} ({total / 1e6:.1f} MB)")
        part = dest.with_name(dest.name + ".part")
        with part.open("wb") as fh:
            while chunk := resp.read(1 << 20):
                fh.write(chunk)
    part.replace(dest)


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
    ap.add_argument("--keep-downloads", action="store_true", help="keep the downloaded exports")
    args = ap.parse_args()

    downloaded = []
    for name, url in FILES.items():
        dest = args.download_dir / name
        if not dest.exists():
            download(url, dest)
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
