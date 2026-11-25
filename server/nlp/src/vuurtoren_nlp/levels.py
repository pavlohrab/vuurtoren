"""A rough CEFR level per Dutch word (``levels-nl.tsv.gz``, built from NT2Lex by
``scripts/build_levels.py``; CC BY-NC-SA 4.0, kept apart from the CC BY-SA data).

``word_level("huis", "noun")`` → ``"A1"``. The part of speech is the dictionary's (Kaikki's:
noun, verb, adj …); without one, or when the word has no entry for it, any entry of the word
counts (the lowest level). ``None`` for a word NT2Lex doesn't have.
"""

from __future__ import annotations

import gzip
from functools import lru_cache
from pathlib import Path

LEVELS = ("A1", "A2", "B1", "B2", "C1")
# spaCy's universal parts of speech to the dictionary's (as levels-nl.tsv.gz keys them).
POS_KAIKKI: dict[str, str] = {
    "NOUN": "noun",
    "PROPN": "name",
    "VERB": "verb",
    "AUX": "verb",
    "ADJ": "adj",
    "ADV": "adv",
    "ADP": "prep",
    "PRON": "pron",
    "DET": "det",
    "NUM": "num",
    "CCONJ": "conj",
    "SCONJ": "conj",
    "INTJ": "intj",
}


@lru_cache(maxsize=1)
def _table() -> dict[str, dict[str, str]]:
    path = Path(__file__).with_name("levels-nl.tsv.gz")
    out: dict[str, dict[str, str]] = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            word, pos, level = line.rstrip("\n").split("\t")
            out.setdefault(word, {})[pos] = level
    return out


def word_level(word: str, pos: str | None = None) -> str | None:
    """The word's rough level, or ``None``."""
    by_pos = _table().get(word.strip().lower())
    if not by_pos:
        return None
    if pos and pos in by_pos:
        return by_pos[pos]
    return min(by_pos.values(), key=LEVELS.index)
