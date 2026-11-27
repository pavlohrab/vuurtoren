"""The Dutch word lists the language server's rules use, as data (RL0).

Each list is a file in ``rules/nl/``: ``*.txt`` has one entry per line, ``*.tsv`` one pair per
line (the Dutch, a tab, the other side). ``#`` starts a comment, also after an entry. The code
that uses a list names its file; docs/dev/algorithms.md has the index of the rules.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

_DIR = Path(__file__).parent / "nl"


def _rows(name: str) -> list[str]:
    rows = []
    for raw in (_DIR / name).read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if line.strip():
            rows.append(line.strip(" "))
    return rows


@cache
def words(name: str) -> tuple[str, ...]:
    """The entries of ``rules/nl/<name>``, in the file's order."""
    return tuple(_rows(name))


@cache
def pairs(name: str) -> dict[str, str]:
    """The pairs of ``rules/nl/<name>`` (a ``.tsv``), in the file's order."""
    out: dict[str, str] = {}
    for row in _rows(name):
        key, value = row.split("\t", 1)
        out[key] = value.strip()
    return out
