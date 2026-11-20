"""Tatoeba examples per grammar topic (``GET /grammar/examples``), scanned lazily.

The sentence database (:mod:`vuurtoren_nlp.sentences`) is indexed by lemma, not by construction, so
finding "sentences with an inversion" means running the detectors over the sentences. That costs a
few milliseconds per sentence, so the scan is **incremental and cached**:

* sentences are visited in a fixed pseudo-random order (so rare constructions turn up as early as
  common ones; the shortest sentences alone would hardly contain a subordinate clause) in batches;
* every detector hit of every visited sentence is stored (at most :data:`MAX_PER_TOPIC` per topic)
  in a small side database, together with the scan position;
* a request scans on until its topic has enough examples or its time budget is spent, so the
  first request for a rare topic may return fewer than asked and a later one finds more;
* the cache is thrown away when the detectors change (hash of ``grammar.py``);
* when the cache cannot be written (the Docker image ships it precomputed in a read-only
  ``/data``), it is only read: no scanning, and a cache built by other detectors counts as empty.

Schema::

    examples(topic, sid, score, text, translation, marks, note)   -- marks: JSON [[start, end], ...]
    meta(key, value)                                              -- version, cursor, finished
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path

from vuurtoren_nlp import grammar
from vuurtoren_nlp.datadir import data_path
from vuurtoren_nlp.pipeline import analyze_texts

BATCH = 128
"""Sentences analysed per step."""
MAX_PER_TOPIC = 40
"""Examples kept per topic."""
MIN_WORDS = 5
MAX_WORDS = 14
"""Only sentences of this many words are scanned (good examples are short and not trivial).
The best of the cached examples (lowest ``score``) are returned."""
DEFAULT_BUDGET_S = 4.0

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE examples (
    topic TEXT NOT NULL, sid INTEGER NOT NULL, score REAL NOT NULL, text TEXT NOT NULL,
    translation TEXT NOT NULL, marks TEXT NOT NULL, note TEXT NOT NULL,
    PRIMARY KEY (topic, sid)
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def default_cache_path() -> Path:
    """``$VUURTOREN_GRAMMAR_CACHE_PATH`` or ``server/nlp/data/grammar-examples-nl.sqlite``."""
    return data_path("VUURTOREN_GRAMMAR_CACHE_PATH", "grammar-examples-nl.sqlite")


def detector_version() -> str:
    """Hash of the detector source: the cache is only valid for the detectors that built it."""
    return hashlib.sha256(Path(grammar.__file__).read_bytes()).hexdigest()[:16]


class GrammarExamples:
    """Lazy, cached scan of the Tatoeba sentence DB with the grammar detectors."""

    def __init__(self, sentences_db: Path, cache_db: Path | None = None) -> None:
        self.sentences_db = sentences_db
        self.cache_db = cache_db or default_cache_path()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ cache housekeeping

    def writable(self) -> bool:
        """True when the cache file (or, before it exists, its directory) can be written."""
        if self.cache_db.exists():
            return os.access(self.cache_db, os.W_OK) and os.access(self.cache_db.parent, os.W_OK)
        parent = self.cache_db.parent
        while not parent.exists() and parent != parent.parent:
            parent = parent.parent
        return os.access(parent, os.W_OK)

    def cache_version_ok(self) -> bool:
        """True when the cache exists and was built by the current detectors."""
        try:
            con = sqlite3.connect(f"file:{self.cache_db}?mode=ro", uri=True)
        except sqlite3.Error:
            return False
        try:
            row = con.execute("SELECT value FROM meta WHERE key='version'").fetchone()
            return bool(row) and row[0] == detector_version()
        except sqlite3.Error:
            return False
        finally:
            con.close()

    def _read_only(self, topic: str, limit: int) -> list[tuple[str, str, str, str]]:
        """Best cached examples without scanning; [] when there is no usable cache."""
        if not self.cache_db.is_file():
            return []
        try:
            con = sqlite3.connect(f"file:{self.cache_db}?mode=ro", uri=True)
        except sqlite3.Error:
            return []
        try:
            row = con.execute("SELECT value FROM meta WHERE key='version'").fetchone()
            if not row or row[0] != detector_version():
                log.warning("grammar example cache %s is stale and read-only", self.cache_db)
                return []
            return con.execute(
                "SELECT text, translation, marks, note FROM examples WHERE topic=?"
                " ORDER BY score, sid LIMIT ?",
                (topic, limit),
            ).fetchall()
        except sqlite3.Error:
            return []
        finally:
            con.close()

    def _open_cache(self) -> sqlite3.Connection:
        self.cache_db.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(self.cache_db)
        has_meta = con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'"
        ).fetchone()
        version = None
        if has_meta:
            row = con.execute("SELECT value FROM meta WHERE key='version'").fetchone()
            version = row[0] if row else None
        if version != detector_version():
            con.executescript("DROP TABLE IF EXISTS examples; DROP TABLE IF EXISTS meta;" + SCHEMA)
            con.execute("INSERT INTO meta VALUES ('version', ?)", (detector_version(),))
            con.execute("INSERT INTO meta VALUES ('cursor', '0')")
            con.execute("INSERT INTO meta VALUES ('finished', '0')")
            con.commit()
        return con

    @staticmethod
    def _meta(con: sqlite3.Connection, key: str) -> int:
        return int(con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()[0])

    def _count(self, con: sqlite3.Connection, topic: str) -> int:
        return con.execute("SELECT COUNT(*) FROM examples WHERE topic=?", (topic,)).fetchone()[0]

    # ------------------------------------------------------------------------- scanning

    def _scan_batch(self, con: sqlite3.Connection, sdb: sqlite3.Connection) -> bool:
        """Scan the next batch; False when the sentence list is exhausted."""
        cursor = self._meta(con, "cursor")
        rows = sdb.execute(
            "SELECT id, text, translation, score FROM sentences WHERE n_words BETWEEN ? AND ?"
            " ORDER BY (id * 2654435761) % 4294967296, id LIMIT ? OFFSET ?",
            (MIN_WORDS, MAX_WORDS, BATCH, cursor),
        ).fetchall()
        if not rows:
            con.execute("UPDATE meta SET value='1' WHERE key='finished'")
            con.commit()
            return False
        analyses = analyze_texts("nl", [r[1] for r in rows])
        for (sid, text, translation, score), analysis in zip(rows, analyses, strict=True):
            seen: set[str] = set()
            for hit in grammar.detect_grammar(text, analysis):
                if hit.topic in seen:
                    continue
                seen.add(hit.topic)
                if self._count(con, hit.topic) >= MAX_PER_TOPIC:
                    continue
                marks = [[analysis.tokens[i].start, analysis.tokens[i].end] for i in hit.tokens]
                con.execute(
                    "INSERT OR IGNORE INTO examples VALUES (?,?,?,?,?,?,?)",
                    (hit.topic, sid, score, text, translation, json.dumps(marks), hit.note),
                )
        con.execute("UPDATE meta SET value=? WHERE key='cursor'", (str(cursor + len(rows)),))
        con.commit()
        return True

    def examples(
        self, topic: str, limit: int = 10, budget_s: float = DEFAULT_BUDGET_S
    ) -> list[dict[str, object]]:
        """Up to ``limit`` example sentences (best first) in which ``topic`` was detected.

        Scans further into the sentence DB while the topic has fewer than ``limit`` cached
        examples and ``budget_s`` seconds are left. Unknown topics give ``[]``.
        """
        if topic not in grammar.TOPICS:
            return []
        if not self.writable():
            rows = self._read_only(topic, limit)
            return [self._row(r) for r in rows]
        with self._lock:
            con = self._open_cache()
            sdb = sqlite3.connect(f"file:{self.sentences_db}?mode=ro", uri=True)
            try:
                deadline = time.monotonic() + budget_s
                while (
                    self._count(con, topic) < limit
                    and not self._meta(con, "finished")
                    and time.monotonic() < deadline
                ):
                    if not self._scan_batch(con, sdb):
                        break
                rows = con.execute(
                    "SELECT text, translation, marks, note FROM examples WHERE topic=?"
                    " ORDER BY score, sid LIMIT ?",
                    (topic, limit),
                ).fetchall()
            finally:
                sdb.close()
                con.close()
        return [self._row(r) for r in rows]

    @staticmethod
    def _row(r: tuple[str, str, str, str]) -> dict[str, object]:
        return {
            "text": r[0],
            "translation": r[1],
            "marks": [tuple(m) for m in json.loads(r[2])],
            "note": r[3],
            "source": "tatoeba",
        }

    def progress(self) -> tuple[int, bool]:
        """(sentences scanned so far, whole sentence list scanned) of the cache."""
        if not self.cache_db.is_file():
            return 0, False
        con = sqlite3.connect(f"file:{self.cache_db}?mode=ro", uri=True)
        try:
            meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
            return int(meta.get("cursor", 0)), meta.get("finished") == "1"
        except sqlite3.Error:
            return 0, False
        finally:
            con.close()
