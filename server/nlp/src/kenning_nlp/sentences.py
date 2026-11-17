"""Example sentences (``POST /sentences``) from Tatoeba, with an inverted lemma index.

Two halves, like :mod:`kenning_nlp.dictionary`:

* :func:`build_sentence_db` writes ``data/sentences-nl.sqlite`` from (id, Dutch, English) triples
  and an analyser callable (``scripts/build_sentences.py`` passes the real spaCy pipeline, the
  tests a stub). Besides the lemma index it stores *perfect-tense evidence* (how often a verb's
  participle occurs with a hebben/zijn auxiliary) which ``/forms`` uses to pick ``aux``.
* :class:`SentenceStore` is the read-only lookup.

Schema::

    sentences(id, text, translation, n_words, score)       -- id = Tatoeba Dutch sentence id
    occurrences(lemma, score, sid, start, end)             -- index (lemma, score); UTF-16 span
    aux_evidence(lemma, hebben, zijn)
    meta(key, value)

``score`` ranks sentences for practice, lower is better: short, few rare words.
Sentences are stored once; the target span is per (lemma, sentence).
"""

from __future__ import annotations

import os
import re
import sqlite3
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from kenning_nlp.models import TextAnalysis

MIN_WORDS = 3
MAX_WORDS = 25
"""Sentences outside [MIN_WORDS, MAX_WORDS] words are not stored."""
MAX_CHARS = 160
SHORT_WORDS = 4
"""Sentences shorter than this are penalised (too little context for an example)."""
RARE_ZIPF = 3.0
"""Words rarer than this make a sentence harder (score penalty)."""

_URL_OR_MARKUP = re.compile(r"https?://|www\.|[<>@#\[\]{}|\\]|\d{4,}")
_AUX_LEMMAS = {"hebben": 0, "zijn": 1}

