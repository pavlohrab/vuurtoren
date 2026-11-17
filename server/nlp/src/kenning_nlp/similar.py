"""Distractors for multiple-choice practice (``POST /similar``).

Same POS, similar frequency,
related but not synonymous words, from spaCy's ``nl_core_news_md`` word vectors.

How it works
------------
* **Vocabulary**: the ``VOCAB_SIZE`` (30,000) most frequent (wordfreq Zipf) single-word lemmas
  of the dictionary (nouns, verbs, adjectives, adverbs) that have a vector in the
  model. Built lazily on the first request (about 4 s), then cached for the process lifetime.
* **Matrix**: one L2-normalised float32 matrix per POS (about 30k x 300 x 4 B = 36 MB in total, one
  copy of the model's 20k unique vectors is reused), so cosine similarity of a word to a whole
  POS vocabulary is a single matrix-vector product.
* **Selection** for a query word: same POS, ``|zipf - zipf_query| <= ZIPF_BAND`` and cosine in
  ``[SIM_LOW, SIM_HIGH]`` (0.3-0.7). Words above the band are near-synonyms or inflection/spelling
  variants (they would make the question ambiguous), words below are unrelated (too easy to
  eliminate). The most similar words inside the band come first. If fewer than ``k`` remain, the
  band is widened once (similarity 0.2-0.8, Zipf +-1.5).
* Candidates that contain the query (or vice versa) are dropped (``huis`` / ``huisarts``), as are
  words sharing the query's vector row (the md model maps rare words onto shared rows, cosine 1).
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import numpy as np

from kenning_nlp.freq import zipf

VOCAB_SIZE = 30_000
"""Number of most frequent dictionary lemmas that get a row in the similarity matrix."""
MIN_ZIPF = 2.5
ZIPF_BAND = 1.0
SIM_LOW, SIM_HIGH = 0.3, 0.7
WIDE_ZIPF_BAND = 1.5
WIDE_SIM_LOW, WIDE_SIM_HIGH = 0.2, 0.8
POS_KINDS = {"NOUN": "noun", "VERB": "verb", "AUX": "verb", "ADJ": "adj", "ADV": "adv"}


class SimilarMissingError(RuntimeError):
    """The dictionary DB or the word vectors are not available."""


class SimilarIndex:
    """Per-POS normalised vector matrices over the frequent dictionary vocabulary."""

    def __init__(self, nlp: Any, lemmas_by_pos: dict[str, list[str]]) -> None:
        """Build from a spaCy ``nlp`` (with vectors) and ``{kind: [lemma, ...]}``.

        Raises:
            SimilarMissingError: if the model has no word vectors.
        """
        vocab = nlp.vocab
        if vocab.vectors.shape[0] == 0 or vocab.vectors_length == 0:
            raise SimilarMissingError("The spaCy model has no word vectors (need nl_core_news_md).")
        self._vocab = vocab
        self.words: dict[str, list[str]] = {}
        self.matrix: dict[str, np.ndarray] = {}
        self.zipfs: dict[str, np.ndarray] = {}
        self.rows: dict[str, np.ndarray] = {}
        for kind, lemmas in lemmas_by_pos.items():
            kept: list[str] = []
            vecs: list[np.ndarray] = []
            rows: list[int] = []
            for lemma in lemmas:
                if not vocab.has_vector(lemma):
                    continue
                kept.append(lemma)
                vecs.append(vocab.get_vector(lemma))
                rows.append(vocab.vectors.find(key=vocab.strings[lemma]))
            mat = np.asarray(vecs, dtype=np.float32).reshape(len(kept), vocab.vectors_length)
            norms = np.linalg.norm(mat, axis=1, keepdims=True)
            self.matrix[kind] = mat / np.maximum(norms, 1e-9)
            self.words[kind] = kept
            self.zipfs[kind] = np.asarray([zipf(w) for w in kept], dtype=np.float32)
            self.rows[kind] = np.asarray(rows)

    def similar(self, lemma: str, pos: str, k: int = 8) -> list[str]:
        """Up to ``k`` distractor lemmas for ``lemma`` (UPOS ``pos``); ``[]`` if no vector/POS."""
        kind = POS_KINDS.get(pos)
        low = lemma.strip().lower()
        if kind is None or kind not in self.matrix or not self._vocab.has_vector(low):
            return []
        vec = self._vocab.get_vector(low)
        norm = float(np.linalg.norm(vec))
        if norm == 0:
            return []
        sims = self.matrix[kind] @ (vec / norm)
        own_row = self._vocab.vectors.find(key=self._vocab.strings[low])
        target_zipf = zipf(low)
        out: list[str] = []
        for lo, hi, band in (
            (SIM_LOW, SIM_HIGH, ZIPF_BAND),
            (WIDE_SIM_LOW, WIDE_SIM_HIGH, WIDE_ZIPF_BAND),
        ):
            mask = (
                (sims >= lo)
                & (sims <= hi)
                & (np.abs(self.zipfs[kind] - target_zipf) <= band)
                & (self.rows[kind] != own_row)
            )
            for idx in np.flatnonzero(mask)[np.argsort(-sims[mask])]:
                word = self.words[kind][idx]
                if word != low and word not in out and low not in word and word not in low:
                    out.append(word)
                if len(out) >= k:
                    return out
        return out


def load_vocabulary(db_path: Path, size: int = VOCAB_SIZE) -> dict[str, list[str]]:
    """Most frequent single-word lemmas per POS kind from the dictionary (``size`` in total)."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        # Headwords only: Kaikki also has entries for inflected forms ("katten", "gekocht"),
        # which the ``forms`` table lists as forms of another lemma with the same POS.
        rows = con.execute(
            "SELECT DISTINCT e.word, e.pos FROM entries e"
            " WHERE e.pos IN ('noun','verb','adj','adv')"
            " AND NOT EXISTS (SELECT 1 FROM forms f WHERE lower(f.form) = lower(e.word)"
            " AND f.pos = e.pos AND lower(f.lemma) != lower(e.word))"
        ).fetchall()
    finally:
        con.close()
    scored = []
    for word, pos in rows:
        # Lowercase alphabetic single words only: no names, phrases, abbreviations or prefixes.
        if not word.isalpha() or not word.islower() or len(word) < 3:
            continue
        z = zipf(word)
        if z >= MIN_ZIPF:
            scored.append((z, word, pos))
    scored.sort(key=lambda r: (-r[0], r[1]))
    by_pos: dict[str, list[str]] = {}
    for _, word, pos in scored[:size]:
        by_pos.setdefault(pos, []).append(word)
    return by_pos


class SimilarService:
    """Lazy, thread-safe holder of the :class:`SimilarIndex` used by the endpoint."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._index: SimilarIndex | None = None
        self._lock = threading.Lock()

    def index(self) -> SimilarIndex:
        """Build (once) and return the index.

        Raises:
            SimilarMissingError: if the dictionary DB is missing.
        """
        with self._lock:
            if self._index is None:
                if not self.db_path.is_file():
                    raise SimilarMissingError(
                        f"Dictionary database not found at {self.db_path}. "
                        "Build it once with: uv run python scripts/build_dictionary.py"
                    )
                from kenning_nlp.pipeline import get_nlp

                self._index = SimilarIndex(get_nlp("nl"), load_vocabulary(self.db_path))
            return self._index

    def lookup(self, words: Iterable[tuple[str, str]], k: int = 8) -> dict[str, list[str]]:
        """``{lemma: [similar lemmas]}`` for ``(lemma, UPOS)`` pairs (first pair per lemma wins)."""
        index = self.index()
        result: dict[str, list[str]] = {}
        for lemma, pos in words:
            if lemma not in result:
                result[lemma] = index.similar(lemma, pos, k)
        return result
