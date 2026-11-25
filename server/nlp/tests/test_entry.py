"""Dictionary v2: the word card's entry (``Dictionary.entry``, ``POST /entry``).

The fixture is real Kaikki lines, so the shapes are the ones the real build sees.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from vuurtoren_nlp.dictionary import Dictionary, build_dictionary, entry_extras

FIXTURE = Path(__file__).parent / "fixtures" / "kaikki-entry.jsonl"


@pytest.fixture(scope="module")
def dictionary(tmp_path_factory: pytest.TempPathFactory) -> Dictionary:
    path = tmp_path_factory.mktemp("entry") / "dictionary.sqlite"
    build_dictionary(FIXTURE, path)
    return Dictionary(path)


def test_opendoen_has_its_forms_base_verb_and_synonym(dictionary: Dictionary) -> None:
    e = dictionary.entry("opendoen")
    assert e["word"] == "opendoen"
    (verb,) = [x for x in e["entries"] if x["pos"] == "verb"]
    assert verb["glosses"][0] == "to open"
    assert verb["forms"]["present"]["hij"] == "doet open"
    assert verb["forms"]["participle"] == "opengedaan"
    assert verb["base"] == "doen"
    assert "openen" in verb["extras"]["senses"][0]["synonyms"]


def test_doen_lists_its_separable_family(dictionary: Dictionary) -> None:
    (verb,) = [x for x in dictionary.entry("doen")["entries"] if x["pos"] == "verb"]
    assert {"opendoen", "dichtdoen", "aandoen", "meedoen"} <= set(verb["family"])
    # Nouns and phrases made from doen are not its verb family.
    assert "doener" not in verb["family"]
    assert "base" not in verb


def test_moeten_has_an_antonym_in_its_sense(dictionary: Dictionary) -> None:
    (verb,) = [x for x in dictionary.entry("moeten")["entries"] if x["pos"] == "verb"]
    antonyms = [a for s in verb["extras"]["senses"] for a in s.get("antonyms", [])]
    assert "niet hoeven" in antonyms


def test_a_form_finds_its_lemma(dictionary: Dictionary) -> None:
    assert dictionary.entry("opengedaan")["word"] == "opendoen"
    # "doet" has an entry of its own ("inflection of doen"): the card gets doen.
    assert dictionary.entry("doet")["word"] == "doen"


def test_unknown_word_is_empty(dictionary: Dictionary) -> None:
    assert dictionary.entry("wegmoeten") == {"word": "wegmoeten", "entries": []}


def test_an_older_pack_answers_without_the_v2_fields(tmp_path: Path) -> None:
    path = tmp_path / "old.sqlite"
    build_dictionary(FIXTURE, path)
    con = sqlite3.connect(path)
    con.executescript("DROP TABLE extras; DROP TABLE family;")
    con.close()
    (verb,) = [x for x in Dictionary(path).entry("opendoen")["entries"] if x["pos"] == "verb"]
    assert verb["forms"]["participle"] == "opengedaan"
    assert "extras" not in verb and "family" not in verb and "base" not in verb


def test_extras_keep_only_what_is_there() -> None:
    assert entry_extras({"senses": [{"glosses": ["to open"]}]}) == {}
    x = entry_extras(
        {
            "senses": [
                {
                    "glosses": ["to open"],
                    "examples": [{"text": "Doe open!", "english": "Open up!"}],
                }
            ],
            "sounds": [{"ipa": "/x/"}, {"audio": "Nl-opendoen.ogg"}],
            "hyphenations": [{"parts": ["open", "doen"]}],
        }
    )
    assert x["senses"][0]["examples"] == [{"nl": "Doe open!", "en": "Open up!"}]
    assert x["audio"] == "Nl-opendoen.ogg"
    assert x["hyphenation"] == "open·doen"


def test_entry_route(monkeypatch: pytest.MonkeyPatch, dictionary: Dictionary) -> None:
    from fastapi.testclient import TestClient

    from vuurtoren_nlp import app as app_module

    monkeypatch.setattr(app_module, "_dictionary", lambda: dictionary)
    r = TestClient(app_module.app).post("/entry", json={"lang": "nl", "word": "doet"})
    assert r.status_code == 200
    assert r.json()["word"] == "doen"
    # doen takes hebben (the perfect tense's helper, as /forms resolves it).
    (verb,) = [e for e in r.json()["entries"] if e["pos"] == "verb"]
    assert verb["forms"].get("aux") in {"hebben", None}


def test_old_and_specialist_meanings_go_last_with_their_synonyms(dictionary: Dictionary) -> None:
    (noun,) = [x for x in dictionary.entry("burgemeester")["entries"] if x["pos"] == "noun"]
    assert noun["glosses"][0].startswith("mayor")
    senses = noun["extras"]["senses"]
    assert senses[0].get("mark") is None
    # the two gulls (a Latin species name) and the Roman consul (historical, obsolete)
    assert [s.get("mark") for s in senses[1:]] == ["specialist", "specialist", "old"]
    # "kleine burgemeester" is the gull's synonym, not the mayor's
    assert "kleine burgemeester" not in noun["extras"].get("synonyms", [])
    assert "synonyms" not in senses[0]


def test_heb_or_ben_from_the_dutch_wiktionary(dictionary: Dictionary) -> None:
    (verb,) = [x for x in dictionary.entry("gaan")["entries"] if x["pos"] == "verb"]
    assert verb["forms"]["aux"] == "zijn"
