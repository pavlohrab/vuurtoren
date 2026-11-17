"""``/similar``: index logic on a hand-made vocabulary (real vectors) + real-DB endpoint test."""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kenning_nlp import app as app_module
from kenning_nlp.app import app
from kenning_nlp.dictionary import build_dictionary, default_db_path
from kenning_nlp.pipeline import get_nlp
from kenning_nlp.similar import SimilarIndex, SimilarMissingError, SimilarService, load_vocabulary

client = TestClient(app)
VOCAB = {
    "noun": ["hond", "kat", "paard", "vogel", "huis", "kamer", "school", "trein", "fiets", "boom"],
    "verb": ["lopen", "rennen", "kopen", "eten", "slapen"],
    "adj": ["mooi", "groot", "klein", "snel"],
}


@pytest.fixture(scope="module")
def index() -> SimilarIndex:
    return SimilarIndex(get_nlp("nl"), VOCAB)


def test_same_pos_only(index: SimilarIndex) -> None:
    res = index.similar("hond", "NOUN", k=8)
    assert res
    assert set(res) <= set(VOCAB["noun"]) - {"hond"}
    assert not set(res) & set(VOCAB["verb"] + VOCAB["adj"])


def test_excludes_self_and_respects_k(index: SimilarIndex) -> None:
    res = index.similar("fiets", "NOUN", k=3)
    assert "fiets" not in res
    assert len(res) <= 3


def test_related_words_for_animals(index: SimilarIndex) -> None:
    assert {"kat", "paard", "vogel"} & set(index.similar("hond", "NOUN"))


def test_unknown_word_or_pos(index: SimilarIndex) -> None:
    assert index.similar("xyzzyqq", "NOUN") == []
    assert index.similar("hond", "PUNCT") == []
    assert index.similar("hond", "ADV") == []  # no adverbs in this vocabulary


def test_aux_counts_as_verb(index: SimilarIndex) -> None:
    assert index.similar("lopen", "AUX") == index.similar("lopen", "VERB")


def test_no_vectors_raises() -> None:
    import spacy

    with pytest.raises(SimilarMissingError, match="vectors"):
        SimilarIndex(spacy.blank("nl"), {"noun": ["hond"]})


def test_service_503_without_database(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(app_module, "_similar_service", lambda: SimilarService(tmp_path / "x"))
    r = client.post("/similar", json={"lang": "nl", "words": [{"lemma": "hond", "pos": "NOUN"}]})
    assert r.status_code == 503
    assert "build_dictionary" in r.json()["detail"]


def test_validation() -> None:
    assert client.post("/similar", json={"lang": "nl", "words": ["hond"]}).status_code == 422
    body = {"lang": "nl", "words": [{"lemma": "a", "pos": "NOUN"}], "k": 0}
    assert client.post("/similar", json=body).status_code == 422


def test_vocabulary_keeps_headwords_only(tmp_path: Path) -> None:
    fixture = Path(__file__).parent / "fixtures" / "kaikki-forms.jsonl"
    db = tmp_path / "d.sqlite"
    build_dictionary(fixture, db)
    vocab = load_vocabulary(db)
    assert "huis" in vocab["noun"]
    assert "gelopen" not in vocab.get("verb", [])


def _real_db() -> bool:
    path = default_db_path()
    if not path.is_file():
        return False
    return bool(
        sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        .execute("SELECT 1 FROM sqlite_master WHERE name='entries'")
        .fetchone()
    )


@pytest.mark.skipif(not _real_db(), reason="dictionary DB not built")
def test_endpoint_with_real_dictionary() -> None:
    app_module._similar_service.cache_clear()
    words = [{"lemma": "hond", "pos": "NOUN"}, {"lemma": "mooi", "pos": "ADJ"}]
    r = client.post("/similar", json={"lang": "nl", "words": words, "k": 6})
    assert r.status_code == 200
    body = r.json()
    assert 0 < len(body["hond"]) <= 6
    assert "hond" not in body["hond"]
    assert "huizen" not in body["hond"]  # inflected forms are not in the vocabulary
    assert body["mooi"]
