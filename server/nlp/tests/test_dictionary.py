import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp import app as app_module
from vuurtoren_nlp.app import app
from vuurtoren_nlp.dictionary import (
    Dictionary,
    DictionaryMissingError,
    build_dictionary,
    extract_glosses,
)

FIXTURE = Path(__file__).parent / "fixtures" / "kaikki-mini.jsonl"
client = TestClient(app)


@pytest.fixture(scope="module")
def db(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("dict") / "dictionary-nl.sqlite"
    stats = build_dictionary(FIXTURE, path)
    # leeg (no glosses), bad JSON and the word-less line are skipped
    assert stats["entries"] == 7
    return path


def test_build_schema_and_index(db: Path) -> None:
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"entries", "forms"} <= tables
    plan = " ".join(
        str(r)
        for r in con.execute("EXPLAIN QUERY PLAN SELECT * FROM entries WHERE lower(word)='a'")
    )
    assert "idx_entries_word" in plan
    # forms: metadata rows excluded, headword itself excluded
    forms = {r[0] for r in con.execute("SELECT form FROM forms WHERE lemma='fiets'")}
    assert {"fietsen", "fietsje"} <= forms
    assert "nl-noun" not in forms


def test_glosses_capped_at_five() -> None:
    senses = [{"glosses": [f"sense {i}"]} for i in range(9)]
    assert len(extract_glosses(senses)) == 5
    assert extract_glosses([{"glosses": ["a", "b"]}, {"glosses": ["a", "b"]}]) == ["a: b"]
    assert extract_glosses([{"glosses": ["inflection of x:", "plural"]}]) == [
        "inflection of x: plural"
    ]


def test_lookup_article_gender_and_senses(db: Path) -> None:
    d = Dictionary(db)
    res = d.lookup(["fiets", "Huis", "boek", "lopen"])
    assert res["fiets"][0] == {"pos": "noun", "article": "de", "glosses": ["bicycle", "motorbike"]}
    assert res["Huis"][0]["article"] == "het"
    assert res["Huis"][0]["glosses"][0] == "house: dwelling"
    assert res["boek"][0]["article"] == "de/het"
    assert res["lopen"][0]["article"] is None
    assert len(res["lopen"][0]["glosses"]) == 5


def test_lookup_multiple_entries_and_form_fallback(db: Path) -> None:
    d = Dictionary(db)
    res = d.lookup(["fietsen", "huizen", "nonexistent"])
    assert [e["pos"] for e in res["fietsen"]] == ["verb", "noun"]
    assert res["huizen"][0]["glosses"][0] == "house: dwelling"  # via forms table
    assert res["nonexistent"] == []


def test_missing_db_raises(tmp_path: Path) -> None:
    with pytest.raises(DictionaryMissingError, match="build_dictionary"):
        Dictionary(tmp_path / "nope.sqlite")


def test_gloss_endpoint(db: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_module, "_dictionary", lambda: Dictionary(db))
    r = client.post("/gloss", json={"lang": "nl", "words": ["fiets", "zzz"]})
    assert r.status_code == 200
    body = r.json()
    assert body["fiets"][0]["glosses"] == ["bicycle", "motorbike"]
    assert body["zzz"] == []


def test_gloss_endpoint_503_when_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VUURTOREN_DICT_PATH", str(tmp_path / "absent.sqlite"))
    app_module._dictionary.cache_clear()
    r = client.post("/gloss", json={"lang": "nl", "words": ["fiets"]})
    assert r.status_code == 503
    assert "build_dictionary" in r.json()["detail"]


def test_rude_meanings_come_last_and_labelled_informal_stays() -> None:
    """WC8: vulgar, offensive and slang meanings go last with their label, like the old ones."""
    from vuurtoren_nlp.dictionary import extract_glosses, sense_mark

    senses = [
        {"glosses": ["to have sex with someone"], "tags": ["vulgar"]},
        {"glosses": ["to do"]},
        {"glosses": ["to put"], "tags": ["informal"]},
        {"glosses": ["a slur"], "tags": ["ethnic", "slur"]},
        {"glosses": ["cool"], "tags": ["slang"]},
    ]
    assert [sense_mark(s) for s in senses] == ["vulgar", None, None, "offensive", "slang"]
    assert extract_glosses(senses) == ["to do", "to put"]
