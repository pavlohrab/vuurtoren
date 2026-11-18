"""Grammar detectors: hand-labelled sentences (``grammar_cases.py``), precision and recall."""

from functools import cache

import pytest
from grammar_cases import CASES

from kenning_nlp.grammar import DETECTORS, TOPICS, detect_grammar
from kenning_nlp.pipeline import analyze_texts


@cache
def topics_of(text: str) -> frozenset[str]:
    (analysis,) = analyze_texts("nl", [text])
    return frozenset(h.topic for h in detect_grammar(text, analysis))


POSITIVE = [(t, s) for t, (pos, _) in CASES.items() for s in pos]
NEGATIVE = [(t, s) for t, (_, neg) in CASES.items() for s in neg]


def test_every_topic_has_enough_cases() -> None:
    assert set(CASES) == TOPICS
    for topic, (pos, neg) in CASES.items():
        assert len(pos) >= 3 and len(neg) >= 2, topic
    assert len(DETECTORS) >= 20  # some detectors yield several topics


@pytest.mark.parametrize(("topic", "sentence"), POSITIVE)
def test_detects(topic: str, sentence: str) -> None:
    assert topic in topics_of(sentence), sentence


@pytest.mark.parametrize(("topic", "sentence"), NEGATIVE)
def test_does_not_fire(topic: str, sentence: str) -> None:
    assert topic not in topics_of(sentence), sentence


def test_precision_and_recall(capsys: pytest.CaptureFixture[str]) -> None:
    """Measured on the labelled set; the bars guard against regressions."""
    tp = sum(topic in topics_of(s) for topic, s in POSITIVE)
    fp = sum(topic in topics_of(s) for topic, s in NEGATIVE)
    precision = tp / (tp + fp)
    recall = tp / len(POSITIVE)
    with capsys.disabled():
        print(f"\ngrammar: precision {precision:.3f} ({tp} TP, {fp} FP), recall {recall:.3f}")
    assert precision >= 0.95
    assert recall >= 0.9


def test_hit_shape() -> None:
    text = "Morgen ga ik naar school. Ik ben moe."
    (analysis,) = analyze_texts("nl", [text])
    hits = [h for h in detect_grammar(text, analysis) if h.topic == "inversion"]
    assert len(hits) == 1
    hit = hits[0]
    assert hit.sentence == "Morgen ga ik naar school."
    assert (hit.start, hit.end) == (0, 25)
    assert hit.sent == 0
    assert [analysis.tokens[i].text for i in hit.tokens] == ["ga", "ik"]
    assert "Morgen" in hit.note


def test_offsets_are_utf16() -> None:
    text = "Een \U0001f600 dag. Morgen ga ik naar school."
    (analysis,) = analyze_texts("nl", [text])
    hit = next(h for h in detect_grammar(text, analysis) if h.topic == "inversion")
    assert hit.sentence == "Morgen ga ik naar school."
    utf16 = text.encode("utf-16-le")
    assert utf16[2 * hit.start : 2 * hit.end].decode("utf-16-le") == hit.sentence
