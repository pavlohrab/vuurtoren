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
    from spacy.tokens import Token as Token_

MODELS = {"nl": "nl_core_news_md"}
NON_WORD_POS = {"PUNCT", "SPACE", "SYM", "X", "NUM"}


@lru_cache(maxsize=4)
def get_nlp(lang: str) -> Language:
    import spacy

    return spacy.load(MODELS[lang])


def normalize_key(s: str) -> str:
    return unicodedata.normalize("NFC", s).casefold().strip()


def _dictionary_lemma(lang: str, word: str) -> str:
    import simplemma

    return simplemma.lemmatize(word, lang=lang).replace("_", "")


def _is_known(lang: str, word: str) -> bool:
    import simplemma

    return bool(simplemma.is_known(word, lang=lang))


def choose_lemma(lang: str, surface: str, model_lemma: str) -> tuple[str, list[str]]:
    """Combine spaCy's contextual lemma with a dictionary lemma (simplemma).

    spaCy knows context (staat -> staan as a verb) but its edit-tree lemmatizer invents
    non-words (betekenissen -> betekeniss) or leaves past tenses untouched (ontdekten).
    simplemma has a large form table but no context (las -> lassen). Keep spaCy's lemma
    when it is a real, changed word; otherwise take the dictionary lemma. Returns
    (primary, alternatives) — the matcher tries all of them.
    """
    dict_lemma = _dictionary_lemma(lang, surface)
    if model_lemma == dict_lemma:
        return model_lemma, []
    unchanged = model_lemma.lower() == surface.lower()
    if not _is_known(lang, model_lemma) or (unchanged and dict_lemma.lower() != surface.lower()):
        return dict_lemma, [model_lemma]
    return model_lemma, [dict_lemma]


def _extra_candidates(lang: str, t: Token_) -> list[str]:
    """Cheap extra lemma candidates for the matcher (recall), never the primary lemma."""
    text = t.text
    low = text.lower()
    out: list[str] = []
    # Inflected adjective / participle used as adjective: bepaalde -> bepaald, knappe -> knap.
    if (
        t.pos_ in {"ADJ", "VERB", "ADV", "DET", "NUM", "PRON"}
        and low.endswith("e")
        and len(low) > 3
    ):
        base = low[:-1]
        out.append(base)
        if len(base) > 2 and base[-1] == base[-2] and base[-1] not in "aeiou":
            out.append(base[:-1])
    # Plural nouns the lemmatizers miss: katten -> kat, individuen -> individu, degenen -> degene.
    if t.pos_ in {"NOUN", "PRON"} and "Number=Plur" in str(t.morph):
        if low.endswith("en") and len(low) > 4:
            stem = low[:-2]
            out += [low[:-1], stem]
            if len(stem) > 2 and stem[-1] == stem[-2] and stem[-1] not in "aeiou":
                out.append(stem[:-1])
        elif low.endswith("s") and len(low) > 3:
            out.append(low[:-1])
    # Fused separable forms: aangelopen -> aanlopen, afdwong -> afdwingen.
    if t.pos_ in {"VERB", "ADJ", "AUX"}:
        for p in nl.SEPARABLE_PARTICLES:
            rest = low[len(p) :]
            if low.startswith(p) and len(rest) >= 3:
                rest_lemma = _dictionary_lemma(lang, rest)
                if rest_lemma != rest or rest.endswith("en"):
                    out.append(p + rest_lemma)
                break
    # Infinitive-looking verb forms are their own lemma candidate (vragen in "vragen zich af").
    if t.pos_ in {"VERB", "AUX"} and low.endswith("en"):
        out.append(low)
    return out


