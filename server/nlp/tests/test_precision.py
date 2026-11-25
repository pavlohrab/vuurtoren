"""Precision of the PRIMARY lemma (the recall side lives in test_nl_pipeline.py).

Each row: sentence, target token (exact surface), expected primary lemma. Rows marked
``db`` need the Kaikki dictionary DB (git-ignored, absent in CI) and are skipped without it.
"""

from __future__ import annotations

import pytest

from vuurtoren_nlp.lexicon import get_lexicon
from vuurtoren_nlp.pipeline import analyze_texts

db = pytest.mark.skipif(not get_lexicon().available, reason="Kaikki dictionary DB not built")

PRECISION: list = [
    # infinitives after a modal / gaan / te
    ("Ik wil je bellen.", "bellen", "bellen"),
    ("Ze gaan fietsen.", "fietsen", "fietsen"),
    ("Ik ga zitten.", "zitten", "zitten"),
    ("Hij kan goed zwemmen.", "zwemmen", "zwemmen"),
    ("Wij moeten morgen werken.", "werken", "werken"),
    # plural present = infinitive form
    ("Wij lopen samen.", "lopen", "lopen"),
    ("Zij werken in een fabriek.", "werken", "werken"),
    # singular nouns that simplemma mangles / that must stay put
    ("De kat slaapt.", "kat", "kat"),
    ("Ik zie de boot.", "boot", "boot"),
    ("De hond blaft.", "hond", "hond"),
    ("Het boek ligt op tafel.", "boek", "boek"),
    ("De stad is groot.", "stad", "stad"),
    # plural nouns
    ("De katten slapen.", "katten", "kat"),
    ("Er liggen boeken op tafel.", "boeken", "boek"),
    ("De boten varen snel.", "boten", "boot"),
    # participles
    ("Ik heb het boek gelezen.", "gelezen", "lezen"),
    ("Zij heeft gisteren gewerkt.", "gewerkt", "werken"),
    ("Hij is naar huis gegaan.", "gegaan", "gaan"),
    ("De deur is gesloten.", "gesloten", "sluiten"),
    ("De bomen worden gekapt.", "gekapt", "kappen"),
    # past tenses
    ("Ik liep naar huis.", "liep", "lopen"),
    ("Zij ontdekten het geheim.", "ontdekten", "ontdekken"),
    ("Hij zag de man.", "zag", "zien"),
    ("Wij aten brood.", "aten", "eten"),
    # finite singular (spaCy often leaves these unchanged or half-changed)
    ("Hij werkt hard.", "werkt", "werken"),
    ("Ik werk hier.", "werk", "werken"),
    ("Zij slaapt vroeg.", "slaapt", "slapen"),
    ("Het kind speelt met de bal.", "speelt", "spelen"),
    ("Hij regeert pas een paar maanden.", "regeert", "regeren"),
    # separable vs inseparable
    ("Dat kan voorkomen.", "voorkomen", "voorkomen"),
    ("Hij komt in het boek voor.", "komt", "voorkomen"),
    ("Dit overkomt mij vaak.", "overkomt", "overkomen"),
    ("Wat is hem overkomen?", "overkomen", "overkomen"),
    ("Zij ondernemen veel.", "ondernemen", "ondernemen"),
    ("Hij onderneemt een poging.", "onderneemt", "ondernemen"),
    ("Ik bel je morgen op.", "bel", "opbellen"),
    ("Zij kwam gisteren aan.", "kwam", "aankomen"),
    ("Hij heeft haar opgebeld.", "opgebeld", "opbellen"),
    ("We proberen het apparaat in te stellen.", "stellen", "instellen"),
    # fused particle in a subordinate clause
    ("Ik hoop dat hij morgen opbelt.", "opbelt", "opbellen"),
    # imperatives
    ("Kom hier!", "Kom", "komen"),
    ("Wacht even.", "Wacht", "wachten"),
    pytest.param("Bel me morgen!", "Bel", "bellen", marks=db),
    # reflexives
    ("Ik vergis me.", "vergis", "vergissen"),
    ("Zij wast zich.", "wast", "wassen"),
    ("Hij voelt zich goed.", "voelt", "voelen"),
    # diminutives: primary is the base noun (spaCy's lemma); the diminutive is an alternative
    ("Het huisje is klein.", "huisje", "huis"),
    ("Het kindje slaapt.", "kindje", "kind"),
    # capitalised sentence starts
    pytest.param("Katten zijn lief.", "Katten", "kat", marks=db),
    ("Boten varen snel.", "Boten", "boot"),
    ("Lopen is gezond.", "Lopen", "lopen"),
    # abbreviations keep spaCy's expansion
    ("Ik koop bijv. brood.", "bijv.", "bijvoorbeeld"),
    # adjective inflection / degree
    ("De grotere huizen zijn duur.", "grotere", "groot"),
    ("De grotere huizen zijn duur.", "huizen", "huis"),
    ("Dit is het mooiste huis.", "mooiste", "mooi"),
    # R-pronoun constructions: stranded preposition, plain verb lemma
    ("Waar wacht je op?", "wacht", "wachten"),
    ("Daar staat hij bij.", "staat", "staan"),
    ("Ik denk er niet aan.", "denk", "denken"),
    # noun particle the parser leaves as an object
    ("Hij nam deel aan de wedstrijd.", "nam", "deelnemen"),
    # a particle joins only into a verb the dictionary has: no "wegmoeten"
    pytest.param("Dat moet weg.", "moet", "moeten", marks=db),
    pytest.param("Na een tijdje doet ze haar mond open.", "doet", "opendoen", marks=db),
    ("Hij doet zijn werk.", "doet", "doen"),
    pytest.param("De soldaten lachten mee.", "lachten", "meelachen", marks=db),
    pytest.param("Ik blijf drie jaar weg.", "blijf", "wegblijven", marks=db),
    pytest.param("Wil je met me mee?", "Wil", "meewillen", marks=db),  # OpenTaal has it
    pytest.param("Maria ging na een tijd naar hem toe.", "ging", "gaan", marks=db),
    pytest.param("Het water stroomde het land in.", "stroomde", "instromen", marks=db),
    pytest.param("Hij keek om zich heen.", "keek", "kijken", marks=db),
    pytest.param("Toen liep hij weg, tussen de oranje mensen door.", "liep", "weglopen", marks=db),
    pytest.param("Eerst deed zijn vinger pijn.", "deed", "doen", marks=db),
    pytest.param("Schippers gebruikten hem om hun weg te vinden.", "vinden", "vinden", marks=db),
    pytest.param(
        "Zijn moeder helpt hem met zijn broek uit en zijn pyjama aan.", "helpt", "helpen", marks=db
    ),
]


