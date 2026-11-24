"""Build ``src/vuurtoren_nlp/compound-verbs-nl.txt.gz`` from the OpenTaal word list.

The pipeline joins a split particle to its verb only when the joined verb is a real word
(``_joinable`` in ``pipeline.py``). English Wiktionary (Kaikki) misses many common separable
verbs (meegeven, wegblijven, instromen), so OpenTaal, the free Dutch spelling word list, is
the second check. This keeps only what that check needs: lowercase words ending in -en that are
a word plus a verb from the same list (meegeven = mee + geven), about 58,000 words.

Source: OpenTaal word list (https://github.com/OpenTaal/opentaal-wordlist), Revised BSD
License and/or CC BY 3.0; see DATA_LICENSES.md. Pinned to one commit so builds repeat.

    uv run python scripts/build_compound_verbs.py
"""

from __future__ import annotations

import gzip
import urllib.request
from pathlib import Path

COMMIT = "b250510dda431785f962019167d1415198ff3905"  # 2025-02-09
URL = f"https://raw.githubusercontent.com/OpenTaal/opentaal-wordlist/{COMMIT}/wordlist.txt"
OUT = Path(__file__).resolve().parents[1] / "src" / "vuurtoren_nlp" / "compound-verbs-nl.txt.gz"


def compound_verbs(words: set[str]) -> list[str]:
    """Words ending in -en that split into a word and a verb (-en) of the list."""
    low = {w for w in words if w.isalpha() and w.islower()}
    verbs = {w for w in low if w.endswith("en")}
    out = []
    for w in verbs:
        if any(w[:k] in low and w[k:] in verbs for k in range(2, len(w) - 3)):
            out.append(w)
    return sorted(out)


def main() -> None:
    with urllib.request.urlopen(URL, timeout=120) as r:  # noqa: S310 (fixed https URL)
        words = {line.strip() for line in r.read().decode("utf-8").splitlines() if line.strip()}
    out = compound_verbs(words)
    header = f"# OpenTaal word list {COMMIT}, BSD-3-Clause and/or CC BY 3.0 (DATA_LICENSES.md)\n"
    # mtime=0: the same list gives the same bytes.
    with OUT.open("wb") as f, gzip.GzipFile(fileobj=f, mode="wb", mtime=0) as gz:
        gz.write((header + "\n".join(out) + "\n").encode("utf-8"))
    print(f"wrote {OUT} ({len(out)} words, {OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
