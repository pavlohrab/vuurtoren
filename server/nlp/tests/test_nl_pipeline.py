import pytest

from kenning_nlp.nl import join_particle, strip_unattested_particle
from kenning_nlp.pipeline import analyze_terms, analyze_texts, clean_term


def lemmas(text: str) -> dict[str, str]:
    (a,) = analyze_texts("nl", [text])
    return {t.text: t.lemma for t in a.tokens}


@pytest.mark.parametrize(
    ("lemma", "surface", "expected"),
    [
        ("terugbellen", "bel", "bellen"),
        ("opbellen", "opgebeld", "opbellen"),
        ("lopen", "liep", "lopen"),
    ],
)
def test_strip_unattested_particle(lemma: str, surface: str, expected: str) -> None:
    assert strip_unattested_particle(lemma, surface) == expected


def test_join_particle() -> None:
    assert join_particle("op", "bellen") == "opbellen"
    assert join_particle("op", "opbellen") == "opbellen"


def test_separable_verb_present() -> None:
    (a,) = analyze_texts("nl", ["Ik bel je morgen op."])
    verb = next(t for t in a.tokens if t.text == "bel")
    particle = next(t for t in a.tokens if t.text == "op")
    assert verb.lemma == "opbellen"
    assert particle.particle_of == verb.i


def test_separable_verb_past() -> None:
    assert lemmas("Zij kwam gisteren aan in Amsterdam.")["kwam"] == "aankomen"


def test_perfect_and_plural() -> None:
    lem = lemmas("De kinderen hebben het boek gelezen.")
    assert lem["gelezen"] == "lezen"
    assert lem["kinderen"] == "kind"


def test_token_flags_and_spans() -> None:
    text = "Jan kocht 3 appels."
    (a,) = analyze_texts("nl", [text])
    by = {t.text: t for t in a.tokens}
    assert by["Jan"].is_propn
    assert by["3"].is_num and not by["3"].is_word
    assert not by["."].is_word
    assert all(text[t.start : t.end] == t.text for t in a.tokens)


def test_sentence_ids() -> None:
    (a,) = analyze_texts("nl", ["Ik lees. Jij schrijft."])
    assert {t.sent for t in a.tokens} == {0, 1}


@pytest.mark.parametrize(
    ("raw", "cleaned"),
    [
        ("fietsen (fietste, gefietst)", "fietsen"),
        ("de fiets, de fietsen", "de fiets"),
        ("lopen / wandelen", "lopen"),
        ("huis [n]", "huis"),
    ],
)
def test_clean_term(raw: str, cleaned: str) -> None:
    assert clean_term(raw) == cleaned


def test_analyze_terms() -> None:
    res = {
        r.input: r
        for r in analyze_terms(
            "nl", ["de fiets", "het huis", "zich vergissen", "kinderen", "opgebeld", "te koop", ""]
        )
    }
    assert res["de fiets"].key == "fiets" and res["de fiets"].article == "de"
    assert res["het huis"].article == "het"
    assert res["zich vergissen"].key == "vergissen" and res["zich vergissen"].reflexive
    assert res["kinderen"].key == "kind"
    assert res["opgebeld"].key == "opbellen"
    assert res["te koop"].multiword
    assert res[""].key == ""
