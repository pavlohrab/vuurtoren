"""``/forms``: fixture-based unit tests (always run) + real-DB tests (skipped without the DB)."""

import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp import app as app_module
from vuurtoren_nlp.app import app
from vuurtoren_nlp.dictionary import build_dictionary, default_db_path
from vuurtoren_nlp.wordforms import (
    WordFormsMissingError,
    WordFormsStore,
    curated_aux,
    extract_word_forms,
    resolve_aux,
)

FIXTURE = Path(__file__).parent / "fixtures" / "kaikki-forms.jsonl"
client = TestClient(app)

# (lemma, UPOS, expected subset of the WordForms). Real Wiktionary data (trimmed fixture).
CASES: list[tuple[str, str, dict[str, Any]]] = [
    ("lopen", "VERB", {"participle": "gelopen", "past": ["liep", "liepen"], "aux": "both"}),
    ("gaan", "VERB", {"participle": "gegaan", "past": ["ging", "gingen"], "aux": "zijn"}),
    ("zijn", "VERB", {"participle": "geweest", "past": ["was", "waren"], "aux": "zijn"}),
    ("hebben", "VERB", {"participle": "gehad", "past": ["had", "hadden"], "aux": "hebben"}),
    ("komen", "VERB", {"participle": "gekomen", "past": ["kwam", "kwamen"], "aux": "zijn"}),
    ("kopen", "VERB", {"participle": "gekocht", "past": ["kocht", "kochten"], "aux": "hebben"}),
    ("vallen", "VERB", {"participle": "gevallen", "past": ["viel", "vielen"], "aux": "zijn"}),
    ("blijven", "VERB", {"participle": "gebleven", "past": ["bleef", "bleven"], "aux": "zijn"}),
    ("werken", "VERB", {"participle": "gewerkt", "past": ["werkte", "werkten"], "aux": "hebben"}),
    ("eten", "VERB", {"participle": "gegeten", "past": ["at", "aten"], "aux": "hebben"}),
    ("doen", "VERB", {"participle": "gedaan", "past": ["deed", "deden"], "aux": "hebben"}),
    ("willen", "VERB", {"participle": "gewild", "past": ["wilde", "wilden"]}),
    ("kunnen", "VERB", {"participle": "gekund", "past": ["kon", "konden"]}),
    ("worden", "VERB", {"participle": "geworden", "past": ["werd", "werden"], "aux": "zijn"}),
    ("zwemmen", "VERB", {"participle": "gezwommen", "past": ["zwom", "zwommen"], "aux": "both"}),
    ("fietsen", "VERB", {"participle": "gefietst", "aux": "both"}),
    (
        "opbellen",
        "VERB",
        {
            "participle": "opgebeld",
            "past": ["belde op", "belden op"],
            "separable": {"particle": "op", "stem": "bellen"},
            "aux": "hebben",
        },
    ),
    (
        "afspreken",
        "VERB",
        {
            "participle": "afgesproken",
            "past": ["sprak af", "spraken af"],
            "separable": {"particle": "af", "stem": "spreken"},
            "aux": "hebben",
        },
    ),
    (
        "uitstappen",
        "VERB",
        {"participle": "uitgestapt", "separable": {"particle": "uit", "stem": "stappen"}},
    ),
    (
        "terugkomen",
        "VERB",
        {
            "participle": "teruggekomen",
            "separable": {"particle": "terug", "stem": "komen"},
            "aux": "zijn",
        },
    ),
    ("huis", "NOUN", {"plural": "huizen", "diminutive": "huisje"}),
    ("boek", "NOUN", {"plural": "boeken", "diminutive": "boekje"}),
    ("vrouw", "NOUN", {"plural": "vrouwen", "diminutive": "vrouwtje"}),
    ("man", "NOUN", {"plural": "mannen", "diminutive": "mannetje"}),
    ("kind", "NOUN", {"plural": "kinderen", "diminutive": "kindje"}),
    ("stad", "NOUN", {"plural": "steden", "diminutive": "stadje"}),
    ("fiets", "NOUN", {"plural": "fietsen", "diminutive": "fietsje"}),
    ("mooi", "ADJ", {"inflected": "mooie", "comparative": "mooier", "superlative": "mooist"}),
    ("groot", "ADJ", {"inflected": "grote", "comparative": "groter", "superlative": "grootst"}),
    ("klein", "ADJ", {"inflected": "kleine", "comparative": "kleiner", "superlative": "kleinst"}),
    ("goed", "ADJ", {"inflected": "goede", "comparative": "beter", "superlative": "best"}),
    ("duur", "ADJ", {"inflected": "dure", "comparative": "duurder", "superlative": "duurst"}),
    ("snel", "ADJ", {"inflected": "snelle", "comparative": "sneller", "superlative": "snelst"}),
    ("oud", "ADJ", {"inflected": "oude", "comparative": "ouder", "superlative": "oudst"}),
]