def _lemmas(doc: Doc, lang: str = "nl") -> tuple[list[str], list[list[str]], dict[int, int]]:
    """Corrected lemma per token, alternative lemmas, and a map particle index -> verb index."""
    lemmas: list[str] = []
    alts: list[list[str]] = []
    for t in doc:
        model = t.lemma_ or t.text
        text = t.text
        # tokenizer keeps a sentence-final period on short words ("vol.") -> drop it
        if text.endswith(".") and len(text) > 2 and text[:-1].isalpha():
            text = text[:-1]
        if t.pos_ in {"VERB", "AUX"}:
            model = nl.strip_unattested_particle(model, text)
        word_like = text.isalpha() and t.pos_ not in {"PUNCT", "SYM", "NUM"}
        if word_like and t.pos_ == "PROPN":
            # sentence-initial capitals are often mis-tagged nouns ("Katten zijn ...")
            word_like = t.is_sent_start and _is_known(lang, text.lower())
            text = text.lower() if word_like else text
        if word_like:
            primary, alt = choose_lemma(lang, text, model)
            alt = [*alt, *_extra_candidates(lang, t)]
        else:
            primary, alt = model, []
        if text != t.text:
            alt.append(text)
        lemmas.append(primary)
        alts.append(alt)

    particle_of: dict[int, int] = {}

    def attach(particle: Token_, verb: Token_, primary: bool) -> None:
        bases = [lemmas[verb.i], *alts[verb.i]]
        joined = [nl.join_particle(particle.text, b, verb.text) for b in bases]
        new = [j for j in joined if j not in bases]
        if not new:
            return
        if primary:
            alts[verb.i] = [lemmas[verb.i], *alts[verb.i], *new[1:]]
            lemmas[verb.i] = new[0]
            particle_of[particle.i] = verb.i
        else:
            alts[verb.i] = [*alts[verb.i], *new]

    # (a) parser-attached particles: "Ik bel je morgen op."
    for t in doc:
        if (
            t.dep_ == "compound:prt"
            and t.is_alpha
            and t.head.i != t.i
            # head may be mis-tagged (sentence-initial imperative "Trek ... aan" -> PROPN)
            and t.head.pos_ in {"VERB", "AUX", "PROPN"}
        ):
            attach(t, t.head, primary=True)
    # (b) te-infinitive: "in te stellen", "waar te nemen"
    for t in doc:
        if t.pos_ in {"VERB", "AUX"} and t.i >= 2 and doc[t.i - 1].lower_ == "te":
            p = doc[t.i - 2]
            if p.lower_ in nl.SEPARABLE_PARTICLES or p.lower_ in nl.TE_PARTICLES:
                attach(p, t, primary=True)
    # (c) clause-final particle the parser missed: "Trek een warme trui aan."
    for sent in doc.sents:
        finite = [t for t in sent if t.pos_ in {"VERB", "AUX"} and "VerbForm=Fin" in str(t.morph)]
        for t in sent:
            if (
                t.i in particle_of
                or t.lower_ not in nl.SEPARABLE_PARTICLES
                or t.pos_ not in {"ADP", "ADV"}
            ):
                continue
            nxt = doc[t.i + 1] if t.i + 1 < len(doc) else None
            clause_final = nxt is None or nxt.is_punct or nxt.pos_ in {"CCONJ", "SCONJ"}
            if t.dep_ == "case" and not clause_final:
                continue
            for v in finite:
                if v.i < t.i:
                    attach(t, v, primary=False)

    alts = [[a for a in dict.fromkeys(xs) if a and a != lemmas[i]] for i, xs in enumerate(alts)]
    return lemmas, alts, particle_of


def analyze_doc(doc: Doc) -> TextAnalysis:
    lemmas, alts, particle_of = _lemmas(doc)
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
            alt_lemmas=alts[t.i],
            pos=t.pos_,
            morph=str(t.morph),
            dep=t.dep_,
            head=t.head.i,
            sent=sent_of[t.i],
            start=t.idx,
            end=t.idx + len(t.text),
            is_word=t.pos_ not in NON_WORD_POS
            and not t.like_num
            and not t.is_space
            and any(c.isalpha() for c in t.text),
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


