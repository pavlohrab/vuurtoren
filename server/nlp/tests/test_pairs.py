"""``POST /translate/pairs``: sentence pairs for the side-by-side reader (engine faked)."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp import translate as mt
from vuurtoren_nlp.align import AttentionResult
from vuurtoren_nlp.app import app
from vuurtoren_nlp.pairs import english_tokens, pair_sentence, piece_spans

client = TestClient(app)

SENTENCE = "Morgen bel ik mijn moeder op."
# Tomorrow I call my mother up . <- Morgen bel ik mijn moeder op .
SOURCE = ["▁Morgen", "▁bel", "▁ik", "▁mijn", "▁moe", "der", "▁op", "."]
TARGET = ["▁Tomorrow", "▁I", "▁call", "▁my", "▁mother", "▁up", "."]
ARGMAX = [0, 2, 1, 3, 4, 6, 7]


def attention(argmax: list[int], n: int, peak: float = 0.9) -> list[list[float]]:
    return [[peak if s == a else (1 - peak) / n for s in range(n + 1)] for a in argmax]


def spans(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in re.finditer(r"\w+", text)]


class FakePairEngine:
    """Knows one sentence; anything else is "translated" into a repeated exclamation."""

    def __init__(self) -> None:
        self.own: list[list[str]] = []
        self.forced: list[list[tuple[str, str]]] = []

    def translate(self, texts: list[str]) -> list[str]:
        return [r.translation for r in self.translate_attention(texts)]

    def translate_attention(self, texts: list[str]) -> list[AttentionResult]:
        self.own.append(texts)
        out = []
        for text in texts:
            if text == SENTENCE:
                att = attention(ARGMAX, len(SOURCE))
                out.append(AttentionResult("Tomorrow I call my mother up.", SOURCE, TARGET, att))
            else:
                src = ["▁" + w for w in text.split()]
                tgt = ["▁Oh", "▁my", "▁God", ".", "▁Oh", "▁my", "▁God", "."]
                att = attention([0] * len(tgt), len(src))
                out.append(AttentionResult("Oh my God. Oh my God.", src, tgt, att))
        return out

    def force_attention(self, texts: list[str], targets: list[str]) -> list[AttentionResult]:
        self.forced.append(list(zip(texts, targets, strict=True)))
        # Tomorrow I will phone my mother .
        tgt = ["▁Tomorrow", "▁I", "▁will", "▁pho", "ne", "▁my", "▁mother", "."]
        argmax = [0, 2, 1, 1, 1, 3, 4, 7]
        return [
            AttentionResult(target, SOURCE, tgt, attention(argmax, len(SOURCE)))
            for target in targets
        ]


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakePairEngine]:
    fake = FakePairEngine()
    monkeypatch.setattr(mt, "get_engine", lambda: fake)
    mt.reset_engine()
    yield fake
    mt.reset_engine()


def post(items: list[dict[str, object]]) -> list[dict[str, object]]:
    res = client.post("/translate/pairs", json={"source": "nl", "target": "en", "items": items})
    assert res.status_code == 200, res.text
    body: list[dict[str, object]] = res.json()
    return body


def words_of(text: str, out: dict[str, object], pair: dict[str, list[int]]) -> tuple[list, list]:
    sp = spans(text)
    english = out["english"]
    assert isinstance(english, list)
    return (
        [text[sp[i][0] : sp[i][1]] for i in pair["nl"]],
        [english[j]["text"] for j in pair["en"]],
    )


def test_separable_verb_parts_share_one_pair(engine: FakePairEngine) -> None:
    # "op" (word 5) is the particle of "bel" (word 1)
    (out,) = post([{"text": SENTENCE, "spans": spans(SENTENCE), "joins": [[5, 1]]}])
    assert out["translation"] == "Tomorrow I call my mother up."
    assert out["source"] == "mt"
    pairs = out["pairs"]
    assert isinstance(pairs, list)
    found = [words_of(SENTENCE, out, p) for p in pairs]
    assert found == [
        (["Morgen"], ["Tomorrow"]),
        (["bel", "op"], ["call", "up"]),
        (["ik"], ["I"]),
        (["mijn"], ["my"]),
        (["moeder"], ["mother"]),  # two Dutch subwords, one word
    ]
    words = out["words"]
    assert isinstance(words, list)
    assert words[1]["pair"] == words[5]["pair"] == 1
    assert words[1]["en"] == words[5]["en"] == [2, 5]
    assert all(0.4 <= p["confidence"] <= 1 for p in pairs)


def test_without_joins_the_particle_pairs_alone(engine: FakePairEngine) -> None:
    (out,) = post([{"text": SENTENCE, "spans": spans(SENTENCE)}])
    pairs = out["pairs"]
    assert isinstance(pairs, list)
    assert (["op"], ["up"]) in [words_of(SENTENCE, out, p) for p in pairs]


def test_rejected_translation_has_no_english_and_no_pairs(engine: FakePairEngine) -> None:
    text = "– wisselt van kleur"
    (out,) = post([{"text": text, "spans": spans(text)}])
    assert out["translation"] == ""
    assert out["english"] == []
    assert out["pairs"] == []
    words = out["words"]
    assert isinstance(words, list)
    assert [w["pair"] for w in words] == [None, None, None]
    # the model read the cleaned source (the leading dash would make it invent a sentence)
    assert engine.own == [["  wisselt van kleur"]]


def test_given_translation_is_force_decoded(engine: FakePairEngine) -> None:
    item = {
        "text": SENTENCE,
        "spans": spans(SENTENCE),
        "joins": [[5, 1]],
        "translation": " Tomorrow I will phone my mother. ",
    }
    (out,) = post([item])
    assert out["source"] == "given"
    assert out["translation"] == "Tomorrow I will phone my mother."
    pairs = out["pairs"]
    assert isinstance(pairs, list)
    found = [words_of(SENTENCE, out, p) for p in pairs]
    assert (["bel", "op"], ["will", "phone"]) in found
    assert engine.own == []  # the model's own translation is not needed
    assert engine.forced == [[(SENTENCE, "Tomorrow I will phone my mother.")]]
    post([item])  # cached
    assert len(engine.forced) == 1


def test_pairs_are_cached_like_alignments(engine: FakePairEngine) -> None:
    item = {"text": SENTENCE, "spans": spans(SENTENCE)}
    post([item])
    post([item, item])
    assert engine.own == [[SENTENCE]]


def test_limits(engine: FakePairEngine) -> None:
    body = {"source": "nl", "target": "en", "items": [{"text": "x", "spans": [[0, 1]] * 201}]}
    assert client.post("/translate/pairs", json=body).status_code == 422
    long = {"text": "x", "spans": [], "translation": "y" * 2001}
    body = {"source": "nl", "target": "en", "items": [long]}
    assert client.post("/translate/pairs", json=body).status_code == 422


def test_english_tokens_split_contractions_and_punctuation() -> None:
    assert [t["text"] for t in english_tokens("Tomorrow I'll call, mom.")] == [
        "Tomorrow",
        "I",
        "'ll",
        "call",
        ",",
        "mom",
        ".",
    ]


def test_piece_spans_skip_pieces_that_do_not_fit() -> None:
    assert piece_spans(["▁Ik", "▁<unk>", "▁bel", "."], "Ik ☃ bel.") == [
        (0, 2),
        None,
        (5, 8),
        (8, 9),
    ]


def test_low_attention_gives_no_pair() -> None:
    res = AttentionResult(
        "Tomorrow I call my mother up.", SOURCE, TARGET, attention(ARGMAX, len(SOURCE), 0.3)
    )
    out = pair_sentence(res, SENTENCE, res.translation, spans(SENTENCE))
    assert out["pairs"] == []
    assert len(out["english"]) == 7


@pytest.mark.skipif(
    not all((mt.model_dir() / f).is_file() for f in mt.MODEL_FILES),
    reason="MT model not fetched (run scripts/fetch_mt_model.py)",
)
def test_real_model_pairs_a_subordinate_clause(tmp_path: Path) -> None:
    mt.reset_engine()
    text = "Omdat het gisteren zo hard regende, bleven we binnen."
    (out,) = post([{"text": text, "spans": spans(text)}])
    pairs = out["pairs"]
    assert isinstance(pairs, list)
    found = dict((" ".join(nl), " ".join(en)) for nl, en in (words_of(text, out, p) for p in pairs))
    assert found.get("regende") == "rained"
    assert found.get("binnen") == "inside"
