"""Dictionary (glosses) built from Kaikki.org's Dutch Wiktionary extract (CC BY-SA).

Two halves share one schema:

* :func:`build_dictionary` turns a Kaikki JSONL file into a SQLite database. It is used by
  ``scripts/build_dictionary.py`` and by the tests (with a tiny fixture).
* :class:`Dictionary` is the read-only lookup used by ``POST /gloss``.

Schema::

    entries(id, word, pos, article, gender, glosses JSON, forms JSON, ipa)   -- index lower(word)
    forms(form, lemma, pos)                                                  -- index lower(form)
    wordforms(lemma, pos, data JSON)                                         -- index lower(lemma)
    extras(entry_id, data JSON)    -- dictionary v2: senses with examples, synonyms, antonyms,
                                   -- derived and related words, hyphenation, recording file
    family(stem, word)             -- separable family both ways: doen -> opendoen, dichtdoen
                                   -- index lower(stem)

``extras`` and ``family`` are new in pack 2026.12 (m5, WC1); older packs lack them and
:meth:`Dictionary.entry` then answers without them.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable, Iterator
from functools import lru_cache
from pathlib import Path
from typing import Any

from vuurtoren_nlp.compound import (
    CompoundAnalysis,
    PartEntry,
    inflection_candidates,
    real_glosses,
    split_compound,
)
from vuurtoren_nlp.datadir import data_path
from vuurtoren_nlp.derive import Derivation, derive
from vuurtoren_nlp.wordforms import extract_word_forms

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
CREATE TABLE wordforms (lemma TEXT NOT NULL, pos TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE extras (entry_id INTEGER PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE family (stem TEXT NOT NULL, word TEXT NOT NULL);
"""
INDEXES = """
CREATE INDEX idx_entries_word ON entries(lower(word));
CREATE INDEX idx_forms_form ON forms(lower(form));
CREATE INDEX idx_wordforms_lemma ON wordforms(lower(lemma));
CREATE INDEX idx_family_stem ON family(lower(stem));
"""


def default_db_path() -> Path:
    """Database location: ``$VUURTOREN_DICT_PATH`` or ``server/nlp/data/dictionary-nl.sqlite``."""
    return data_path("VUURTOREN_DICT_PATH", "dictionary-nl.sqlite")


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


MAX_EXAMPLES = 3
MAX_RELATED = 60


def _words(items: Any, limit: int = MAX_RELATED) -> list[str]:
    """The ``word`` of each Kaikki link (synonyms, derived …), in order, without repeats."""
    out: list[str] = []
    for it in items or []:
        w = it.get("word") if isinstance(it, dict) else None
        if isinstance(w, str) and w.strip() and w.strip() not in out:
            out.append(w.strip())
        if len(out) >= limit:
            break
    return out


