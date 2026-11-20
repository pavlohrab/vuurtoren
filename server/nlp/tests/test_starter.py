"""The starter word list rules (vuurtoren_nlp.starter) on a tiny fixture."""

import json
from collections import Counter
from pathlib import Path

import pytest

from vuurtoren_nlp.starter import (
    Entry,
    Lemma,
    Sentence,
    drop_reason,
    form_of_target,
    gloss_for,
    gloss_head,
    inflection_target,
    meaning_senses,
    merge_forms,
    pick_sentence,
    short_gloss,
)

READING = Path(__file__).resolve().parents[3] / "packages" / "core" / "src" / "reading"
CASES = json.loads((READING / "fixtures" / "gloss-cases.json").read_text())
PARTICLES = json.loads((READING / "particle-glosses.json").read_text())


# ---- the same cases as packages/core/src/reading/gloss.test.ts ----


@pytest.mark.parametrize(("sense", "want"), CASES["glossHead"])
def test_gloss_head_matches_typescript(sense: str, want: str) -> None:
    assert gloss_head(sense) == want


@pytest.mark.parametrize(("senses", "max_n", "want"), CASES["shortGloss"])
def test_short_gloss_matches_typescript(senses: list[str], max_n: int, want: str) -> None:
    assert short_gloss(senses, max_n) == want


@pytest.mark.parametrize(("sense", "want"), CASES["formOfTarget"])
def test_form_of_target_matches_typescript(sense: str, want: str | None) -> None:
    assert form_of_target(sense) == want


def test_meaning_senses_drop_form_of() -> None:
    assert meaning_senses(["alternative form of heel", "whole, entire"]) == ["whole, entire"]


# ---- gloss choice (liveDictionary.ts) ----

DICT = {
    "ze": [Entry("pron", None, ("unstressed form of zij (“she”)", "unstressed form of zij"))],
    "zij": [Entry("pron", None, ("she; third-person singular feminine subject",))],
    "huis": [
        Entry("noun", "het", ("a house, home; residence",)),
        Entry("verb", None, ("inflection of huizen: first-person singular present",)),
    ],
    "zijn": [
        Entry("verb", None, ("to be, to exist",)),
        Entry("det", None, ("his; third-person singular masculine possessive",)),
    ],
    "wel": [Entry("adv", None, ("modal particle expressing reassurance",))],
    "lopen": [Entry("verb", None, ("inflection of lopen: plural", "to walk"))],
}


def test_gloss_follows_the_reader() -> None:
    assert gloss_for("ze", "PRON", DICT, PARTICLES) == "she"  # form-of resolved
    assert gloss_for("huis", "NOUN", DICT, PARTICLES) == "a house, home"
    assert gloss_for("zijn", "DET", DICT, PARTICLES) == "his"  # sense of its part of speech first
    assert gloss_for("zijn", "VERB", DICT, PARTICLES) == "to be, to exist"
    assert gloss_for("wel", "ADV", DICT, PARTICLES) == PARTICLES["wel"]
    assert gloss_for("lopen", "VERB", DICT, PARTICLES) == "to walk"  # "inflection of" skipped
    assert gloss_for("onbekend", "NOUN", DICT, PARTICLES) == ""


def test_particle_glosses_are_shared() -> None:
    assert PARTICLES["zullen"] == "will, shall"


# ---- ranking ----


def test_forms_merge_into_lemmas_by_their_readings() -> None:
    forms = [("is", 100.0), ("was", 50.0), ("huis", 10.0), ("huizen", 4.0)]
    readings = {
        "is": Counter({("zijn", "AUX"): 9}),
        "was": Counter({("zijn", "AUX"): 4, ("wassen", "VERB"): 1}),
        "huis": Counter({("huis", "NOUN"): 3}),
        "huizen": Counter({("huis", "NOUN"): 2}),
    }
    ranked = merge_forms(forms, readings)
    assert [x.lemma for x in ranked] == ["zijn", "huis", "wassen"]
    assert ranked[0].freq == pytest.approx(140.0)
    assert ranked[1].freq == pytest.approx(14.0)
    assert ranked[2].freq == pytest.approx(10.0)
    assert ranked[0].main_pos() == "AUX"


def test_inflection_only_words_become_their_lemma() -> None:
    assert inflection_target([Entry("noun", None, ("plural of Nederlander",))]) == "nederlander"
    assert (
        inflection_target([Entry("adj", None, ("inflection of Europees: plural",))]) == "europees"
    )
    assert inflection_target(DICT["huis"]) is None  # a word of its own too
    assert inflection_target([Entry("pron", None, ("unstressed form of zij",))]) is None


