"""Dictionary (glosses) built from Kaikki.org's Dutch Wiktionary extract (CC BY-SA).

Two halves share one schema:

* :func:`build_dictionary` turns a Kaikki JSONL file into a SQLite database. It is used by
  ``scripts/build_dictionary.py`` and by the tests (with a tiny fixture).
* :class:`Dictionary` is the read-only lookup used by ``POST /gloss``.

Schema::

    entries(id, word, pos, article, gender, glosses JSON, forms JSON, ipa)   -- index lower(word)
    forms(form, lemma, pos)                                                  -- index lower(form)
"""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Iterable, Iterator
from functools import lru_cache
from pathlib import Path
from typing import Any

from kenning_nlp.compound import PartEntry, real_glosses, split_compound

MAX_GLOSSES = 5
MAX_GLOSS_CHARS = 160
# Kaikki "forms" entries that are metadata, not word forms.
_SKIP_FORM_TAGS = {"table-tags", "inflection-template", "class", "romanization"}
_NEUTER = {"neuter"}
_COMMON = {"masculine", "feminine", "common-gender"}

SCHEMA = """
CREATE TABLE entries (
    id INTEGER PRIMARY KEY,
    word TEXT NOT NULL,
    pos TEXT NOT NULL,
    article TEXT,
    gender TEXT,
    glosses TEXT NOT NULL,
    forms TEXT NOT NULL,
    ipa TEXT
);
CREATE TABLE forms (form TEXT NOT NULL, lemma TEXT NOT NULL, pos TEXT NOT NULL);
"""
INDEXES = """
CREATE INDEX idx_entries_word ON entries(lower(word));
CREATE INDEX idx_forms_form ON forms(lower(form));
"""