SCHEMA = """
CREATE TABLE sentences (
    id INTEGER PRIMARY KEY, text TEXT NOT NULL, translation TEXT NOT NULL,
    n_words INTEGER NOT NULL, score REAL NOT NULL
);
CREATE TABLE occurrences (
    lemma TEXT NOT NULL, score REAL NOT NULL, sid INTEGER NOT NULL,
    start INTEGER NOT NULL, end INTEGER NOT NULL
);
CREATE TABLE aux_evidence (lemma TEXT PRIMARY KEY, hebben INTEGER NOT NULL, zijn INTEGER NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""
INDEXES = "CREATE INDEX idx_occ_lemma ON occurrences(lemma, score);"

Analyzer = Callable[[list[str]], list[TextAnalysis]]


def default_db_path() -> Path:
    """``$KENNING_SENTENCES_PATH`` or ``server/nlp/data/sentences-nl.sqlite``."""
    env = os.environ.get("KENNING_SENTENCES_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "data" / "sentences-nl.sqlite"


def is_usable(text: str) -> bool:
    """Cheap pre-filter before analysis: length and no URLs / markup / long numbers."""
    return 0 < len(text) <= MAX_CHARS and not _URL_OR_MARKUP.search(text)


def sentence_score(n_words: int, zipfs: list[float]) -> float:
    """Practice score (lower = better): length + rare-word penalty (+ too-short penalty).

    Each word costs 0.5, each rare word (Zipf < 3) 2.0, and a sentence under
    :data:`SHORT_WORDS` words 2.0, so short common-vocabulary sentences come first.
    """
    rare = sum(1 for z in zipfs if z < RARE_ZIPF)
    return n_words * 0.5 + rare * 2.0 + (2.0 if n_words < SHORT_WORDS else 0.0)


def perfect_evidence(analysis: TextAnalysis) -> list[tuple[str, int]]:
    """``(verb lemma, 0|1)`` for each perfect tense in a sentence: 0 = hebben, 1 = zijn.

    A past participle (VerbForm=Part, not the passive ``aux:pass``) with an auxiliary child
    whose lemma is hebben/zijn. ``ik ben naar huis gelopen`` -> ``("lopen", 1)``. Passives
    (``het huis is gebouwd``) are excluded by the dependency label.
    """
    out: list[tuple[str, int]] = []
    toks = analysis.tokens
    for t in toks:
        if t.pos != "VERB" or "VerbForm=Part" not in t.morph:
            continue
        for a in toks:
            if a.head == t.i and a.dep == "aux" and a.lemma.lower() in _AUX_LEMMAS:
                out.append((t.lemma.lower(), _AUX_LEMMAS[a.lemma.lower()]))
                break
    return out


@dataclass
class BuildStats:
    """Counts reported by :func:`build_sentence_db`."""

    candidates: int = 0
    sentences: int = 0
    occurrences: int = 0
    lemmas: int = 0
    aux_verbs: int = 0


def build_sentence_db(
    pairs: Iterable[tuple[int, str, str]],
    analyze: Analyzer,
    db_path: Path,
    batch_size: int = 512,
) -> BuildStats:
    """Build the sentence DB from ``(tatoeba_id, dutch, english)`` triples (replaces ``db_path``).

    Args:
        pairs: Sentences that HAVE an English translation (one translation per Dutch sentence).
        analyze: Maps a list of texts to their analyses (same lemma logic as /analyze/text).
        db_path: Output file, written via a ``.tmp`` file.
        batch_size: Texts per ``analyze`` call.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = db_path.with_name(db_path.name + ".tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    stats = BuildStats()
    aux: dict[str, list[int]] = {}
    seen_text: set[str] = set()
    lemmas: set[str] = set()
    try:
        con.executescript(SCHEMA)
        batch: list[tuple[int, str, str]] = []

        def flush() -> None:
            if not batch:
                return
            analyses = analyze([b[1] for b in batch])
            for (sid, text, translation), analysis in zip(batch, analyses, strict=True):
                _store(con, stats, aux, lemmas, sid, text, translation, analysis)
            batch.clear()

        for sid, text, translation in pairs:
            text, translation = text.strip(), translation.strip()
            if not is_usable(text) or not translation or text.lower() in seen_text:
                continue
            seen_text.add(text.lower())
            stats.candidates += 1
            batch.append((sid, text, translation))
            if len(batch) >= batch_size:
                flush()
        flush()
        con.executemany(
            "INSERT INTO aux_evidence VALUES (?,?,?)", [(k, v[0], v[1]) for k, v in aux.items()]
        )
        con.executemany(
            "INSERT INTO meta VALUES (?,?)",
            [("sentences", str(stats.sentences)), ("source", "Tatoeba (CC BY 2.0 FR)")],
        )
        con.executescript(INDEXES)
        con.commit()
    finally:
        con.close()
    stats.lemmas = len(lemmas)
    stats.aux_verbs = len(aux)
    tmp.replace(db_path)
    return stats


def _store(
    con: sqlite3.Connection,
    stats: BuildStats,
    aux: dict[str, list[int]],
    lemmas: set[str],
    sid: int,
    text: str,
    translation: str,
    analysis: TextAnalysis,
) -> None:
    """Insert one analysed sentence (skipped if it has too few/many words)."""
    words = [t for t in analysis.tokens if t.is_word]
    if not MIN_WORDS <= len(words) <= MAX_WORDS:
        return
    # Perfect-tense evidence counts even from sentences we never show.
    for lemma, which in perfect_evidence(analysis):
        aux.setdefault(lemma, [0, 0])[which] += 1
    score = sentence_score(len(words), [t.zipf for t in words])
    con.execute(
        "INSERT INTO sentences VALUES (?,?,?,?,?)", (sid, text, translation, len(words), score)
    )
    stats.sentences += 1
    seen: set[str] = set()
    rows = []
    for t in words:
        lemma = t.lemma.lower()
        if t.is_propn or lemma in seen:
            continue
        seen.add(lemma)
        rows.append((lemma, score, sid, t.start, t.end))
    lemmas.update(seen)
    con.executemany("INSERT INTO occurrences VALUES (?,?,?,?,?)", rows)
    stats.occurrences += len(rows)


class SentencesMissingError(RuntimeError):
    """The sentence database file does not exist."""


class SentenceStore:
    """Read-only lookup over a database made by :func:`build_sentence_db`."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or default_db_path()
        if not self.db_path.is_file():
            raise SentencesMissingError(
                f"Sentence database not found at {self.db_path}. "
                "Build it once with: uv run python scripts/build_sentences.py"
            )

    def lookup(
        self, lemmas: Iterable[str], limit: int = 3, max_words: int = 15
    ) -> dict[str, list[dict[str, object]]]:
        """Up to ``limit`` best sentences (``ExampleSentence`` dicts) per lemma.

        Best = lowest score (short, common words) among sentences of at most ``max_words`` words.
        Unknown lemmas map to ``[]``.
        """
        con = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        result: dict[str, list[dict[str, object]]] = {}
        try:
            for lemma in dict.fromkeys(lemmas):
                rows = con.execute(
                    "SELECT s.text, s.translation, o.start, o.end FROM occurrences o"
                    " JOIN sentences s ON s.id = o.sid"
                    " WHERE o.lemma = ? AND s.n_words <= ? ORDER BY o.score, s.id LIMIT ?",
                    (lemma.strip().lower(), max_words, limit),
                ).fetchall()
                result[lemma] = [
                    {"text": r[0], "translation": r[1], "target": [r[2], r[3]], "source": "tatoeba"}
                    for r in rows
                ]
        finally:
            con.close()
        return result


def count_evidence(rows: Iterable[tuple[str, int]]) -> dict[str, tuple[int, int]]:
    """Aggregate ``(lemma, 0|1)`` rows into ``{lemma: (hebben, zijn)}`` (helper for tests)."""
    counts: Counter[tuple[str, int]] = Counter(rows)
    lemmas = {lemma for lemma, _ in counts}
    return {lemma: (counts[(lemma, 0)], counts[(lemma, 1)]) for lemma in lemmas}
