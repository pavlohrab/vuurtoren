"""UTF-16 offsets, request size limits, key normalisation, term splitting, CORS, particles."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp.app import app, parse_origins
from vuurtoren_nlp.errors import ServiceError
from vuurtoren_nlp.models import (
    DETECT_SAMPLE_CHARS,
    MAX_TERM_CHARS,
    MAX_TEXT_CHARS,
    MAX_TOTAL_CHARS,
)
from vuurtoren_nlp.nl import join_particle, strip_unattested_particle
from vuurtoren_nlp.pipeline import analyze_terms, analyze_texts, normalize_key, split_term

client = TestClient(app)


def utf16_slice(text: str, start: int, end: int) -> str:
    """What JavaScript's ``text.slice(start, end)`` returns (UTF-16 code units)."""
    units = text.encode("utf-16-le")
    return units[2 * start : 2 * end].decode("utf-16-le")


# ------------------------------------------------------------------ UTF-16 offsets


@pytest.mark.parametrize(
    "text",
    [
        "Ik \U0001f600 bel je op.",  # emoji (astral)
        "Wij eten \U00020bb7 en \U0001f600\U0001f600 samen.",  # non-BMP CJK + two emoji
        "Gewoon een zin met é en ß.",  # BMP only: fast path
        "Plain ascii text.",
    ],
)
def test_offsets_are_utf16_code_units(text: str) -> None:
    (a,) = analyze_texts("nl", [text])
    assert a.tokens
    for t in a.tokens:
        assert utf16_slice(text, t.start, t.end) == t.text


def test_offsets_shift_after_astral_characters() -> None:
    text = "Ik \U0001f600 bel je op."
    (a,) = analyze_texts("nl", [text])
    bel = next(t for t in a.tokens if t.text == "bel")
    # code-point offset would be 5; the emoji takes two UTF-16 units -> 6
    assert (bel.start, bel.end) == (6, 9)
    assert text[5:8] == "bel"  # the Python offsets differ, proving the conversion happened


# ------------------------------------------------------------------ size limits


def test_text_item_over_limit_is_rejected() -> None:
    r = client.post("/analyze/text", json={"lang": "nl", "texts": ["a" * (MAX_TEXT_CHARS + 1)]})
    assert r.status_code == 422


def test_term_item_over_limit_is_rejected() -> None:
    r = client.post("/analyze/terms", json={"lang": "nl", "texts": ["a" * (MAX_TERM_CHARS + 1)]})
    assert r.status_code == 422
    ok = client.post("/analyze/terms", json={"lang": "nl", "texts": ["a" * MAX_TERM_CHARS]})
    assert ok.status_code == 200


def test_total_payload_over_limit_is_413() -> None:
    n = MAX_TOTAL_CHARS // MAX_TEXT_CHARS + 1
    r = client.post("/analyze/text", json={"lang": "nl", "texts": ["a" * MAX_TEXT_CHARS] * n})
    assert r.status_code == 413
    assert "too large" in r.json()["detail"].lower()


