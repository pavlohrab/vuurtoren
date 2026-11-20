"""``POST /translate``: engine mocked (runs in CI without the model) + one real-model test."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from vuurtoren_nlp import translate as mt
from vuurtoren_nlp.align import AttentionResult, agrees, align_word
from vuurtoren_nlp.app import app

client = TestClient(app)


class FakeEngine:
    """Upper-cases the text; records the batches it was given."""

    def __init__(self) -> None:
        self.batches: list[list[str]] = []

    def translate(self, texts: list[str]) -> list[str]:
        self.batches.append(texts)
        return [t.upper() for t in texts]


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeEngine]:
    engine = FakeEngine()
    monkeypatch.setattr(mt, "get_engine", lambda: engine)
    yield engine


def post(texts: list[str], **extra: object) -> Response:
    return client.post("/translate", json={"source": "nl", "target": "en", "texts": texts, **extra})


def test_translate_pairs_in_order(fake: FakeEngine) -> None:
    r = post(["Ik bel op.", "Goedemorgen"], context=True)
    assert r.status_code == 200
    assert r.json() == [
        {"text": "Ik bel op.", "translation": "IK BEL OP."},
        {"text": "Goedemorgen", "translation": "GOEDEMORGEN"},
    ]
    assert fake.batches == [["Ik bel op.", "Goedemorgen"]]  # one batched call


def test_translate_empty_list(fake: FakeEngine) -> None:
    assert post([]).json() == []


def test_unsupported_pair_is_422(fake: FakeEngine) -> None:
    r = client.post("/translate", json={"source": "en", "target": "nl", "texts": ["a"]})
    assert r.status_code == 422


def test_limits(fake: FakeEngine) -> None:
    assert post(["x" * 2001]).status_code == 422
    assert post(["a"] * 65).status_code == 422
    # 11 x 2000 = 22,000 > 20,000 total
    assert post(["x" * 2000] * 11).status_code == 413
    assert post(["x" * 2000] * 10).status_code == 200
    assert len(fake.batches) == 1


def test_missing_model_gives_503_with_guidance(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("VUURTOREN_MT_DIR", str(tmp_path))
    monkeypatch.setattr(mt, "_engine", None)
    r = post(["Hallo"])
    assert r.status_code == 503
    assert "fetch_mt_model.py" in r.json()["detail"]


@pytest.mark.skipif(
    not all((mt.model_dir() / f).is_file() for f in mt.MODEL_FILES),
    reason="MT model not fetched (run scripts/fetch_mt_model.py)",
)
def test_real_model_translates_dutch() -> None:
    r = post(["Ik bel mijn zus vanavond op.", "  ", "De fiets staat in de schuur."])
    assert r.status_code == 200
    out = [x["translation"].lower() for x in r.json()]
    assert "sister" in out[0]
    assert out[1] == ""
    assert "bike" in out[2] or "bicycle" in out[2]


# --- /translate/align ----------------------------------------------------------------------


class FakeAttentionEngine(FakeEngine):
    """Word-by-word "translation": each source word maps to its upper-cased self."""

    def translate_attention(self, texts: list[str]) -> list[AttentionResult]:
        self.batches.append(texts)
        out = []
        for text in texts:
            src = ["▁" + w for w in text.split()]
            tgt = ["▁" + w.upper() for w in text.split()]
            att = [[1.0 if s == t else 0.0 for s in range(len(src) + 1)] for t in range(len(tgt))]
            out.append(AttentionResult(text.upper(), src, tgt, att))
        return out


@pytest.fixture
def fake_align(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeAttentionEngine]:
    engine = FakeAttentionEngine()
    monkeypatch.setattr(mt, "get_engine", lambda: engine)
    mt.reset_engine()
    yield engine
    mt.reset_engine()


def test_align_endpoint(fake_align: FakeAttentionEngine) -> None:
    res = client.post(
        "/translate/align",
        json={
            "source": "nl",
            "target": "en",
            "items": [{"text": "Hij stond woordeloos te kijken", "spans": [[10, 20], [0, 3]]}],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body[0]["translation"] == "HIJ STOND WOORDELOOS TE KIJKEN"
    first, second = body[0]["words"]
    # an English word identical to the Dutch one counts as left untranslated
    assert (first["start"], first["end"], first["text"]) == (10, 20, None)
    assert second["text"] is None
    # the sentence and each word were translated once
    assert fake_align.batches == [["Hij stond woordeloos te kijken", "woordeloos", "Hij"]]


def test_align_limits(fake_align: FakeAttentionEngine) -> None:
    body = {"source": "nl", "target": "en", "items": [{"text": "x", "spans": [[0, 1]] * 201}]}
    assert client.post("/translate/align", json=body).status_code == 422


def test_align_word_reads_attention() -> None:
    # He was looking at the sea wordless . <- Hij stond woordeloos naar de zee te kijken .
    src = ["▁Hij", "▁stond", "▁woord", "eloos", "▁naar", "▁de", "▁zee", "▁te", "▁kijken", "."]
    tgt = ["▁He", "▁was", "▁looking", "▁at", "▁the", "▁sea", "▁word", "less", "."]
    argmax = [0, 1, 2, 4, 5, 6, 2, 3, 9]  # "looking" wrongly attends to "woord"
    att = [[0.9 if s == a else 0.01 for s in range(len(src) + 1)] for a in argmax]
    res = AttentionResult("He was looking at the sea wordless.", src, tgt, att)
    sentence = "Hij stond woordeloos naar de zee te kijken."
    found = align_word(res, sentence, 10, 20)
    assert found is not None
    # two runs ("looking", "wordless"): the one with more attention mass wins
    assert found.text == "wordless"
    assert agrees("wordless", "Wordless")
    assert not agrees("looking", "wordless")
    assert align_word(res, sentence, 0, 3) is not None
    assert align_word(res, "two words", 0, 3) is None  # word groups do not match the sentence
