"""Text and term analysis. The SAME pipeline runs on Anki card fields and on texts (ADR 0004)."""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import TYPE_CHECKING

from kenning_nlp import nl
from kenning_nlp.models import TermAnalysis, TextAnalysis, Token

if TYPE_CHECKING:
    from spacy.language import Language
    from spacy.tokens import Doc

MODELS = {"nl": "nl_core_news_md"}
NON_WORD_POS = {"PUNCT", "SPACE", "SYM", "X", "NUM"}


@lru_cache(maxsize=4)
def get_nlp(lang: str) -> Language:
    import spacy

    return spacy.load(MODELS[lang])


def normalize_key(s: str) -> str:
    return unicodedata.normalize("NFC", s).casefold().strip()


def _lemmas(doc: Doc) -> tuple[list[str], dict[int, int]]:
    """Corrected lemmas per token and a map particle index -> verb index."""
    lemmas = [t.lemma_ or t.text for t in doc]
    particle_of: dict[int, int] = {}
    for t in doc:
        if t.pos_ in {"VERB", "AUX"}:
            lemmas[t.i] = nl.strip_unattested_particle(lemmas[t.i], t.text)
    for t in doc:
        if t.dep_ == "compound:prt" and t.head.i != t.i and t.head.pos_ in {"VERB", "AUX"}:
            verb = t.head.i
            lemmas[verb] = nl.join_particle(t.text, lemmas[verb])
            particle_of[t.i] = verb
    return lemmas, particle_of


def analyze_doc(doc: Doc) -> TextAnalysis:
    lemmas, particle_of = _lemmas(doc)
    sent_index = {s.start: n for n, s in enumerate(doc.sents)}
    sent_of: list[int] = []
    current = 0
    for t in doc:
        current = sent_index.get(t.i, current)
        sent_of.append(current)
    tokens = [
        Token(
            i=t.i,
            text=t.text,
            lemma=lemmas[t.i],
            pos=t.pos_,
            morph=str(t.morph),
            dep=t.dep_,
            head=t.head.i,
            sent=sent_of[t.i],
            start=t.idx,
            end=t.idx + len(t.text),
            is_word=t.pos_ not in NON_WORD_POS and not t.like_num and not t.is_space,
            is_propn=t.pos_ == "PROPN",
            is_num=t.like_num or t.pos_ == "NUM",
            particle_of=particle_of.get(t.i),
        )
        for t in doc
    ]
    return TextAnalysis(tokens=tokens)


def analyze_texts(lang: str, texts: list[str]) -> list[TextAnalysis]:
    nlp = get_nlp(lang)
    return [analyze_doc(doc) for doc in nlp.pipe(texts, batch_size=64)]


_PARENS = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_SPLIT = re.compile(r"[,;/|=]|\s[-–—]\s")


def clean_term(raw: str) -> str:
    """Reduce a vocabulary field to the headword: drop parentheses and alternatives."""
    s = _PARENS.sub(" ", raw)
    s = _SPLIT.split(s, maxsplit=1)[0]
    return " ".join(s.split()).strip(" .!?:")


def analyze_terms(lang: str, terms: list[str]) -> list[TermAnalysis]:
    """Analyse short vocabulary entries (Anki word fields) into lookup keys."""
    nlp = get_nlp(lang)
    cleaned = [clean_term(t) for t in terms]
    out: list[TermAnalysis] = []
    for raw, doc in zip(terms, nlp.pipe(cleaned, batch_size=256), strict=True):
        words = [t for t in doc if not t.is_punct and not t.is_space]
        article = None
        reflexive = False
        if len(words) > 1 and words[0].lower_ in nl.ARTICLES:
            article = words[0].lower_ if words[0].lower_ in {"de", "het"} else None
            words = words[1:]
        if len(words) > 1 and words[0].lower_ in nl.REFLEXIVES:
            reflexive = True
            words = words[1:]
        if len(words) > 1 and words[0].lower_ == "te" and words[1].pos_ in {"VERB", "AUX"}:
            words = words[1:]
        if not words:
            out.append(TermAnalysis(input=raw, key="", lemma="", pos=""))
            continue
        lemmas, _ = _lemmas(doc)
        if len(words) == 1:
            w = words[0]
            lemma = lemmas[w.i]
            out.append(
                TermAnalysis(
                    input=raw,
                    key=normalize_key(lemma),
                    lemma=lemma,
                    pos=w.pos_,
                    article=article,
                    reflexive=reflexive,
                )
            )
        else:
            root = next((w for w in words if w.dep_ == "ROOT"), words[0])
            phrase = " ".join(lemmas[w.i] for w in words)
            out.append(
                TermAnalysis(
                    input=raw,
                    key=normalize_key(phrase),
                    lemma=phrase,
                    pos=root.pos_,
                    article=article,
                    reflexive=reflexive,
                    multiword=True,
                )
            )
    return out
