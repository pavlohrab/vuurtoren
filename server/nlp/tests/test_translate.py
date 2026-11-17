"""``POST /translate``: engine mocked (runs in CI without the model) + one real-model test."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from kenning_nlp import translate as mt
from kenning_nlp.app import app

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
    monkeypatch.setenv("KENNING_MT_DIR", str(tmp_path))
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