def default_db_path() -> Path:
    """Database location: ``$KENNING_DICT_PATH`` or ``server/nlp/data/dictionary-nl.sqlite``."""
    env = os.environ.get("KENNING_DICT_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "data" / "dictionary-nl.sqlite"


def _gloss_text(sense: dict[str, Any]) -> str | None:
    """Short English gloss of a sense ("parent: child" for sub-senses), or None."""
    parts = [g.strip() for g in sense.get("glosses", []) if isinstance(g, str) and g.strip()]
    if not parts:
        return None
    if len(parts) > 1:
        sep = " " if parts[-2].endswith(":") else ": "
        text = parts[-2] + sep + parts[-1]
    else:
        text = parts[0]
    if len(text) > MAX_GLOSS_CHARS:
        text = text[: MAX_GLOSS_CHARS - 1].rstrip() + "\u2026"
    return text


def extract_glosses(senses: list[dict[str, Any]]) -> list[str]:
    """Up to :data:`MAX_GLOSSES` distinct short glosses, in sense order."""
    out: list[str] = []
    for sense in senses:
        text = _gloss_text(sense)
        if text and text not in out:
            out.append(text)
        if len(out) >= MAX_GLOSSES:
            break
    return out


def _gender_article(entry: dict[str, Any]) -> tuple[str | None, str | None]:
    """(gender, article) for nouns from sense tags; ``de/het`` when senses disagree."""
    if entry.get("pos") != "noun":
        return None, None
    tags = {t for s in entry.get("senses", []) for t in s.get("tags", [])}
    neuter, common = bool(tags & _NEUTER), bool(tags & _COMMON)
    if neuter and common:
        return "mixed", "de/het"
    if neuter:
        return "neuter", "het"
    if common:
        gender = "common" if "common-gender" in tags else sorted(tags & _COMMON)[0]
        return gender, "de"
    return None, None


def _form_words(entry: dict[str, Any]) -> list[str]:
    """Distinct inflected forms of an entry (excluding the headword and metadata rows)."""
    word = entry["word"]
    out: list[str] = []
    for f in entry.get("forms", []):
        form = f.get("form")
        if (
            not isinstance(form, str)
            or not form
            or form in {"-", word}
            or _SKIP_FORM_TAGS & set(f.get("tags", []))
            or form in out
        ):
            continue
        out.append(form)
    return out


def _ipa(entry: dict[str, Any]) -> str | None:
    for s in entry.get("sounds", []):
        if s.get("ipa"):
            return str(s["ipa"])
    return None


def _form_of_targets(entry: dict[str, Any]) -> list[str]:
    """Lemmas this entry is an inflected form of (``form_of`` on its senses)."""
    out: list[str] = []
    for sense in entry.get("senses", []):
        for ref in sense.get("form_of", []):
            lemma = ref.get("word") if isinstance(ref, dict) else None
            if lemma and lemma not in out:
                out.append(lemma)
    return out


def iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    """Yield JSON objects from a JSONL file, skipping blank/corrupt lines."""
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def build_dictionary(jsonl_path: Path, db_path: Path) -> dict[str, int]:
    """Build the SQLite dictionary from a Kaikki JSONL file (replaces ``db_path``).

    Entries without any gloss are skipped. Returns counts: ``entries`` and ``forms``.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = db_path.with_name(db_path.name + ".tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    try:
        con.executescript(SCHEMA)
        n_entries = n_forms = 0
        for entry in iter_jsonl(jsonl_path):
            word, pos = entry.get("word"), entry.get("pos")
            if not word or not pos:
                continue
            glosses = extract_glosses(entry.get("senses", []))
            if not glosses:
                continue
            gender, article = _gender_article(entry)
            forms = _form_words(entry)
            con.execute(
                "INSERT INTO entries(word, pos, article, gender, glosses, forms, ipa)"
                " VALUES (?,?,?,?,?,?,?)",
                (
                    word,
                    pos,
                    article,
                    gender,
                    json.dumps(glosses, ensure_ascii=False),
                    json.dumps(forms, ensure_ascii=False),
                    _ipa(entry),
                ),
            )
            n_entries += 1
            pairs: set[tuple[str, str]] = {(f, word) for f in forms}
            pairs |= {(word, lemma) for lemma in _form_of_targets(entry)}
            con.executemany(
                "INSERT INTO forms(form, lemma, pos) VALUES (?,?,?)",
                [(f, lemma, pos) for f, lemma in sorted(pairs)],
            )
            n_forms += len(pairs)
        con.executescript(INDEXES)
        con.commit()
    finally:
        con.close()
    tmp.replace(db_path)
    return {"entries": n_entries, "forms": n_forms}


class DictionaryMissingError(RuntimeError):
    """Raised when the dictionary database file does not exist."""


class Dictionary:
    """Read-only lookup over a database made by :func:`build_dictionary`."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or default_db_path()
        # Part readings are reused heavily across words (modifiers like "huis", "school").
        self._cached_part_readings = lru_cache(maxsize=50_000)(self._part_readings)
        if not self.db_path.is_file():
            raise DictionaryMissingError(
                f"Dictionary database not found at {self.db_path}. "
                "Build it once with: uv run python scripts/build_dictionary.py"
            )

    def _connect(self) -> sqlite3.Connection:
        # One short-lived read-only connection per request (FastAPI runs sync routes in threads).
        con = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        return con

    @staticmethod
    def _rows_to_entries(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
        return [
            {"pos": r["pos"], "article": r["article"], "glosses": json.loads(r["glosses"])}
            for r in rows
        ]

    def _part_readings(self, text: str) -> tuple[PartEntry, ...]:
        """Readings of a lowercase string as a compound part: own entries + lemmas of its forms."""
        con = self._connect()
        try:
            out: list[PartEntry] = []
            for r in con.execute(
                "SELECT word, pos, article, glosses FROM entries WHERE lower(word) = ?"
                " AND pos IN ('noun','adj','verb') ORDER BY id",
                (text,),
            ):
                out.append(PartEntry(r[0], r[1], r[2], tuple(json.loads(r[3]))))
            for r in con.execute(
                "SELECT DISTINCT e.word, e.pos, e.article, e.glosses FROM forms f"
                " JOIN entries e ON lower(e.word) = lower(f.lemma) AND e.pos = f.pos"
                " WHERE lower(f.form) = ? AND lower(f.lemma) != ?"
                " AND e.pos IN ('noun','adj','verb')"
                " ORDER BY e.id",
                (text, text),
            ):
                out.append(PartEntry(r[0], r[1], r[2], tuple(json.loads(r[3])), inflected=True))
            return tuple(out)
        finally:
            con.close()

    def analyze_compound(self, word: str) -> dict[str, Any] | None:
        """Gloss entry for an out-of-dictionary compound (see :mod:`kenning_nlp.compound`)."""
        found = split_compound(word, self._cached_part_readings)
        if found is None:
            return None
        return {
            "pos": found.pos,
            "article": found.article,
            "glosses": [found.gloss],
            "compound": True,
            "parts": found.part_glosses,
        }

    def lookup(self, words: Iterable[str]) -> dict[str, list[dict[str, Any]]]:
        """Entries per word (case-insensitive). Unknown words map to ``[]``.

        If a word has no entry of its own, entries of the lemma(s) it is a known form of
        are returned instead (e.g. ``fietsen`` -> ``fiets``). Failing that, a compound analysis
        is attempted (``souvenirwinkel`` -> one entry with ``compound=True`` and ``parts``).
        Order: exact entry -> forms table -> (lowercase, applied to both) -> compound.
        """
        result: dict[str, list[dict[str, Any]]] = {}
        con = self._connect()
        try:
            for word in dict.fromkeys(words):
                key = word.strip().lower()
                rows = con.execute(
                    "SELECT pos, article, glosses FROM entries WHERE lower(word) = ? ORDER BY id",
                    (key,),
                ).fetchall()
                if not rows:
                    rows = con.execute(
                        "SELECT e.pos, e.article, e.glosses FROM entries e WHERE lower(e.word) IN"
                        " (SELECT lower(lemma) FROM forms WHERE lower(form) = ?) ORDER BY e.id",
                        (key,),
                    ).fetchall()
                entries = self._rows_to_entries(rows)
                # No entry, or only "plural of X" style entries whose lemma is missing.
                if not any(real_glosses(e["glosses"]) for e in entries):
                    compound = self.analyze_compound(word.strip())
                    if compound:
                        entries = [compound]
                result[word] = entries
        finally:
            con.close()
        return result