# ---- filters ----


def lemma(word: str, **pos: float) -> Lemma:
    item = Lemma(word, freq=sum(pos.values()))
    for p, n in pos.items():
        item.pos[p] += n
    return item


NOUN = Entry("noun", "de", ("a thing",))


def why(item: Lemma, entries: list[Entry], en: float = 2.0, nl: float = 5.0, n: int = 10):
    return drop_reason(item, entries, zipf_en=en, zipf_nl=nl, corpus_count=n)


def test_filters_keep_ordinary_words() -> None:
    assert why(lemma("huis", NOUN=5), DICT["huis"]) is None
    assert why(lemma("u", PRON=5), [Entry("pron", None, ("you (formal)",))]) is None
    assert why(lemma("ja", INTJ=5), [Entry("intj", None, ("yes",))]) is None
    # A month is tagged as a name but written in lowercase in the dictionary.
    assert (
        why(lemma("september", PROPN=5), [Entry("noun", "de", ("September",), "september")]) is None
    )
    # A language is capitalised, but an adjective, not a name.
    assert why(lemma("engels", PROPN=5), [Entry("adj", None, ("English",), "Engels")]) is None
    assert why(lemma("nul", NUM=1), [Entry("num", None, ("zero",), "nul")], n=0) is None


@pytest.mark.parametrize(
    ("item", "entries", "kwargs", "reason"),
    [
        (lemma("2010", NUM=5), [NOUN], {}, "number"),
        (lemma("b", NOUN=5), [NOUN], {}, "letter"),
        (
            lemma("amsterdam", PROPN=5),
            [Entry("name", None, ("capital of the Netherlands",))],
            {},
            "proper noun",
        ),
        (lemma("den", PROPN=3, DET=1), [Entry("noun", "de", ("fir",), "den")], {}, "proper noun"),
        (lemma("kees", NOUN=5), [], {}, "no dictionary entry"),
        (
            lemma("anna", NOUN=5),
            [Entry("noun", None, ("a female given name",))],
            {},
            "no dictionary entry",
        ),
        (
            lemma("bv", NOUN=5),
            [Entry("noun", None, ("abbreviation of besloten vennootschap",))],
            {},
            "abbreviation",
        ),
        (lemma("haha", INTJ=5), [Entry("intj", None, ("indicates laughter",))], {}, "interjection"),
        (lemma("party", NOUN=5), [NOUN], {"en": 5.5, "nl": 4.5, "n": 1}, "English"),
        (lemma("lo", NOUN=5), [NOUN], {"n": 0}, "noise"),
    ],
)
def test_filters_drop(item: Lemma, entries: list[Entry], kwargs: dict, reason: str) -> None:
    assert why(item, entries, **kwargs) == reason


def test_a_loan_dutch_sentences_use_stays() -> None:
    assert why(lemma("computer", NOUN=5), [NOUN], en=4.97, nl=4.68, n=1) is None
    assert why(lemma("party", NOUN=5), [NOUN], en=5.5, nl=4.5, n=30) is None


# ---- example sentence ----


def sentence(sid: int, words: str, score: float, exact: bool = True) -> Sentence:
    lemmas = tuple(words.lower().split())
    return Sentence(sid, words, "", len(lemmas), score, lemmas, exact)


RANKS = {"ik": 1, "het": 2, "zijn": 3, "huis": 150, "groot": 160, "kasteel": 4000, "mooi": 300}


def test_sentence_prefers_easy_five_to_ten_words() -> None:
    cands = [
        sentence(1, "het huis", 0.5),  # too short
        sentence(2, "ik zijn het huis kasteel", 1.0),  # kasteel ranks too far after huis
        sentence(3, "ik zijn het huis groot mooi", 3.0),
        sentence(4, "het huis zijn groot mooi", 2.5, exact=False),  # "huizen", not "huis"
    ]
    assert pick_sentence("huis", 150, cands, RANKS).id == 3


def test_sentence_falls_back_to_the_shortest() -> None:
    cands = [sentence(7, "ik zijn het huis kasteel", 1.0), sentence(8, "huis kasteel", 4.0)]
    assert pick_sentence("huis", 150, cands, RANKS).id == 8
    assert pick_sentence("huis", 150, [], RANKS) is None
