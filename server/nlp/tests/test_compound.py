"""Compound analysis: pure splitter (fixture dictionary) + /gloss integration + real-DB coverage."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from kenning_nlp import app as app_module
from kenning_nlp.app import app
from kenning_nlp.compound import PartEntry, is_form_of_gloss, split_compound
from kenning_nlp.dictionary import Dictionary, build_dictionary, default_db_path

FIXTURES = Path(__file__).parent / "fixtures"
client = TestClient(app)


@pytest.fixture(scope="module")
def fixture_dict(tmp_path_factory: pytest.TempPathFactory) -> Dictionary:
    path = tmp_path_factory.mktemp("dict") / "dictionary-nl.sqlite"
    build_dictionary(FIXTURES / "kaikki-compounds.jsonl", path)
    return Dictionary(path)


# word -> (parts as "surface+linker" strings, article, pos)
COMPOUNDS = [
    ("souvenirwinkel", ["souvenir", "winkel"], "de", "noun"),
    ("fietsenstalling", ["fietsen", "stalling"], "de", "noun"),
    ("ziektekostenverzekering", ["ziekte", "kosten", "verzekering"], "de", "noun"),
    ("gemeenteraadsverkiezingen", ["gemeente", "raad+s", "verkiezingen"], "de", "noun"),
    ("boekenkast", ["boeken", "kast"], "de", "noun"),
    ("schoolbus", ["school", "bus"], "de", "noun"),
    ("vakantiehuis", ["vakantie", "huis"], "het", "noun"),
    ("tuinstoel", ["tuin", "stoel"], "de", "noun"),
    ("werkdag", ["werk", "dag"], "de", "noun"),
    ("kinderfeest", ["kind+er", "feest"], "het", "noun"),
    ("stadsplein", ["stad+s", "plein"], "het", "noun"),
    ("koningsdag", ["koning+s", "dag"], "de", "noun"),
    ("regenjas", ["regen", "jas"], "de", "noun"),
    ("aardbeienjam", ["aardbeien", "jam"], "de", "noun"),
    ("ziekenkamer", ["ziek+en", "kamer"], "de", "noun"),
    ("zorgpremie", ["zorg", "premie"], "de", "noun"),
    ("verkeerslicht", ["verkeer+s", "licht"], "het", "noun"),
    ("waterpark", ["water", "park"], "het", "noun"),
    ("bootenstalling", ["boot+en", "stalling"], "de", "noun"),
    ("Vakantiehuis", ["Vakantie", "huis"], "het", "noun"),  # title case, long enough
    ("tafelstoelkast", ["tafel", "stoel", "kast"], "de", "noun"),
    ("werkkamerdeur", ["werk", "kamer", "deur"], "de", "noun"),
]

# Words that must stay unsplit by the pure splitter (no sensible parts / too short / names).
NOT_SPLIT = [
    "bestemming",  # be+stem+ming: "be"/"ming" are no words
    "gezellig",  # gezel+lig: "lig" is only an inflected verb form, not a head
    "verkoper",  # ver+koper: "ver" unknown
    "huisje",  # short
    "boekje",  # short
    "Amsterdam",  # name
    "huis-deur",  # not alphabetic
    "VAKANTIEHUIS",  # all caps
    "Kastdeur",  # title case needs >= 9 letters
    "",
]


def parts_repr(word: str, d: Dictionary) -> list[str]:
    found = split_compound(word, d._part_readings)
    assert found is not None, word
    return [p.part + (f"+{p.linker}" if p.linker else "") for p in found.parts]


@pytest.mark.parametrize(("word", "parts", "article", "pos"), COMPOUNDS)
def test_split(fixture_dict: Dictionary, word: str, parts: list[str], article: str, pos: str):
    found = split_compound(word, fixture_dict._part_readings)
    assert found is not None
    assert parts_repr(word, fixture_dict) == parts
    assert (found.article, found.pos) == (article, pos)
    assert [p["part"] for p in found.part_glosses] == [p.part for p in found.parts]


@pytest.mark.parametrize("word", NOT_SPLIT)
def test_not_split(fixture_dict: Dictionary, word: str):
    assert split_compound(word, fixture_dict._part_readings) is None


def test_gloss_format(fixture_dict: Dictionary):
    found = split_compound("souvenirwinkel", fixture_dict._part_readings)
    assert found is not None
    assert found.gloss == "souvenir shop (souvenir + winkel)"
    assert found.part_glosses == [
        {"part": "souvenir", "gloss": "souvenir"},
        {"part": "winkel", "gloss": "shop, store"},
    ]
    # inflected plural head is pluralised in English, lemmas in the parenthesis
    plural = split_compound("gemeenteraadsverkiezingen", fixture_dict._part_readings)
    assert plural is not None
    assert plural.gloss == "municipality council elections (gemeente + raad + verkiezing)"


def test_head_article_is_heads(fixture_dict: Dictionary):
    # "werk" (het) as modifier, "deur" (de) as head -> de
    found = split_compound("werkkamerdeur", fixture_dict._part_readings)
    assert found is not None and found.article == "de"
    found = split_compound("vakantiehuis", fixture_dict._part_readings)
    assert found is not None and found.article == "het"


def test_budget_caps_lookups():
    calls: list[str] = []

    def resolve(text: str) -> tuple[PartEntry, ...]:
        calls.append(text)
        return ()

    assert split_compound("a" * 40, resolve, max_lookups=10) is None
    assert len(calls) <= 10
    calls.clear()
    assert split_compound("a" * 40, resolve) is None
    assert len(calls) <= 400


def test_form_of_detection():
    assert is_form_of_gloss("plural of kost")
    assert is_form_of_gloss("inflection of winkelen: first-person singular present indicative")
    assert not is_form_of_gloss("shop, store")


def test_lookup_order(fixture_dict: Dictionary):
    res = fixture_dict.lookup(
        ["huisdeur", "fietsen", "Souvenirwinkel", "souvenirwinkel", "zzzzzzzz"]
    )
    # own entry is never split
    assert res["huisdeur"] == [
        {"pos": "noun", "article": "de", "glosses": ["front door of a house"]}
    ]
    # forms table: plural -> lemma entry (not a compound)
    assert (
        res["fietsen"][0]["glosses"] == ["plural of fiets"] or "compound" not in res["fietsen"][0]
    )
    assert not any(e.get("compound") for e in res["fietsen"])
    # lowercase / case-insensitive, then compound
    assert res["souvenirwinkel"][0]["compound"] is True
    assert res["Souvenirwinkel"][0]["compound"] is True
    assert res["zzzzzzzz"] == []


def test_form_of_only_entry_gets_compound(fixture_dict: Dictionary):
    # "waterpark" only has "plural of waterparken" (missing lemma): compound analysis wins.
    entry = fixture_dict.lookup(["waterpark"])["waterpark"][0]
    assert entry["compound"] is True
    assert entry["glosses"] == ["water park (water + park)"]


def test_gloss_endpoint_compound(fixture_dict: Dictionary, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(app_module, "_dictionary", lambda: fixture_dict)
    body = client.post(
        "/gloss", json={"lang": "nl", "words": ["souvenirwinkel", "boek", "huisdeur"]}
    ).json()
    entry = body["souvenirwinkel"][0]
    assert entry == {
        "pos": "noun",
        "article": "de",
        "glosses": ["souvenir shop (souvenir + winkel)"],
        "compound": True,
        "parts": [
            {"part": "souvenir", "gloss": "souvenir"},
            {"part": "winkel", "gloss": "shop, store"},
        ],
    }
    # backward compatible: regular entries are exactly as before (no new keys)
    assert body["boek"] == [{"pos": "noun", "article": "het", "glosses": ["book"]}]
    assert set(body["huisdeur"][0]) == {"pos", "article", "glosses"}


# --- real database -----------------------------------------------------------------------

REAL_DB = default_db_path()
needs_db = pytest.mark.skipif(not REAL_DB.is_file(), reason="real dictionary DB not built")


@needs_db
@pytest.mark.parametrize(
    ("word", "expected_parts"),
    [
        ("souvenirwinkel", ["souvenir", "winkel"]),
        ("gemeenteraadsverkiezingen", ["gemeenteraad", "verkiezingen"]),
    ],
)
def test_real_db_compounds(word: str, expected_parts: list[str]):
    entry = Dictionary().lookup([word])[word][0]
    assert entry["compound"] is True
    assert [p["part"] for p in entry["parts"]] == expected_parts


@needs_db
@pytest.mark.parametrize(
    "word",
    ["verkoper", "bestemming", "gezellig", "huisdeur", "fiets", "verwacht", "klaagden", "magneten"],
)
def test_real_db_no_false_split(word: str):
    entries = Dictionary().lookup([word])[word]
    assert entries and not any(e.get("compound") for e in entries)


def _coverage(d: Dictionary, tokens: list[str], compounds: bool) -> float:
    if not compounds:
        d.analyze_compound = lambda _w: None  # type: ignore[method-assign]
    res = d.lookup(tokens)
    return sum(1 for t in tokens if res[t]) / len(tokens)


@needs_db
def test_real_db_coverage_on_news_text(capsys: pytest.CaptureFixture[str]):
    text = (FIXTURES / "dutch-news.txt").read_text(encoding="utf-8")
    tokens = re.findall(r"[^\W\d_]+", text)
    uniq = list(dict.fromkeys(tokens))
    before = _coverage(Dictionary(), uniq, compounds=False)
    after = _coverage(Dictionary(), uniq, compounds=True)
    with capsys.disabled():
        print(f"\ncoverage unique tokens: before={before:.3f} after={after:.3f} (n={len(uniq)})")
    assert after >= before
    assert after >= 0.95
