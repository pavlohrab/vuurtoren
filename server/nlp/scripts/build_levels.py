"""Build ``src/vuurtoren_nlp/levels-nl.tsv.gz``: a rough CEFR level per Dutch word, from NT2Lex.

NT2Lex counts how often each word appears in Dutch learner texts (textbooks, simplified readers)
graded A1 to C1. A word's level here is the first level where it appears at least twice, else the
first level it appears at all. One level per (lemma, part of speech); single words only.

Source: NT2Lex (Tack, François, Desmet & Fairon 2018), CC BY-NC-SA 4.0. It stays a separate file
with its own licence (DATA_LICENSES.md), never mixed into the CC BY-SA content. Pinned by SHA-256.

    uv run python scripts/build_levels.py
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import urllib.request
from pathlib import Path

URL = "https://cental.uclouvain.be/cefrlex/static/resources/nl/NT2Lex-CGN-v01.tsv"
SHA256 = "0acae87e65a6ceb4237dcf23c5576488338570f3431ac52e159b6fce9e1a0515"
OUT = Path(__file__).resolve().parents[1] / "src" / "vuurtoren_nlp" / "levels-nl.tsv.gz"
LEVELS = ["A1", "A2", "B1", "B2", "C1"]
# CGN tags (the part before the brackets) to the dictionary's (Kaikki's) parts of speech.
POS = {
    "N": "noun",
    "WW": "verb",
    "ADJ": "adj",
    "BW": "adv",
    "VZ": "prep",
    "VNW": "pron",
    "LID": "det",
    "TW": "num",
    "VG": "conj",
    "TSW": "intj",
    "SPEC": "name",
}


def first_level(row: dict[str, str]) -> str | None:
    """The first level with at least two occurrences, else the first with any."""
    seen = [lv for lv in LEVELS if row.get(f"F@{lv}", "-") != "-"]
    often = [lv for lv in seen if int(row[f"F@{lv}"]) >= 2]
    return (often or seen or [None])[0]


def levels(tsv: str) -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    for row in csv.DictReader(io.StringIO(tsv), delimiter="\t"):
        word = row["word"].strip().lower()
        pos = POS.get(row["tag"].split("(")[0].strip())
        level = first_level(row)
        if " " in word or not pos or not level:
            continue
        key = (word, pos)
        if key not in out or LEVELS.index(level) < LEVELS.index(out[key]):
            out[key] = level
    return out


def main() -> None:
    with urllib.request.urlopen(URL, timeout=120) as r:  # noqa: S310 (fixed https URL)
        data = r.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise SystemExit(
            f"NT2Lex changed upstream (sha256 {digest}); check it, then update the pin"
        )
    table = levels(data.decode("utf-8"))
    header = (
        "# NT2Lex (Tack, François, Desmet & Fairon 2018), CC BY-NC-SA 4.0, "
        "https://cental.uclouvain.be/cefrlex/nt2lex/ ; "
        "derived: first level seen (DATA_LICENSES.md)\n"
    )
    lines = [f"{w}\t{p}\t{lv}" for (w, p), lv in sorted(table.items())]
    with OUT.open("wb") as f, gzip.GzipFile(fileobj=f, mode="wb", mtime=0) as gz:
        gz.write((header + "\n".join(lines) + "\n").encode("utf-8"))
    print(f"wrote {OUT} ({len(lines)} words, {OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
