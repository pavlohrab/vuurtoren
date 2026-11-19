"""Derivations (base + affix) with a hand-made dictionary, and the English word-formation rules."""

from __future__ import annotations

import pytest

from kenning_nlp import english as en
from kenning_nlp.compound import PartEntry, split_compound
from kenning_nlp.derive import derive, dutch_stems, english_of


def _e(lemma: str, pos: str, *glosses: str, inflected: bool = False) -> PartEntry:
    return PartEntry(lemma, pos, "de" if pos == "noun" else None, glosses, inflected=inflected)


LEMMAS = [
    _e("woord", "noun", "word"),
    _e("loo", "noun", "a wood, a grove"),
    _e("werken", "verb", "to work", "to function"),
    _e("eerlijk", "adj", "honest", "fair, just"),
    _e("slaap", "noun", "sleep"),
    _e("schrijven", "verb", "to write"),
    _e("beschermen", "verb", "to protect"),
    _e("verdedigen", "verb", "to defend"),
    _e("taal", "noun", "language"),
    _e("hand", "noun", "hand"),
    _e("handig", "adj", "handy"),
    _e("naaien", "verb", "to sew"),
    _e("halen", "verb", "to fetch"),
    _e("hal", "noun", "hall"),
    _e("lezen", "verb", "to read"),
    _e("boeken", "verb", "to book"),
    _e("leugenaar", "noun", "liar"),
    _e("pit", "noun", "a seed inside a fruit", "wick"),
    _e("ei", "noun", "egg"),
    _e("symfonie", "noun", "symphony"),
    _e("idioom", "noun", "idiom"),
    _e("origineel", "adj", "original"),
    _e("eigenaar", "noun", "owner"),
    _e("spin", "noun", "spider"),
]
FORMS = {
    "loos": [_e("loo", "noun", "a wood, a grove", inflected=True)],
    "beschermd": [_e("beschermen", "verb", "to protect", inflected=True)],
    "schreef": [_e("schrijven", "verb", "to write", inflected=True)],
}


def resolve(text: str) -> tuple[PartEntry, ...]:
    return tuple(e for e in LEMMAS if e.lemma == text) + tuple(FORMS.get(text, ()))


@pytest.mark.parametrize(
    ("word", "gloss", "formed", "pos"),
    [
        ("woordeloos", "wordless", "woord + -loos", "adj"),  # linking -e-
        ("slapeloos", "sleepless", "slaap + -loos", "adj"),  # slap-e-loos: slaap
        ("pitloos", "seedless", "pit + -loos", "adj"),
        ("werkbaar", "workable", "werken + -baar", "adj"),
        ("leesbaar", "readable", "lezen + -baar", "adj"),  # lees: lezen
        ("eerlijkheid", "honestness", "eerlijk + -heid", "noun"),
        ("onverdedigbaar", "undefendable", "on- + verdedigen + -baar", "adj"),
        ("werkbaarheid", "workableness", "werken + -baar + -heid", "noun"),
        ("herschrijven", "rewrite", "her- + schrijven", "verb"),
        ("onbeschermd", "unprotected", "on- + beschermen", "adj"),
        ("drietalig", "three-languaged", "drie + taal + -ig", "adj"),
        ("naaister", "female sewer", "naaien + -ster", "noun"),
        ("leugenaarster", "female liar", "leugenaar + -ster", "noun"),
        ("boeking", "booking", "boeken + -ing", "noun"),
        ("lezer", "reader", "lezen + -er", "noun"),
        ("eiig", "eggy", "ei + -ig", "adj"),
        ("symfonisch", "symphonic", "symfonie + -isch", "adj"),
        ("idiomatisch", "idiomatic", "idioom + -isch", "adj"),
        ("originaliteit", "originality", "origineel + -iteit", "noun"),
        ("eigenaarschap", "ownership", "eigenaar + -schap", "noun"),
        ("spinachtig", "spider-like", "spin + -achtig", "adj"),
    ],
)
def test_derive(word: str, gloss: str, formed: str, pos: str) -> None:
    found = derive(word, resolve)
    assert found is not None, word
    assert (found.gloss, found.formed, found.pos) == (gloss, formed, pos)


def test_derived_nouns_take_their_article() -> None:
    heid = derive("eerlijkheid", resolve)
    schap = derive("eigenaarschap", resolve)
    assert heid is not None and heid.article == "de"
    assert schap is not None and schap.article == "het"


@pytest.mark.parametrize(
    "word",
    [
        "halster",  # hal is no agent noun; halen has the stem haal
        "onschrijven",  # on- + an infinitive is no word
        "woord",  # no affix
        "WOORDELOOS",  # all caps
    ],
)
def test_no_derivation(word: str) -> None:
    assert derive(word, resolve) is None


def test_number_noun_ig_reads_as_having() -> None:
    found = derive("tweehandig", resolve)
    assert found is not None and found.having
    assert found.gloss == "two-handed"


def test_suffix_is_never_a_compound_head() -> None:
    # "loos" is a form of "loo", but woordeloos is no compound of woord + loos
    assert split_compound("woordeloos", resolve) is None


@pytest.mark.parametrize(
    ("infinitive", "stems"),
    [
        ("halen", {"haal"}),
        ("stappen", {"stap"}),
        ("lezen", {"les", "lees"}),
        ("werken", {"werk"}),
        ("naaien", {"naai"}),
        ("doen", {"doe"}),
        ("beschrijven", {"beschrijf"}),
        ("verdedigen", {"verdedig"}),
    ],
)
def test_dutch_stems(infinitive: str, stems: set[str]) -> None:
    assert dutch_stems(infinitive) == stems


def test_english_of_prefers_one_word() -> None:
    assert english_of(_e("pit", "noun", "a seed inside a fruit")) == "seed"
    assert english_of(_e("gevoelloos", "adj", "without feeling; numb")) == "numb"
    assert english_of(_e("werken", "verb", "to work, to function")) == "work"
    assert english_of(_e("x", "noun", "plural of y")) is None


@pytest.mark.parametrize(
    ("fn", "word", "out"),
    [
        (en.able, "use", "usable"),
        (en.able, "change", "changeable"),
        (en.able, "rely", "reliable"),
        (en.ness, "happy", "happiness"),
        (en.ness, "dry", "dryness"),
        (en.less, "penny", "penniless"),
        (en.ing, "stop", "stopping"),
        (en.ing, "dig up", "digging up"),
        (en.agent, "translate", "translator"),
        (en.agent, "bake", "baker"),
        (en.participle, "write", "written"),
        (en.participle, "protect", "protected"),
        (en.y, "flake", "flaky"),
        (en.y, "powder", "powdery"),
        (en.ity, "nervous", "nervosity"),
        (en.ic, "drama", "dramatic"),
        (en.ic, "claustrophobia", "claustrophobic"),
        (en.ly, "simple", "simply"),
        (en.having, "lip", "lipped"),
    ],
)
def test_english(fn, word: str, out: str) -> None:  # type: ignore[no-untyped-def]
    assert fn(word) == out


def test_prefixed() -> None:
    assert en.prefixed("re", "elect") == "re-elect"
    assert en.prefixed("un", "necessary") == "unnecessary"
