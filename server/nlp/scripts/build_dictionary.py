"""Download Kaikki.org's Dutch dictionary and build ``data/dictionary-nl.sqlite``.

Usage (from server/nlp)::

    uv run python scripts/build_dictionary.py            # download (cached) + build
    uv run python scripts/build_dictionary.py --input some.jsonl --output out.sqlite

Source: English Wiktionary via https://kaikki.org (CC BY-SA 4.0, see DATA_LICENSES.md).
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.request
from pathlib import Path

from kenning_nlp.dictionary import build_dictionary

KAIKKI_URL = "https://kaikki.org/dictionary/Dutch/kaikki.org-dictionary-Dutch.jsonl"
DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def download(url: str, dest: Path) -> None:
    """Stream ``url`` to ``dest`` (via a .part file), printing the size up front."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "kenning-build-dictionary"})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 (fixed https URL)
        total = int(resp.headers.get("Content-Length", 0))
        print(f"Downloading {url} ({total / 1e6:.0f} MB)")
        part = dest.with_name(dest.name + ".part")
        with part.open("wb") as fh:
            while chunk := resp.read(1 << 20):
                fh.write(chunk)
    part.replace(dest)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, help="existing Kaikki JSONL (skips the download)")
    ap.add_argument("--output", type=Path, default=DATA_DIR / "dictionary-nl.sqlite")
    ap.add_argument("--url", default=KAIKKI_URL)
    ap.add_argument("--keep-jsonl", action="store_true", help="keep the downloaded JSONL")
    args = ap.parse_args()

    src = args.input
    downloaded = False
    if src is None:
        src = DATA_DIR / "kaikki-nl.jsonl"
        if not src.exists():
            download(args.url, src)
            downloaded = True
    t0 = time.perf_counter()
    stats = build_dictionary(src, args.output)
    print(
        f"Built {args.output}: {stats['entries']} entries, {stats['forms']} forms "
        f"in {time.perf_counter() - t0:.1f}s ({args.output.stat().st_size / 1e6:.0f} MB)"
    )
    if downloaded and not args.keep_jsonl:
        src.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
