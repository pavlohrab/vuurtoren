"""Meanings of words the dictionary does not have: accuracy on a hand-checked test set.

``fixtures/meanings-nl.tsv``: Dutch words without a dictionary entry (derivations, compounds and
derived compounds), each with a sentence it occurs in (Tatoeba, or written for the test) and
the English meanings that count as right. A meaning is right when one of its comma- or
semicolon-separated senses equals one of the accepted answers, ignoring case, hyphens,
parentheticals and a leading article or "to".

The second test measures the meaning read off the sentence translation
(:mod:`kenning_nlp.align`): how often it is confident enough to be used, and how often it is then
right (an inflected form counts: the meaning is shown "in this sentence").

The report is printed. Needs the real dictionary and, for alignment, the MT model (skipped
without them).
"""

from __future__ import annotations

import csv
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import pytest

from kenning_nlp.align import MIN_CONFIDENCE, stems
from kenning_nlp.dictionary import Dictionary, default_db_path
from kenning_nlp.translate import MODEL_FILES, align_texts, model_dir

FIXTURE = Path(__file__).parent / "fixtures" / "meanings-nl.tsv"
needs_db = pytest.mark.skipif(not default_db_path().is_file(), reason="dictionary DB not built")


@dataclass(frozen=True)
class Case:
    lemma: str
    surface: str
    kind: str
    accepted: frozenset[str]
    sentence: str


def load_cases() -> list[Case]:
    with FIXTURE.open(encoding="utf-8") as fh:
        return [
            Case(
                r["lemma"],
                r["surface"],
                r["kind"],
                frozenset(normalise(a) for a in r["accepted"].split("|")),
                r["sentence"],
            )
            for r in csv.DictReader(fh, delimiter="\t")
        ]


def normalise(text: str) -> str:
    text = re.sub(r"\([^)]*\)", "", text.lower()).replace("-", " ")
    text = re.sub(r"^(?:a|an|the|to)\s+", "", text.strip())
    return " ".join(text.split())


def senses(gloss: str) -> set[str]:
    return {normalise(s) for s in re.split(r"[,;]", re.sub(r"\([^)]*\)", "", gloss))} - {""}


def is_right(gloss: str | None, case: Case) -> bool:
    return bool(gloss) and bool(senses(gloss or "") & case.accepted)


def test_fixture_is_well_formed() -> None:
    cases = load_cases()
    assert len(cases) >= 150
    assert len({c.lemma for c in cases}) == len(cases)
    for c in cases:
        assert c.surface in c.sentence, c.lemma
        assert c.accepted, c.lemma


@needs_db
def test_meaning_accuracy(capsys: pytest.CaptureFixture[str]) -> None:
    cases = load_cases()
    found = Dictionary().lookup([c.lemma for c in cases])
    right, total = Counter[str](), Counter[str]()
    for c in cases:
        entries = found[c.lemma]
        gloss = entries[0]["glosses"][0] if entries else None
        total[c.kind] += 1
        right[c.kind] += is_right(gloss, c)
    with capsys.disabled():
        report = ", ".join(f"{k} {right[k]}/{total[k]}" for k in sorted(total))
        print(f"\nmeanings: {sum(right.values())}/{len(cases)} right ({report})")
    assert right["derivation"] / total["derivation"] >= 0.7
    assert sum(right.values()) / len(cases) >= 0.6


@needs_db
@pytest.mark.parametrize(
    ("word", "gloss", "origin", "formed"),
    [
        ("woordeloos", "wordless", "derivation", "woord + -loos"),
        ("werkbaarheid", "workableness", "derivation", "werkbaar + -heid"),
        ("onbeschermd", "unprotected", "derivation", "on- + beschermen"),
        ("souvenirwinkel", "souvenir shop", "compound", "souvenir + winkel"),
        ("brandgevaarlijk", None, "compound", "brand + gevaarlijk"),  # not brandgevaar + -lijk
        ("berglandschap", None, "compound", "berg + landschap"),  # not bergland + -schap
    ],
)
def test_real_db_origin(word: str, gloss: str | None, origin: str, formed: str) -> None:
    entry = Dictionary().lookup([word])[word][0]
    assert (entry["origin"], entry["formed"]) == (origin, formed)
    if gloss:
        assert entry["glosses"] == [gloss]


needs_mt = pytest.mark.skipif(
    not all((model_dir() / f).is_file() for f in MODEL_FILES), reason="MT model not installed"
)


def is_right_in_context(english: str | None, case: Case) -> bool:
    """Like :func:`is_right`, but an inflected form counts (``rewrote``, ``unanswered``)."""
    if not english:
        return False
    return is_right(english, case) or stems(english) in ({*stems(a)} for a in case.accepted)


def _span(case: Case) -> tuple[int, int]:
    m = re.search(r"(?<!\w)" + re.escape(case.surface) + r"(?!\w)", case.sentence)
    assert m, case.lemma
    return m.span()


@needs_db
@needs_mt
def test_sentence_alignment_precision(capsys: pytest.CaptureFixture[str]) -> None:
    cases = load_cases()
    aligned = align_texts("nl", "en", [(c.sentence, [_span(c)]) for c in cases])
    found = Dictionary().lookup([c.lemma for c in cases])
    used = right_used = combined = 0
    for c, a in zip(cases, aligned, strict=True):
        word = a["words"][0]
        confident = word["text"] and word["confidence"] >= MIN_CONFIDENCE
        ok = is_right_in_context(word["text"], c)
        used += bool(confident)
        right_used += bool(confident and ok)
        # The app's order: dictionary/derivation > confident alignment > compound > alignment.
        entry = found[c.lemma][0] if found[c.lemma] else None
        if entry and entry.get("origin") != "compound":
            combined += is_right(entry["glosses"][0], c)
        elif confident:
            combined += ok
        elif entry:
            combined += is_right(entry["glosses"][0], c)
        else:
            combined += bool(word["text"]) and ok
    precision = right_used / used
    with capsys.disabled():
        print(
            f"\nalignment: used for {used}/{len(cases)} words, {right_used} right "
            f"(precision {precision:.2f}); all sources in the app's order: {combined}/{len(cases)}"
        )
    assert precision >= 0.8