def test_total_payload_cap_applies_to_detect() -> None:
    chunk = "a" * 100_000
    r = client.post("/detect", json={"texts": [chunk] * (MAX_TOTAL_CHARS // len(chunk) + 1)})
    assert r.status_code == 413


def test_spacy_max_length_maps_to_413() -> None:
    with pytest.raises(ServiceError) as exc:
        analyze_texts("nl", ["a " * MAX_TEXT_CHARS])  # 2x the limit, bypassing the API model
    assert exc.value.status_code == 413
    assert "too long" in exc.value.detail.lower()


def test_detect_truncates_instead_of_rejecting() -> None:
    english = "the house is big and the garden is nice " * 20
    assert len(english) > DETECT_SAMPLE_CHARS
    dutch_tail = " het is hier erg gezellig en we hebben veel plezier " * 2000
    r = client.post("/detect", json={"texts": [english + dutch_tail]})
    assert r.status_code == 200
    assert r.json()[0]["lang"] == "en"  # only the first 400 chars are examined


# ------------------------------------------------------------------ key normalisation


@pytest.mark.parametrize(
    ("raw", "key"),
    [
        ("Straße", "straße"),  # lower(), not casefold(): ß stays
        ("ﬁets", "fiets"),  # fi ligature -> fiets (NFKC)
        ("zo’n", "zo'n"),
        ("ZO‘N", "zo'n"),
        ("zo`n", "zo'n"),
        ("  Fiets  ", "fiets"),
        ("Ｆiets", "fiets"),  # full-width F (NFKC)
    ],
)
def test_normalize_key(raw: str, key: str) -> None:
    assert normalize_key(raw) == key


def test_terms_use_the_shared_key_rule() -> None:
    res = {r.input: r for r in analyze_terms("nl", ["Straße", "ﬁets", "zo’n", "zij, Zo’n"])}
    assert res["Straße"].key == "straße"
    assert res["ﬁets"].key == "fiets"
    assert res["zo’n"].key == "zo'n"
    assert res["zij, Zo’n"].aliases == ["zo'n"]


# ------------------------------------------------------------------ term splitting


def test_possessive_zn_is_not_reflexive() -> None:
    (r,) = analyze_terms("nl", ["z'n best doen"])
    assert r.key == "z'n best doen" and r.multiword and not r.reflexive


def test_zich_is_still_reflexive() -> None:
    (r,) = analyze_terms("nl", ["zich vergissen"])
    assert r.key == "vergissen" and r.reflexive


def test_fixed_expression_keeps_article() -> None:
    (r,) = analyze_terms("nl", ["de facto"])
    assert r.key == "de facto" and r.article is None


def test_article_still_stripped_from_nouns() -> None:
    res = analyze_terms("nl", ["de fiets", "het feit", "een huis"])
    assert [(r.key, r.article) for r in res] == [("fiets", "de"), ("feit", "het"), ("huis", None)]


@pytest.mark.parametrize(
    ("raw", "alts"),
    [
        ("en/of", ["en/of"]),
        ("1/2", ["1/2"]),
        ("zij/ze", ["zij", "ze"]),
        ("hij/zij", ["hij", "zij"]),
        ("zij / ze", ["zij", "ze"]),
        ("de fiets/de fietsen", ["de fiets", "de fietsen"]),
    ],
)
def test_split_term_slashes(raw: str, alts: list[str]) -> None:
    assert split_term(raw)[0] == alts


def test_en_of_key() -> None:
    (r,) = analyze_terms("nl", ["en/of"])
    assert r.key == "en/of" and r.aliases == []


# ------------------------------------------------------------------ particle substring bugs


@pytest.mark.parametrize(
    ("lemma", "surface", "expected"),
    [
        ("oplopen", "loopt", "lopen"),  # "loopt" merely contains "op"
        ("aanlopen", "klaplopen", "lopen"),
        ("opbellen", "opgebeld", "opbellen"),  # participle starts with the particle
        ("opbellen", "gebeld", "bellen"),
        ("aankomen", "aangekomen", "aankomen"),
    ],
)
def test_strip_unattested_particle_uses_prefix(lemma: str, surface: str, expected: str) -> None:
    assert strip_unattested_particle(lemma, surface) == expected


def test_join_particle_prefix_only() -> None:
    # base already carries "op" and the surface STARTS with it: not joined again
    assert join_particle("af", "opbouwen", "opgebouwd") == "opbouwen"
    # surface merely contains "op" ("loopt"): the detached particle is joined
    assert join_particle("op", "lopen", "loopt") == "oplopen"
    # base "opbellen" but surface "bel" has no visible particle: join -> same word via startswith
    assert join_particle("op", "bellen", "bel") == "opbellen"
    assert join_particle("Op", "Bellen") == "opbellen"


# ------------------------------------------------------------------ CORS


def test_parse_origins_strips_and_drops_empty() -> None:
    assert parse_origins(" http://a.test , ,http://b.test,") == ["http://a.test", "http://b.test"]
    assert parse_origins("") == []