@db
def test_no_partner_without_a_dictionary_verb() -> None:
    # "weg" stays its own word: no split verb, so nothing lights up as its partner
    assert all(t.particle_of is None for t in analyse("Dat moet weg."))
    toks = analyse("Na een tijdje doet ze haar mond open.")
    doet = next(t for t in toks if t.text == "doet")
    assert next(t for t in toks if t.text == "open").particle_of == doet.i


def analyse(sentence: str):
    (a,) = analyze_texts("nl", [sentence])
    return a.tokens


def token(sentence: str, surface: str):
    return next(t for t in analyse(sentence) if t.text == surface)


def test_precision_set_is_large_enough() -> None:
    assert len(PRECISION) >= 40


@pytest.mark.parametrize(("sentence", "surface", "expected"), PRECISION)
def test_primary_lemma(sentence: str, surface: str, expected: str) -> None:
    assert token(sentence, surface).lemma == expected


@pytest.mark.parametrize(
    ("sentence", "surface", "bad_prefix"),
    [
        ("Waar wacht je op?", "wacht", "op"),
        ("Daar staat hij bij.", "staat", "bij"),
        ("Ik denk er niet aan.", "denk", "aan"),
        ("Waar ben je bang voor?", "ben", "voor"),
        ("Wij lopen naar het huis.", "lopen", "naar"),
    ],
)
def test_stranded_preposition_is_not_a_particle(
    sentence: str, surface: str, bad_prefix: str
) -> None:
    t = token(sentence, surface)
    assert not any(c.startswith(bad_prefix) for c in [t.lemma, *t.alt_lemmas])
    assert all(x.particle_of is None for x in analyse(sentence))


def test_genuine_particle_still_found_with_locative_daar() -> None:
    # no R-pronoun before the particle: still a separable verb
    t = token("Hij komt morgen aan.", "komt")
    assert t.lemma == "aankomen"


def test_diminutive_alternative() -> None:
    t = token("Het huisje is klein.", "huisje")
    assert t.lemma == "huis" and "huisje" in t.alt_lemmas


def test_deelnemen_marks_deel_as_particle() -> None:
    toks = analyse("Hij nam deel aan de wedstrijd.")
    verb = next(t for t in toks if t.text == "nam")
    deel = next(t for t in toks if t.text == "deel")
    assert verb.lemma == "deelnemen"
    assert deel.particle_of == verb.i


def test_alternatives_are_lowercase_clean_and_unique() -> None:
    for sentence in [
        "Bel me morgen op!",
        "Hij belde gisteren op en duurde lang.",
        "Daarmee heeft hij het probleem opgelost.",
        "De problemen bleven bijstaan.",
    ]:
        for t in analyse(sentence):
            alts = t.alt_lemmas
            assert all(a == a.lower() for a in alts), (t.text, alts)
            assert len(alts) == len({a.lower() for a in alts}), (t.text, alts)
            assert t.lemma.lower() not in alts, (t.text, alts)
            assert not {"daarm", "probleme", "duurd", "bijstaat", "opbel"} & set(alts), (
                t.text,
                alts,
            )