_APOS = str.maketrans({"\u2019": "'", "\u2018": "'", "`": "'"})
_REFLEXIVE_MARK = re.compile(r"\(\s*zich\s*\)", re.IGNORECASE)
_BRACKETS = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_GLOSS_SEP = re.compile(r"\s[-\u2013\u2014]\s|=")
_ALT_SEP = re.compile(r"\s*[,;/|]\s*")


def split_term(raw: str) -> tuple[list[str], bool]:
    """Split a vocabulary field into headword alternatives; detect a ``(zich)`` marker.

    ``"zij, ze"`` -> (["zij", "ze"], False); ``"richten (zich)"`` -> (["richten"], True);
    ``"fietsen (fietste, gefietst)"`` -> (["fietsen"], False).
    """
    s = raw.translate(_APOS)
    reflexive = bool(_REFLEXIVE_MARK.search(s))
    s = _BRACKETS.sub(" ", s)
    s = s.replace("\u2026", " ").replace("...", " ")
    s = _GLOSS_SEP.split(s, maxsplit=1)[0]
    alts = [" ".join(a.split()).strip(" .!?:") for a in _ALT_SEP.split(s)]
    return [a for a in alts if a], reflexive


def _strip_function_words(alt: str) -> tuple[str, str | None, bool]:
    """Remove a leading article / reflexive pronoun. Returns (headword, article, reflexive)."""
    words = alt.split()
    article = None
    reflexive = False
    # "het of de cement": both genders are accepted
    if (
        len(words) > 3
        and words[1].lower() == "of"
        and {words[0].lower(), words[2].lower()} <= {"de", "het"}
    ):
        words = words[3:]
    if len(words) > 1 and words[0].lower() in nl.ARTICLES:
        article = words[0].lower() if words[0].lower() in {"de", "het"} else None
        words = words[1:]
    if len(words) > 1 and words[0].lower() in nl.REFLEXIVES:
        reflexive = True
        words = words[1:]
    return " ".join(words), article, reflexive


def analyze_terms(lang: str, terms: list[str]) -> list[TermAnalysis]:
    """Analyse vocabulary entries (Anki word fields) into lookup keys.

    Headwords in vocabulary decks are already citation forms, and lemmatising an isolated
    word is unreliable (spaCy: vragen -> vraag, staat -> staan, geleden -> lijden). So the
    key is the headword itself; alternatives become aliases; spaCy only supplies POS and an
    informational lemma guess. Matching text tokens tries their contextual lemma first,
    then their surface form (see packages/core).
    """
    nlp = get_nlp(lang)
    parsed = []
    for raw in terms:
        alts, reflexive_mark = split_term(raw)
        heads = [_strip_function_words(a) for a in alts]
        parsed.append((raw, heads, reflexive_mark))
    primaries = [heads[0][0] if heads else "" for _, heads, _ in parsed]

    out: list[TermAnalysis] = []
    for (raw, heads, reflexive_mark), doc in zip(
        parsed, nlp.pipe(primaries, batch_size=256), strict=True
    ):
        if not heads or not heads[0][0]:
            out.append(TermAnalysis(input=raw, key="", lemma="", pos=""))
            continue
        head, article, reflexive = heads[0]
        words = [t for t in doc if not t.is_punct and not t.is_space]
        lemmas, _, _ = _lemmas(doc)
        multiword = len(words) > 1
        if multiword:
            root = next((w for w in words if w.dep_ == "ROOT"), words[0])
            pos, lemma = root.pos_, " ".join(lemmas[w.i] for w in words)
        elif words:
            pos, lemma = words[0].pos_, lemmas[words[0].i]
        else:
            pos, lemma = "", head
        key = normalize_key(head)
        aliases = list(dict.fromkeys(normalize_key(h) for h, _, _ in heads[1:] if h))
        out.append(
            TermAnalysis(
                input=raw,
                key=key,
                aliases=[a for a in aliases if a != key],
                lemma=lemma,
                pos=pos,
                article=article,
                reflexive=reflexive or reflexive_mark,
                multiword=multiword,
            )
        )
    return out
