"""Rough CEFR levels per word (NT2Lex, levels-nl.tsv.gz) and the /levels route."""

from __future__ import annotations

from fastapi.testclient import TestClient

from vuurtoren_nlp.app import app
from vuurtoren_nlp.levels import word_level


def test_word_levels() -> None:
    assert word_level("huis", "noun") == "A1"
    assert word_level("zeggen", "verb") == "A1"
    assert word_level("burgemeester") == "B1"
    assert word_level("opendoen", "verb") == "A2"
    assert word_level("wegmoeten") is None


def test_levels_route_leaves_out_unknown_words() -> None:
    r = TestClient(app).post(
        "/levels",
        json={
            "lang": "nl",
            "lemmas": [
                {"lemma": "huis", "pos": "NOUN"},
                {"lemma": "burgemeester", "pos": "NOUN"},
                {"lemma": "wegmoeten", "pos": "VERB"},
            ],
        },
    )
    assert r.status_code == 200
    assert r.json() == {"huis": "A1", "burgemeester": "B1"}
