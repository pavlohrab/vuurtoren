"""``/sentences``: build + lookup with the real spaCy pipeline on a tiny corpus."""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kenning_nlp import app as app_module
from kenning_nlp.app import app
from kenning_nlp.models import TextAnalysis
from kenning_nlp.pipeline import analyze_texts
from kenning_nlp.sentences import (
    SentencesMissingError,
    SentenceStore,
    build_sentence_db,
    is_usable,
    perfect_evidence,
    sentence_score,
)

client = TestClient(app)

PAIRS = [
    (1, "Ik bel je morgen op.", "I will call you tomorrow."),
    (2, "Hij heeft haar gisteren opgebeld, maar ze was niet thuis.", "He called her yesterday."),
    (3, "Ik ben naar huis gelopen.", "I walked home."),
    (4, "Ik heb een boek gekocht.", "I bought a book."),
    (
        5,
        "Het huis is gebouwd in dat jaar door een bekende architect uit de stad.",
        "Built in 1990.",
    ),
    (6, "Het huis is groot.", "The house is big."),
    (7, "Ik woon in een groot huis met een tuin en een garage voor twee auto's.", "Long one."),
    (8, "Het huis is groot.", "Duplicate text is skipped."),
    (9, "Zie https://example.com voor meer.", "URL sentences are skipped."),
    (10, "Ja.", "Too short."),
    (11, "Een 😀 huis 😀 is zo leuk.", "Emoji shift UTF-16 offsets."),
]


@pytest.fixture(scope="module")
def db(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("sent") / "sentences-nl.sqlite"
    stats = build_sentence_db(PAIRS, lambda texts: analyze_texts("nl", texts), path)
    assert stats.sentences == 8  # 3 skipped: duplicate, URL, too short
    return path


def test_lookup_orders_short_common_first(db: Path) -> None:
    res = SentenceStore(db).lookup(["huis"], limit=3, max_words=15)["huis"]
    texts = [s["text"] for s in res]
    assert texts[0] == "Het huis is groot."
    assert len(res) == 3
    assert all(s["source"] == "tatoeba" and s["translation"] for s in res)


def test_target_span_slices_the_word(db: Path) -> None:
    for lemma, word in [("huis", "huis"), ("lopen", "gelopen"), ("kopen", "gekocht")]:
        for s in SentenceStore(db).lookup([lemma])[lemma]:
            start, end = s["target"]  # type: ignore[misc]
            assert str(s["text"])[start:end].lower() == word or lemma == "huis"


def test_separable_verb_is_indexed_under_the_joined_lemma(db: Path) -> None:
    res = SentenceStore(db).lookup(["opbellen"])["opbellen"]
    assert {s["text"] for s in res} == {
        "Ik bel je morgen op.",
        "Hij heeft haar gisteren opgebeld, maar ze was niet thuis.",
    }
    first = res[0]
    assert str(first["text"])[first["target"][0] : first["target"][1]] in {"bel", "opgebeld"}  # type: ignore[index]


def test_utf16_offsets_with_emoji(db: Path) -> None:
    res = SentenceStore(db).lookup(["leuk"])["leuk"]
    assert len(res) == 1
    text, (start, end) = str(res[0]["text"]), res[0]["target"]  # type: ignore[misc]
    utf16 = text.encode("utf-16-le")
    assert utf16[start * 2 : end * 2].decode("utf-16-le") == "leuk"


def test_max_words_and_limit(db: Path) -> None:
    store = SentenceStore(db)
    assert len(store.lookup(["huis"], limit=1)["huis"]) == 1
    assert store.lookup(["huis"], limit=10, max_words=3)["huis"] == []
    short = store.lookup(["huis"], limit=10, max_words=4)["huis"]
    assert "Het huis is groot." in [s["text"] for s in short]
    assert len(short) < len(store.lookup(["huis"], limit=10, max_words=15)["huis"])
    assert store.lookup(["onbekendwoord"])["onbekendwoord"] == []


def test_aux_evidence_table(db: Path) -> None:
    con = sqlite3.connect(db)
    rows = {r[0]: (r[1], r[2]) for r in con.execute("SELECT lemma, hebben, zijn FROM aux_evidence")}
    assert rows["lopen"] == (0, 1)
    assert rows["kopen"] == (1, 0)
    assert rows["opbellen"] == (1, 0)
    assert "bouwen" not in rows  # passive "is gebouwd" is not a perfect tense


def test_perfect_evidence_function() -> None:
    a: TextAnalysis = analyze_texts("nl", ["Hij is gisteren gevallen."])[0]
    assert perfect_evidence(a) == [("vallen", 1)]


def test_helpers() -> None:
    assert is_usable("Dit is een zin.")
    assert not is_usable("Zie www.example.com")
    assert not is_usable("x" * 500)
    assert sentence_score(8, [5.0] * 8) < sentence_score(20, [5.0] * 20)
    assert sentence_score(8, [5.0] * 8) < sentence_score(8, [1.0] * 8)


def test_missing_database(tmp_path: Path) -> None:
    with pytest.raises(SentencesMissingError, match="build_sentences"):
        SentenceStore(tmp_path / "x.sqlite")


def test_endpoint(db: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_module, "default_sentences_path", lambda: db)
    r = client.post("/sentences", json={"lang": "nl", "lemmas": ["huis", "xyzzy"], "limit": 2})
    assert r.status_code == 200
    body = r.json()
    assert len(body["huis"]) == 2
    assert set(body["huis"][0]) == {"text", "translation", "target", "source"}
    assert body["xyzzy"] == []
    r = client.post("/sentences", json={"lang": "nl", "lemmas": ["huis"], "maxWords": 3})
    assert r.json()["huis"] == []


def test_endpoint_validation_and_503(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    assert (
        client.post("/sentences", json={"lang": "nl", "lemmas": ["a"], "limit": 0}).status_code
        == 422
    )
    assert client.post("/sentences", json={"lang": "nl", "lemmas": ["a"] * 501}).status_code == 422
    monkeypatch.setattr(app_module, "default_sentences_path", lambda: tmp_path / "none.sqlite")
    r = client.post("/sentences", json={"lang": "nl", "lemmas": ["huis"]})
    assert r.status_code == 503
    assert "build_sentences" in r.json()["detail"]
