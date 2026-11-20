"""Graded stories: the file format and the word counting (vuurtoren_nlp.stories)."""

from dataclasses import dataclass, field

from vuurtoren_nlp.stories import (
    count_words,
    line_starts,
    parse_story,
    sentence_starts,
    sentence_words,
    story_content,
)

STORY = """---
title: De fiets
level: A1
words: 9
summary: A bike.
kind: original
licence: CC BY-SA 4.0
review: needs-native-review
names: Sam
---

Sam heeft een fiets.
> Sam has a bike.
Hij fietst.
> He cycles.

Het regent.
> It is raining.
"""


@dataclass
class Tok:
    text: str
    start: int
    lemma: str = ""
    sent: int = 0
    alt_lemmas: list[str] = field(default_factory=list)
    is_word: bool = True
    is_propn: bool = False
    is_num: bool = False
    particle_of: int | None = None


def test_parse_reads_front_matter_and_pairs():
    s = parse_story(STORY)
    assert s.problems == []
    assert s.meta["title"] == "De fiets"
    assert s.names == {"sam"}
    assert [[x.nl for x in p] for p in s.paragraphs] == [
        ["Sam heeft een fiets.", "Hij fietst."],
        ["Het regent."],
    ]
    assert [x.en for x in s.sentences] == ["Sam has a bike.", "He cycles.", "It is raining."]


def test_parse_reports_missing_translations_and_fields():
    text = STORY.replace("> He cycles.\n", "").replace("kind: original\n", "kind: poem\n")
    text = text.replace("Het regent.\n> It is raining.\n", "> Orphan.\n")
    s = parse_story(text)
    assert any("Dutch sentence without English: 'Hij fietst.'" in p for p in s.problems)
    assert any("English without a Dutch sentence" in p for p in s.problems)
    assert any("kind 'poem'" in p for p in s.problems)


def test_parse_wants_a_credit_for_retellings():
    s = parse_story(STORY.replace("kind: original", "kind: legend"))
    assert "front matter: a retelling needs a credit" in s.problems


def test_content_joins_sentences_and_paragraphs():
    content, spans = story_content(parse_story(STORY))
    assert content == "Sam heeft een fiets. Hij fietst.\n\nHet regent."
    assert [content[a:b] for a, b in spans] == [
        "Sam heeft een fiets.",
        "Hij fietst.",
        "Het regent.",
    ]


def test_count_skips_names_numbers_particles_and_punctuation():
    ranks = {"hebben": 5, "een": 1, "fiets": 1083, "drie": 40, "op": 9, "bellen": 300}
    tokens = [
        Tok("Sam", 0, "Sam", is_propn=True),
        Tok("heeft", 4, "hebben"),
        Tok("een", 10, "een"),
        Tok("fiets", 14, "fiets"),
        Tok("3", 20, "3", is_num=True),
        Tok("belt", 22, "opbellen", alt_lemmas=["bellen"]),
        Tok("op", 27, "op", particle_of=5),
        Tok(".", 29, ".", is_word=False),
    ]
    c = count_words(tokens, ranks, limit=1000)
    assert (c.words, c.counted, c.within) == (7, 4, 3)
    assert c.outside == {"fiets": 1}
    assert c.coverage == 0.75
    # A word in the story's names is not counted either.
    assert count_words(tokens, ranks, 1000, names=["fiets"]).coverage == 1.0


def test_sentence_words_and_starts():
    tokens = [
        Tok('"', 0, is_word=False, sent=0),
        Tok("Ja", 1, sent=0),
        Tok('"', 3, is_word=False, sent=1),
        Tok("Nee", 5, sent=1),
        Tok("zei", 9, sent=1),
    ]
    spans = [(0, 4), (5, 13)]
    assert sentence_words(tokens, spans) == [1, 2]
    # Sentences are compared by their first word: a stray quote does not count.
    assert sentence_starts(tokens) == {1, 5}
    assert line_starts(tokens, spans) == [1, 5]
