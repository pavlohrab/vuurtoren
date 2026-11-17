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
from pathlib import Path

from pinned_download import PinMismatchError, download_verified

from kenning_nlp.dictionary import build_dictionary

KAIKKI_URL = "https://kaikki.org/dictionary/Dutch/kaikki.org-dictionary-Dutch.jsonl"
# Kaikki only publishes a rolling "latest" file, so we pin the snapshot the data was built from
# (file last modified 2026-10-30). A mismatch stops the build; see pinned_download.py.
KAIKKI_SHA256 = "6e3335a4bcf9739cae0a7490beb1f31d8e8dcec61475fc701a6cfe63cdd65438"
KAIKKI_SIZE = 257_235_436
DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, help="existing Kaikki JSONL (skips the download)")
    ap.add_argument("--output", type=Path, default=DATA_DIR / "dictionary-nl.sqlite")
    ap.add_argument("--url", default=KAIKKI_URL)
    ap.add_argument("--sha256", default=KAIKKI_SHA256, help="expected SHA-256 ('' = no check)")
    ap.add_argument("--size", type=int, default=KAIKKI_SIZE, help="expected bytes (0 = no check)")
    ap.add_argument(
        "--accept-new-upstream",
        action="store_true",
        help="build from the downloaded file even if it differs from the pinned snapshot",
    )
    ap.add_argument("--keep-jsonl", action="store_true", help="keep the downloaded JSONL")
    args = ap.parse_args()

    src = args.input
    downloaded = False
    if src is None:
        src = DATA_DIR / "kaikki-nl.jsonl"
        if not src.exists():
            try:
                download_verified(
                    args.url,
                    src,
                    "Kaikki Dutch dump",
                    args.sha256 or None,
                    args.size or None,
                    args.accept_new_upstream,
                    "kenning-build-dictionary",
                )
            except PinMismatchError as e:
                print(f"error: {e}", file=sys.stderr)
                return 2
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