def entry_extras(entry: dict[str, Any]) -> dict[str, Any]:
    """Dictionary v2 fields of a Kaikki entry; only the ones that have something.

    ``senses``: each sense's gloss with up to three examples (Dutch + English), its synonyms and
    antonyms. Plus entry-wide ``synonyms``, ``antonyms``, ``derived`` (where a separable verb's
    family lives: doen -> opendoen), ``related``, ``hyphenation`` and ``audio`` (the Wikimedia
    Commons file name of a recording; played on demand, never bundled).
    """
    senses: list[dict[str, Any]] = []
    for s in entry.get("senses", []):
        gloss = _gloss_text(s)
        if not gloss:
            continue
        item: dict[str, Any] = {"gloss": gloss}
        examples = [
            {"nl": e["text"], "en": e.get("english") or e.get("translation")}
            for e in s.get("examples", [])
            if isinstance(e, dict) and isinstance(e.get("text"), str)
        ][:MAX_EXAMPLES]
        if examples:
            item["examples"] = examples
        for key in ("synonyms", "antonyms"):
            words = _words(s.get(key))
            if words:
                item[key] = words
        senses.append(item)
    out: dict[str, Any] = {}
    if any(len(s) > 1 for s in senses):
        out["senses"] = senses
    for key in ("synonyms", "antonyms", "derived", "related"):
        words = _words(entry.get(key))
        if words:
            out[key] = words
    hyph = entry.get("hyphenations") or []
    if hyph and isinstance(hyph[0], dict) and hyph[0].get("parts"):
        out["hyphenation"] = "·".join(hyph[0]["parts"])
    for snd in entry.get("sounds", []):
        name = snd.get("audio") if isinstance(snd, dict) else None
        if isinstance(name, str) and name:
            out["audio"] = name
            break
    return out


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
            cur = con.execute(
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
            extras = entry_extras(entry)
            if extras:
                con.execute(
                    "INSERT INTO extras(entry_id, data) VALUES (?,?)",
                    (cur.lastrowid, json.dumps(extras, ensure_ascii=False)),
                )
            morph = extract_word_forms(entry)
            if morph:
                con.execute(
                    "INSERT INTO wordforms(lemma, pos, data) VALUES (?,?,?)",
                    (word, pos, json.dumps(morph, ensure_ascii=False)),
                )
            # The separable family, from both ends: opendoen names its stem doen, and doen
            # lists opendoen among its derived verbs.
            sep = (morph or {}).get("separable") or {}
            family = {(sep["stem"], word)} if pos == "verb" and sep.get("stem") else set()
            if pos == "verb":
                derived = extras.get("derived", [])
                family |= {(word, d) for d in derived if " " not in d and d.endswith("en")}
            con.executemany("INSERT INTO family(stem, word) VALUES (?,?)", sorted(family))
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
        self._cached_derived_head = lru_cache(maxsize=20_000)(self._derived_head)
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

    def entry(self, word: str, pos: str | None = None) -> dict[str, Any]:
        """Everything the word card shows about ``word`` (dictionary v2, ``POST /entry``).

        ``{"word": headword, "entries": [...]}``; each entry has ``pos``, ``article``,
        ``glosses``, ``ipa``, its ``forms`` table (verbs: present per person, past, participle,
        hebben/zijn, the separable split), the v2 ``extras`` and, for verbs, ``family`` (the
        separable verbs made from it) and ``base`` (the verb it is made from: opendoen -> doen).
        A form ("doet") finds its lemma's entries. Unknown word: ``entries`` is empty. Older
        packs without the v2 tables answer without ``extras``, ``family`` and ``base``.
        """
        key = word.strip().lower()
        con = self._connect()
        try:
            v2 = {
                r[0]
                for r in con.execute(
                    "SELECT name FROM sqlite_master"
                    " WHERE type='table' AND name IN ('extras', 'family')"
                )
            }
            cols = "SELECT id, word, pos, article, gender, glosses, ipa FROM entries"
            rows = con.execute(cols + " WHERE lower(word) = ? ORDER BY id", (key,)).fetchall()
            # "doet" has an entry of its own that only says "inflection of doen": the card
            # wants doen.
            if not any(real_glosses(json.loads(r["glosses"])) for r in rows):
                lemma_rows = con.execute(
                    cols + " WHERE lower(word) IN"
                    " (SELECT lower(lemma) FROM forms WHERE lower(form) = ?)"
                    " AND lower(word) != ? ORDER BY id",
                    (key, key),
                ).fetchall()
                rows = lemma_rows or rows
            if pos:
                rows = [r for r in rows if r["pos"] == pos] or rows
            out: list[dict[str, Any]] = []
            for r in rows:
                e: dict[str, Any] = {
                    "pos": r["pos"],
                    "article": r["article"],
                    "glosses": json.loads(r["glosses"]),
                }
                if r["ipa"]:
                    e["ipa"] = r["ipa"]
                wf = con.execute(
                    "SELECT data FROM wordforms WHERE lower(lemma) = ? AND pos = ? LIMIT 1",
                    (r["word"].lower(), r["pos"]),
                ).fetchone()
                if wf:
                    e["forms"] = json.loads(wf["data"])
                if "extras" in v2:
                    x = con.execute(
                        "SELECT data FROM extras WHERE entry_id = ?", (r["id"],)
                    ).fetchone()
                    if x:
                        e["extras"] = json.loads(x["data"])
                if "family" in v2 and r["pos"] == "verb":
                    fam = [
                        f["word"]
                        for f in con.execute(
                            "SELECT DISTINCT word FROM family WHERE lower(stem) = ? ORDER BY word",
                            (r["word"].lower(),),
                        )
                        if f["word"].lower() != r["word"].lower()
                    ]
                    if fam:
                        e["family"] = fam
                    stem = ((e.get("forms") or {}).get("separable") or {}).get("stem")
                    if stem:
                        e["base"] = stem
                out.append(e)
            head = rows[0]["word"] if rows else word.strip()
            return {"word": head, "entries": out}
        finally:
            con.close()

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

    def _derived_head(self, text: str) -> tuple[PartEntry, ...]:
        """A compound head without an entry, read as a derivation (``poetser``)."""
        found = derive(text, self._cached_part_readings, depth=1)
        if found is None:
            return ()
        return (PartEntry(text, found.pos, found.article, (found.gloss,), derived=True),)

    def _split(self, word: str) -> CompoundAnalysis | None:
        return split_compound(word, self._cached_part_readings, derived=self._cached_derived_head)

    def _split_as_derivation(self, word: str) -> Derivation | None:
        """A compound shaped as a :class:`Derivation`, for derivations of compounds."""
        found = self._split(word)
        if found is None:
            return None
        parts = (found.formed,)
        return Derivation(found.pos, found.article, found.gloss, parts, found.score)

    def analyze_unknown(self, word: str) -> dict[str, Any] | None:
        """Entry for a word without one: a derivation or a compound (see :mod:`vuurtoren_nlp.derive`
        and :mod:`vuurtoren_nlp.compound`).

        A derivation from a dictionary base wins (``woord`` + ``-loos``) unless the compound's
        head is a dictionary word that already ends in that suffix (``berg`` + ``landschap``,
        not ``bergland`` + ``-schap``). Failing both, a derivation of a compound is tried
        (``vastgoedmakelaar`` + ``-ster``).
        """
        resolve = self._cached_part_readings
        derivation = derive(word, resolve)
        compound = self._split(word)
        if derivation and compound and _head_explains(compound, derivation):
            derivation = None
        if derivation is None and compound is None:
            derivation = derive(word, resolve, split=self._split_as_derivation)
        if derivation is not None:
            return {
                "pos": derivation.pos,
                "article": derivation.article,
                "glosses": [derivation.gloss],
                "origin": "derivation",
                "formed": derivation.formed,
            }
        if compound is not None:
            return {
                "pos": compound.pos,
                "article": compound.article,
                "glosses": [compound.gloss],
                "compound": True,
                "origin": "compound",
                "formed": compound.formed,
                "parts": compound.part_glosses,
            }
        return None

    def _resolve_inflected(
        self, con: sqlite3.Connection, word: str
    ) -> tuple[str, list[dict[str, Any]]] | None:
        """Entries of the noun lemma of a diminutive/plural ``word`` (``via`` marks which)."""
        candidates = inflection_candidates(word)
        for via, guess in candidates:
            rows = con.execute(
                "SELECT pos, article, glosses FROM entries WHERE lower(word) = ? AND pos='noun'"
                " ORDER BY id",
                (guess,),
            ).fetchall()
            entries = self._rows_to_entries(rows)
            if any(real_glosses(e["glosses"]) for e in entries):
                return via, [{**e, "via": via} for e in entries]
        for via, guess in candidates:
            if via == "diminutive":  # diminutive of an out-of-dictionary compound/derivation
                found = self.analyze_unknown(guess)
                if found:
                    return via, [{**found, "via": via}]
        return None

    def lookup(self, words: Iterable[str]) -> dict[str, list[dict[str, Any]]]:
        """Entries per word (case-insensitive). Unknown words map to ``[]``.

        If a word has no entry of its own, entries of the lemma(s) it is a known form of
        are returned instead (e.g. ``fietsen`` -> ``fiets``). Failing that, the word is read as
        a diminutive or plural, then as a derivation or compound (:meth:`analyze_unknown`: one
        entry with ``origin`` and ``formed``; compounds also have ``compound=True`` and ``parts``).
        Order: exact entry -> forms table -> (lowercase, applied to both) -> diminutive/plural
        -> derivation/compound.
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
                    resolved = self._resolve_inflected(con, word.strip())
                    if resolved:
                        entries = resolved[1]
                    else:
                        found = self.analyze_unknown(word.strip())
                        if found:
                            entries = [found]
                result[word] = entries
        finally:
            con.close()
        return result


def _head_explains(compound: CompoundAnalysis, derivation: Derivation) -> bool:
    """True if the compound's last (or first) part is a dictionary word that contains the
    derivation's affix, so the compound reading is the better one (``berg`` + ``landschap``)."""
    if derivation.having:
        return False
    # Only a compound of plain dictionary lemmas beats a derivation (not druppe + laar).
    if any(p.entry.inflected or p.entry.derived for p in compound.parts):
        return False
    if derivation.suffix:
        head = compound.parts[-1]
        text, affix = head.part.lower(), derivation.suffix
        return text.endswith(affix) and len(text) > len(affix)
    first = compound.parts[0]
    prefix = derivation.parts[0].rstrip("-")
    text = first.part.lower()
    return text.startswith(prefix) and len(text) > len(prefix)
