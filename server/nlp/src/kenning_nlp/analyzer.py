"""The analyzer version: changes whenever ``/analyze/text`` could tokenise or
lemmatise a text differently, so clients can re-analyse texts stored with an older one.

It hashes the spaCy and model versions, the source of the modules that shape a token (pipeline,
Dutch rules, lexicon, frequencies), the grammar detectors (their token indices refer to the
analysis), the frequency/lemma library versions and the installed dictionary pack (its forms
table decides lemmas). Recomputed after a pack update (:func:`reset`).
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from kenning_nlp import freq, grammar, lexicon, nl, pipeline

ANALYZER_FORMAT = "a1"
_SOURCES = (pipeline, nl, lexicon, freq, grammar)
_PACKAGES = ("spacy", "nl-core-news-md", "wordfreq", "simplemma")


def _pkg(name: str) -> str:
    try:
        return version(name)
    except PackageNotFoundError:
        return "-"


@lru_cache(maxsize=1)
def analyzer_version() -> str:
    """``a1-`` + 12 hex digits, e.g. ``a1-3f2c9d0b1e4a``."""
    from kenning_nlp import packs

    h = hashlib.sha256()
    for name in _PACKAGES:
        h.update(f"{name}={_pkg(name)}\n".encode())
    for mod in _SOURCES:
        h.update(Path(mod.__file__ or "").read_bytes())
    dictionary = packs.installed("dictionary-nl")
    if dictionary is not None:
        h.update(f"dictionary={dictionary.get('version')}\n".encode())
    else:
        present = packs.SPECS["dictionary-nl"].target().is_file()
        h.update(b"dictionary=unversioned\n" if present else b"dictionary=none\n")
    return f"{ANALYZER_FORMAT}-{h.hexdigest()[:12]}"


def reset() -> None:
    analyzer_version.cache_clear()