def assert_subset(actual: dict[str, Any], expected: dict[str, Any]) -> None:
    for key, value in expected.items():
        assert actual.get(key) == value, f"{key}: {actual.get(key)!r} != {value!r}"


@pytest.fixture(scope="module")
def fixture_db(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("forms") / "dictionary-nl.sqlite"
    build_dictionary(FIXTURE, path)
    return path


@pytest.mark.parametrize(("lemma", "pos", "expected"), CASES, ids=[c[0] for c in CASES])
def test_forms_from_fixture(
    fixture_db: Path, lemma: str, pos: str, expected: dict[str, Any]
) -> None:
    got = WordFormsStore(fixture_db).lookup([(lemma, pos)])[lemma]
    assert_subset(got, expected)


def test_present_by_person(fixture_db: Path) -> None:
    got = WordFormsStore(fixture_db).lookup([("zijn", "VERB"), ("opbellen", "VERB")])
    assert got["zijn"]["present"] == {
        "ik": "ben",
        "jij": "bent",
        "hij": "is",
        "wij": "zijn",
        "jullie": "zijn",
        "zij": "zijn",
    }
    assert got["opbellen"]["present"]["hij"] == "belt op"


def test_unknown_and_unsupported_pos(fixture_db: Path) -> None:
    got = WordFormsStore(fixture_db).lookup([("xyzzy", "VERB"), ("en", "CCONJ"), ("huis", "ADV")])
    assert got == {"xyzzy": {}, "en": {}, "huis": {}}


def test_separable_fallback_for_missing_entry(fixture_db: Path) -> None:
    # "terugbellen" is not in the fixture, but "bellen" is: particle list + known stem.
    got = WordFormsStore(fixture_db).lookup([("terugbellen", "VERB")])["terugbellen"]
    assert got["separable"] == {"particle": "terug", "stem": "bellen"}
    assert got["aux"] == "hebben"


def test_case_insensitive_and_noun_verb_homograph(fixture_db: Path) -> None:
    got = WordFormsStore(fixture_db).lookup([("Huis", "NOUN"), ("werken", "NOUN")])
    assert got["Huis"]["plural"] == "huizen"
    assert "participle" not in got["werken"]  # the noun reading, not the verb


def test_evidence_from_sentence_db_overrides_default(fixture_db: Path, tmp_path: Path) -> None:
    sent = tmp_path / "sentences-nl.sqlite"
    con = sqlite3.connect(sent)
    con.execute("CREATE TABLE aux_evidence (lemma TEXT PRIMARY KEY, hebben INT, zijn INT)")
    con.executemany(
        "INSERT INTO aux_evidence VALUES (?,?,?)",
        [("werken", 0, 5), ("kopen", 7, 3), ("eten", 9, 0)],
    )
    con.commit()
    con.close()
    got = WordFormsStore(fixture_db, sent).lookup(
        [("werken", "VERB"), ("kopen", "VERB"), ("eten", "VERB")]
    )
    assert got["werken"]["aux"] == "zijn"
    assert got["kopen"]["aux"] == "hebben"  # 7:3 = passives ("is gekocht")
    assert got["eten"]["aux"] == "hebben"


def test_resolve_aux_priority() -> None:
    assert resolve_aux("zijn", (10, 0), "x", None) == "zijn"  # template wins
    assert resolve_aux(None, (1, 0), "x", None) == "hebben"  # too little evidence, default
    assert resolve_aux(None, (0, 6), "x", None) == "zijn"
    assert resolve_aux(None, (4, 4), "x", None) == "both"
    assert resolve_aux(None, None, "vallen", None) == "zijn"
    assert resolve_aux(None, None, "kopen", None) == "hebben"


def test_curated_aux_inherits_from_stem() -> None:
    assert curated_aux("terugkomen", "terug") == "zijn"
    assert curated_aux("meelopen", "mee") == "both"
    assert curated_aux("kopen") is None


def test_extract_handles_missing_fields() -> None:
    assert extract_word_forms({"word": "x", "pos": "verb"}) == {}
    assert extract_word_forms({"word": "x", "pos": "adv"}) == {}
    assert extract_word_forms({"pos": "noun"}) == {}
    # placeholder rows and variants are ignored
    entry = {
        "word": "dak",
        "pos": "noun",
        "forms": [
            {"form": "-", "tags": ["plural"]},
            {"form": "daken", "tags": ["plural", "archaic"]},
            {"form": "daken", "tags": ["plural"]},
        ],
    }
    assert extract_word_forms(entry) == {"plural": "daken"}


def test_aux_from_template_arg() -> None:
    entry = {
        "word": "x",
        "pos": "verb",
        "inflection_templates": [{"name": "nl-conj-wk", "args": {"aux": "hebben,zijn"}}],
    }
    assert extract_word_forms(entry)["aux"] == "both"


def test_missing_database(tmp_path: Path) -> None:
    with pytest.raises(WordFormsMissingError, match="build_dictionary"):
        WordFormsStore(tmp_path / "nope.sqlite")


def test_old_database_without_table(tmp_path: Path) -> None:
    old = tmp_path / "old.sqlite"
    sqlite3.connect(old).execute("CREATE TABLE entries (x)").connection.commit()
    with pytest.raises(WordFormsMissingError, match="Rebuild"):
        WordFormsStore(old)


def test_endpoint_shape_and_omitted_fields(
    fixture_db: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(app_module, "default_dictionary_path", lambda: fixture_db)
    monkeypatch.setattr(app_module, "default_sentences_path", lambda: tmp_path / "none.sqlite")
    r = client.post(
        "/forms",
        json={
            "lang": "nl",
            "lemmas": [
                {"lemma": "huis", "pos": "NOUN"},
                {"lemma": "opbellen", "pos": "VERB"},
                {"lemma": "xyzzy", "pos": "NOUN"},
            ],
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["huis"] == {"plural": "huizen", "diminutive": "huisje"}
    assert body["opbellen"]["separable"] == {"particle": "op", "stem": "bellen"}
    assert body["opbellen"]["past"] == ["belde op", "belden op"]
    assert body["xyzzy"] == {}


def test_endpoint_503_without_database(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(app_module, "default_dictionary_path", lambda: tmp_path / "none.sqlite")
    r = client.post("/forms", json={"lang": "nl", "lemmas": [{"lemma": "huis", "pos": "NOUN"}]})
    assert r.status_code == 503
    assert "build_dictionary" in r.json()["detail"]


def test_endpoint_validation() -> None:
    assert client.post("/forms", json={"lang": "nl", "lemmas": ["huis"]}).status_code == 422
    too_many = [{"lemma": "a", "pos": "NOUN"}] * 501
    assert client.post("/forms", json={"lang": "nl", "lemmas": too_many}).status_code == 422


# ----------------------------------------------------------------------------- real database


def _real_db_ready() -> bool:
    path = default_db_path()
    if not path.is_file():
        return False
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return bool(con.execute("SELECT 1 FROM sqlite_master WHERE name='wordforms'").fetchone())
    finally:
        con.close()


real_db = pytest.mark.skipif(not _real_db_ready(), reason="dictionary DB with wordforms not built")


@real_db
@pytest.mark.parametrize(("lemma", "pos", "expected"), CASES, ids=[c[0] for c in CASES])
def test_forms_from_real_db(lemma: str, pos: str, expected: dict[str, Any]) -> None:
    got = WordFormsStore(default_db_path()).lookup([(lemma, pos)])[lemma]
    assert_subset(got, expected)


@real_db
def test_real_db_json_roundtrip() -> None:
    store = WordFormsStore(default_db_path())
    got = store.lookup([("lopen", "VERB")])
    assert json.loads(json.dumps(got))["lopen"]["past"] == ["liep", "liepen"]


# ---- H5 auxiliaries
def test_inseparable_prefix_does_not_inherit_stem_aux() -> None:
    """overvallen is not over+vallen; aanvallen/onderbreken are hebben-only."""
    assert curated_aux("overvallen") == "hebben"
    assert resolve_aux(None, None, "overvallen", None) == "hebben"
    assert resolve_aux(None, (7, 3), "aanvallen", "aan") == "hebben"
    assert resolve_aux(None, None, "onderbreken", None) == "hebben"


def test_confirmed_split_inherits_and_lexical_both_wins() -> None:
    assert resolve_aux(None, None, "overkomen", "over") == "zijn"
    assert resolve_aux(None, (7, 0), "zwemmen", None) == "both"
    assert resolve_aux(None, (17, 57), "stoppen", None) == "both"
    assert resolve_aux(None, (14, 3), "overtuigen", None) == "hebben"


@real_db
def test_real_db_aux_validation() -> None:
    expected = {
        "overvallen": "hebben", "aanvallen": "hebben", "onderbreken": "hebben",
        "vallen": "zijn", "lopen": "both", "gaan": "zijn", "komen": "zijn",
        "opstaan": "zijn", "opbellen": "hebben", "vertrekken": "zijn",
        "beginnen": "zijn", "blijven": "zijn", "worden": "zijn", "zwemmen": "both",
        "overkomen": "zijn", "ondernemen": "hebben", "voorkomen": "both",
        "verhuizen": "zijn", "sterven": "zijn", "groeien": "zijn", "stoppen": "both",
        "veranderen": "both", "trouwen": "zijn", "slagen": "zijn", "fietsen": "both",
    }  # fmt: skip
    db = default_db_path()
    store = WordFormsStore(db, db.parent / "sentences-nl.sqlite")
    got = store.lookup([(v, "VERB") for v in expected])
    assert {v: got[v].get("aux") for v in expected} == expected
