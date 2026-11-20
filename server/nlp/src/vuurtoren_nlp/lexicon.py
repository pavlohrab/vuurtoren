"""Optional lemma oracle backed by the Kaikki dictionary DB (``data/dictionary-nl.sqlite``).

The ``forms`` table maps inflected form -> (lemma, POS), which is a far better lemma oracle
than simplemma (no ``kat -> kater``, ``boot -> boten``). The DB is git-ignored and built
locally (``scripts/build_dictionary.py``); when it is absent (CI) every method degrades to
"no opinion" so callers fall back to simplemma.
"""

from __future__ import annotations

import sqlite3
import threading
from functools import lru_cache
from pathlib import Path

from vuurtoren_nlp.dictionary import default_db_path
from vuurtoren_nlp.freq import zipf

# spaCy UPOS -> Kaikki ``pos`` values. UPOS not listed here are not POS-filtered.
_POS_MAP: dict[str, tuple[str, ...]] = {
    "NOUN": ("noun",),
    "PROPN": ("noun", "name"),
    "VERB": ("verb",),
    "AUX": ("verb",),
    "ADJ": ("adj",),
}


class Lexicon:
    """Read-only lemma lookups; ``available`` is False when the DB file does not exist."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or default_db_path()
        self.available = self.db_path.is_file()
        self._local = threading.local()
        self.lemmas = lru_cache(maxsize=65536)(self._lemmas)
        self.is_word = lru_cache(maxsize=65536)(self._is_word)
        self.is_headword = lru_cache(maxsize=65536)(self._is_headword)

    def _con(self) -> sqlite3.Connection:
        con = getattr(self._local, "con", None)
        if con is None:
            con = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
            self._local.con = con
        return con

    def _lemmas(self, form: str, pos: str) -> tuple[str, ...]:
        """Lemmas ``form`` is an inflected form of (best first), restricted to the UPOS ``pos``.

        Empty when the DB is absent or has no reading of the form for that POS (so the caller
        keeps spaCy's lemma instead of trusting a wrong-POS reading such as boot -> boten).
        """
        if not self.available:
            return ()
        rows = (
            self._con()
            .execute("SELECT DISTINCT lemma, pos FROM forms WHERE lower(form) = ?", (form.lower(),))
            .fetchall()
        )
        wanted = _POS_MAP.get(pos)
        if wanted:
            rows = [r for r in rows if r[1] in wanted]
        lemmas = {r[0].lower() for r in rows}
        # Most frequent lemma first: "katten" (noun) -> kat before rarer readings.
        return tuple(sorted(lemmas, key=lambda w: (-zipf(w), len(w), w)))

    def _is_headword(self, word: str) -> bool | None:
        """True if ``word`` is a lemma entry of its own: not merely an inflected-form entry.

        Kaikki has entries such as ``opbel`` (verb) that are only forms of another lemma; an
        entry counts if some POS reading of it is not listed as a form of a different lemma
        with the same POS. ``None`` without DB.
        """
        if not self.available:
            return None
        row = (
            self._con()
            .execute(
                "SELECT 1 FROM entries e WHERE lower(e.word) = ? AND NOT EXISTS ("
                " SELECT 1 FROM forms f WHERE lower(f.form) = lower(e.word) AND f.pos = e.pos"
                " AND lower(f.lemma) != lower(e.word)) LIMIT 1",
                (word.lower(),),
            )
            .fetchone()
        )
        return row is not None

    def _is_word(self, word: str) -> bool | None:
        """True if ``word`` is a headword or a known form; None when there is no DB."""
        if not self.available:
            return None
        con = self._con()
        low = word.lower()
        return bool(
            con.execute("SELECT 1 FROM entries WHERE lower(word) = ? LIMIT 1", (low,)).fetchone()
            or con.execute("SELECT 1 FROM forms WHERE lower(form) = ? LIMIT 1", (low,)).fetchone()
        )


@lru_cache(maxsize=1)
def get_lexicon() -> Lexicon:
    """Process-wide lexicon (clear with ``get_lexicon.cache_clear()`` after changing the env)."""
    return Lexicon()
