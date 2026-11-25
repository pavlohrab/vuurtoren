import pytest

from vuurtoren_nlp.nl import join_particle, strip_unattested_particle
from vuurtoren_nlp.pipeline import analyze_terms, analyze_texts, split_term


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
    ("raw", "alts", "reflexive"),
    [
        ("fietsen (fietste, gefietst)", ["fietsen"], False),
        ("de fiets, de fietsen", ["de fiets", "de fietsen"], False),
        ("zij, ze", ["zij", "ze"], False),
        ("richten (zich)", ["richten"], True),
        ("huis [n]", ["huis"], False),
        ("zo\u2019n", ["zo'n"], False),
        ("lopen - to walk", ["lopen"], False),
    ],
)
def test_split_term(raw: str, alts: list[str], reflexive: bool) -> None:
    assert split_term(raw) == (alts, reflexive)


def test_analyze_terms_keeps_citation_forms() -> None:
    raws = [
        "de fiets",
        "het huis",
        "zich vergissen",
        "richten (zich)",
        "zij, ze",
        "vragen",
        "geleden",
        "staat",
        "opgebeld",
        "te koop",
        "",
    ]
    res = {r.input: r for r in analyze_terms("nl", raws)}
    assert res["de fiets"].key == "fiets" and res["de fiets"].article == "de"
    assert res["het huis"].article == "het"
    assert res["zich vergissen"].key == "vergissen" and res["zich vergissen"].reflexive
    assert res["richten (zich)"].key == "richten" and res["richten (zich)"].reflexive
    assert res["zij, ze"].key == "zij" and res["zij, ze"].aliases == ["ze"]
    # headwords are not re-lemmatised out of context
    assert res["vragen"].key == "vragen"
    assert res["geleden"].key == "geleden"
    assert res["staat"].key == "staat"
    assert res["opgebeld"].key == "opgebeld" and res["opgebeld"].lemma == "opbellen"
    assert res["te koop"].multiword
    assert res[""].key == ""


@pytest.mark.parametrize(
    ("sentence", "surface", "lemma"),
    [
        ("Onze woorden hadden andere betekenissen gekregen.", "betekenissen", "betekenis"),
        ("Wij ontdekten dat het dak lekte.", "ontdekten", "ontdekken"),
        ("Ze sneed dikke sneden brood.", "sneed", "snijden"),
        ("De kapper heeft mijn haar geknipt.", "geknipt", "knippen"),
        ("Hij regeert pas een paar maanden.", "regeert", "regeren"),
        ("Het huis staat in Amsterdam.", "staat", "staan"),
    ],
)
def test_lemma_repair(sentence: str, surface: str, lemma: str) -> None:
    assert lemmas(sentence)[surface] == lemma


def test_fused_particle_not_doubled() -> None:
    lem = lemmas("Het huis werd van de grond af opgebouwd.")
    assert lem["opgebouwd"] == "opbouwen"


def test_particle_join_keeps_bare_verb_as_alternative() -> None:
    (a,) = analyze_texts("nl", ["Ik trof mijn vader in de keuken aan."])
    verb = next(t for t in a.tokens if t.text == "trof")
    assert verb.lemma == "aantreffen"
    assert "treffen" in verb.alt_lemmas


def test_blanks_are_not_words() -> None:
    (a,) = analyze_texts("nl", ["Waar kom jij ____ ?"])
    blank = next(t for t in a.tokens if "_" in t.text)
    assert not blank.is_word
    assert next(t for t in a.tokens if t.text == "kom").lemma == "komen"


def test_ellipsis_gap_marker() -> None:
    (r,) = analyze_terms("nl", ["door ... gaan"])
    assert r.key == "door gaan" and r.multiword


def alts_of(sentence: str, surface: str) -> set[str]:
    (a,) = analyze_texts("nl", [sentence])
    t = next(t for t in a.tokens if t.text == surface)
    return {t.lemma, *t.alt_lemmas}


@pytest.mark.parametrize(
    ("sentence", "surface", "expected"),
    [
        ("Op bepaalde momenten weet je het niet.", "bepaalde", "bepaald"),
        ("Hij is een knappe man.", "knappe", "knap"),
        ("De volgende avond was ik daar.", "volgende", "volgend"),
        ("Van alle kanten kwamen buren aangelopen.", "aangelopen", "aanlopen"),
        ("Een prestatie die alom respect afdwong.", "afdwong", "afdwingen"),
        ("Hij begon het apparaat in te stellen.", "stellen", "instellen"),
        ("Trek een warme trui aan.", "Trek", "aantrekken"),
        ("De tabel geeft de groei van de economie weer.", "geeft", "weergeven"),
        ("Ze vragen zich af wat er zal volgen.", "vragen", "afvragen"),
        ("Katten zijn ook goed om muizen te vangen.", "Katten", "kat"),
        ("Mijn agenda is deze week vol.", "vol", "vol"),
    ],
)
def test_matcher_candidates(sentence: str, surface: str, expected: str) -> None:
    assert expected in alts_of(sentence, surface)


def test_preposition_is_not_a_particle() -> None:
    # "naar" introduces a noun phrase; no "naarlopen" candidate
    assert not any(c.startswith("naar") for c in alts_of("Wij lopen naar het huis.", "lopen"))


def test_both_genders_headword() -> None:
    (r,) = analyze_terms("nl", ["het of de cement"])
    assert r.key == "cement"


def test_unlisted_words_are_marked():
    """Another alphabet or digits in a word, or a word nothing Dutch knows: unlisted (the app
    leaves it out of the new words, like a name)."""
    from vuurtoren_nlp.pipeline import analyze_texts

    a = analyze_texts("nl", ["Het woord λόγος en de 3e keer, en het huis."])[0]
    flags = {t.text: t.unlisted for t in a.tokens if t.is_word}
    assert flags["λόγος"] and flags["3e"]
    assert not flags["huis"] and not flags["woord"]


def test_a_known_particle_with_a_phrase_after_it():
    """A common separable verb's adverb particle is its particle, also with a phrase after it;
    a rare reading ("samenlopen" for "lopen samen") is not."""
    from vuurtoren_nlp.pipeline import analyze_texts

    [a] = analyze_texts("nl", ["Elsje ging mee naar Gorinchem."])
    words = {t.text: t for t in a.tokens}
    assert words["mee"].particle_of == words["ging"].i
    assert words["ging"].lemma == "meegaan"
    [b] = analyze_texts("nl", ["Wij lopen samen naar huis."])
    words = {t.text: t for t in b.tokens}
    assert words["samen"].particle_of is None
