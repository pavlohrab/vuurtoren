"""The bundled stories' precomputed pairs and grammar hits (vuurtoren_nlp.story_extras)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from vuurtoren_nlp import story_extras
from vuurtoren_nlp import translate as mt
from vuurtoren_nlp.align import AttentionResult
from vuurtoren_nlp.grammar import detect_grammar
from vuurtoren_nlp.pipeline import analyze_texts


class DiagonalEngine:
    """Forced decoding where the n-th English word attends to the n-th Dutch word."""

    def __init__(self) -> None:
        self.forced: list[list[tuple[str, str]]] = []

    def translate(self, texts: list[str]) -> list[str]:
        raise AssertionError("a story's English is given: the model must not translate")

    def translate_attention(self, texts: list[str]) -> list[AttentionResult]:
        raise AssertionError("a story's English is given: the model must not translate")

    def force_attention(self, texts: list[str], targets: list[str]) -> list[AttentionResult]:
        self.forced.append(list(zip(texts, targets, strict=True)))
        out = []
        for text, target in zip(texts, targets, strict=True):
            src = ["▁" + w for w in text.split()]
            tgt = ["▁" + w for w in target.split()]
            att = [
                [0.9 if s == min(t, len(src) - 1) else 0.1 / len(src) for s in range(len(src))]
                for t in range(len(tgt))
            ]
            out.append(AttentionResult(target.strip(), src, tgt, att))
        return out


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch) -> Iterator[DiagonalEngine]:
    fake = DiagonalEngine()
    monkeypatch.setattr(mt, "get_engine", lambda: fake)
    mt.reset_engine()
    yield fake
    mt.reset_engine()


CONTENT = 'In Kampen staat een kerk. Hij belt zijn moeder op.\n\n"Ja!"'
LINES = [
    (0, 25, "In Kampen stands a church."),
    (26, 50, "He calls his mother up."),
    (52, 57, '"Yes!"'),
]


def test_story_extras_pairs_the_story_english_and_finds_the_grammar(engine: DiagonalEngine):
    tokens = analyze_texts("nl", [CONTENT])[0].tokens
    out = story_extras.story_extras(CONTENT, tokens, LINES)
    # Each sentence as the reader sends it, with the story's own English (forced decoding).
    assert [en for _, en in engine.forced[0]] == [en for *_, en in LINES][: len(engine.forced[0])]
    sents = sorted({t.sent for t in tokens})
    assert len(out["pairs"]) == len(sents)
    first = out["pairs"][0]
    assert first[0] == [[0], [0], 0.9]  # "In" <-> "In"
    assert all(round(c, 2) == c for p in out["pairs"] if p for *_, c in p)
    # "op" is joined to "belt": one pair for both.
    words = [t for t in tokens if t.sent == 1 and t.is_word]
    belt = next(k for k, t in enumerate(words) if t.text == "belt")
    op = next(k for k, t in enumerate(words) if t.text == "op")
    assert any(belt in nl and op in nl for nl, _, _ in out["pairs"][1])
    assert "pairsEnglish" not in out
    # The hits of /grammar, on the same token indices.
    hits = detect_grammar(CONTENT, analyze_texts("nl", [CONTENT])[0])
    assert out["grammar"] == [
        [h.topic, h.tokens, h.note] if h.note else [h.topic, h.tokens] for h in hits
    ]
    inversion = [g for g in out["grammar"] if g[0] == "inversion"]
    assert [[tokens[i].text for i in g[1]] for g in inversion] == [["staat", "kerk"]]


def test_a_sentence_without_a_line_is_left_to_the_server(engine: DiagonalEngine):
    tokens = analyze_texts("nl", [CONTENT])[0].tokens
    out = story_extras.story_extras(CONTENT, tokens, LINES[:1])
    assert out["pairs"][0]
    assert out["pairs"][1] is None


def test_sentence_english_joins_lines_in_one_sentence():
    tokens = analyze_texts("nl", ["Hij slaapt. Zij ook."])[0].tokens
    joined = [t.model_copy(update={"sent": 0}) for t in tokens]
    lines = [(0, 11, "He sleeps."), (12, 20, "She too.")]
    assert story_extras.sentence_english(joined, lines) == {0: "He sleeps. She too."}


def test_versions_name_the_pairing_code():
    assert story_extras.pairer_version().startswith("p-")
