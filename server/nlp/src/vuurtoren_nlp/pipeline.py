"""Text and term analysis. The SAME pipeline runs on Anki card fields and on texts."""

from __future__ import annotations

import gzip
import re
import unicodedata
from collections import Counter
from functools import lru_cache
from itertools import accumulate
from pathlib import Path
from typing import TYPE_CHECKING

from vuurtoren_nlp import nl
from vuurtoren_nlp.errors import ServiceError
from vuurtoren_nlp.freq import token_zipf, zipf
from vuurtoren_nlp.lexicon import get_lexicon
from vuurtoren_nlp.models import MAX_TEXT_CHARS, TermAnalysis, TextAnalysis, Token
from vuurtoren_nlp.rules import words

if TYPE_CHECKING:
    from spacy.language import Language
    from spacy.tokens import Doc
    from spacy.tokens import Token as Token_

MODELS = {"nl": "nl_core_news_md"}
NON_WORD_POS = {"PUNCT", "SPACE", "SYM", "X", "NUM"}
DIMINUTIVE_SUFFIXES = ("je", "tje", "etje", "pje", "kje")


_ENDS = {".", "!", "?", "…", "..."}
# Words spaCy also lists as abbreviations; before a full stop they are the words (see get_nlp).
_WORDS_NOT_ABBREVIATIONS = set(words("words_not_abbreviations.txt"))


def _paragraph_breaks(doc: Doc) -> Doc:
    """Where sentences start, decided before the parser (which keeps to it). A blank line always
    starts one: the parser otherwise joins a paragraph that starts with a name, or a heading without
    a full stop, to the sentence before it. Otherwise a sentence ends after . ! ? … (and a closing
    quote right after them), but not when the next word starts with a small letter ("Kunnen we
    …?" vroeg hij), and never at a colon: the parser used to cut a quote off from "zegt hij"."""
    starts = [False] * len(doc)
    for t in doc[1:]:
        prev = doc[t.i - 1]
        if not t.is_space and (prev.is_space and prev.text.count("\n") >= 2):
            starts[t.i] = True
    i = 0
    while i < len(doc):
        if doc[i].text not in _ENDS:
            i += 1
            continue
        j = i + 1
        # closing quotes and brackets that hang on the full stop ("…," or …?")
        while j < len(doc) and doc[j].text in {'"', "'", ")"} and not doc[j - 1].whitespace_:
            j += 1
        k = j
        while k < len(doc) and doc[k].is_space:
            k += 1
        # the next word with letters ("Otto's" counts; "'s Avonds" is decided by "Avonds")
        nxt = next(
            (w for w in doc[k:] if any(c.isalpha() for c in w.text) and w.text[0] not in "'’"),
            None,
        )
        first = next((c for c in nxt.text if c.isalpha()), "") if nxt is not None else ""
        if k < len(doc) and first and not first.islower():
            starts[k] = True
        i = j
    for t in doc[1:]:
        t.is_sent_start = starts[t.i]
    return doc


@lru_cache(maxsize=4)
def get_nlp(lang: str) -> Language:
    import spacy
    from spacy.language import Language

    if not Language.has_factory("paragraph_breaks"):
        Language.component("paragraph_breaks", func=_paragraph_breaks)
    nlp = spacy.load(MODELS[lang])
    # spaCy's Dutch abbreviations include ordinary words ("hand." for handtekening, "al." for
    # alinea), so "Hij pakt zijn hand." kept the full stop on the word and the sentence ran on.
    rules = nlp.tokenizer.rules
    nlp.tokenizer.rules = {
        k: v
        for k, v in rules.items()
        if k[:-1].lower() not in _WORDS_NOT_ABBREVIATIONS or k[-1] != "."
    }
    nlp.add_pipe("paragraph_breaks", before="parser")
    # Larger than the API's per-text limit; anything above raises E088 -> HTTP 413.
    nlp.max_length = MAX_TEXT_CHARS + 1000
    return nlp


# One character for one, so offsets stay: curly apostrophes and typographic quotes become plain.
_QUOTES = str.maketrans(
    {"‘": "'", "’": "'", "`": "'", "„": '"', "“": '"', "”": '"', "«": '"', "»": '"'}
)


def normalize_key(s: str) -> str:
    """Canonical lookup key. The TS side implements the SAME rule (``normalizeKey``).

    ``NFKC(s)``, then curly quotes and backtick -> ``'``, then ``.lower()`` (NOT casefold:
    ``ß`` stays ``ß``), then strip. ``"Straße" -> "straße"``, ``"ﬁets" -> "fiets"``.
    """
    return unicodedata.normalize("NFKC", s).translate(_QUOTES).lower().strip()


# --------------------------------------------------------------------------- lemma choice


def _dictionary_lemma(lang: str, word: str) -> str:
    import simplemma

    return simplemma.lemmatize(word, lang=lang).replace("_", "")


def _is_known(lang: str, word: str, strict: bool = False) -> bool:
    """Is ``word`` a real word? Kaikki DB when present, else simplemma (weak: katt is known).

    ``strict`` (used for heuristic alternatives) demands a headword of its own, not just an
    inflected form, so ``katte`` / ``bote`` are rejected when the DB is present.
    """
    lex = get_lexicon()
    verdict = lex.is_headword(word) if strict else lex.is_word(word)
    if verdict is not None:
        return verdict
    import simplemma

    return bool(simplemma.is_known(word, lang=lang))


def _unlisted(surface: str, lemma: str, name: bool = False) -> bool:
    """Not a Dutch word to learn: another alphabet or a digit in it, or no dictionary entry for
    the form or its lemma and no Dutch word frequency (compounds the dictionary lacks usually
    have one). Without the dictionary only the first test applies."""
    low = surface.lower()
    # Another alphabet (Ελληνικά) or digits in it ("3e"): not a Dutch word to learn.
    if any(c.isdigit() or (c.isalpha() and ord(c) > 0x24F) for c in low):
        return True
    lex = get_lexicon()
    if name or lex.is_word(low) is None:
        return False
    if lex.is_word(low) or lex.is_word(lemma.lower()):
        return False
    from wordfreq import zipf_frequency

    return zipf_frequency(low, "nl") == 0 and zipf_frequency(lemma.lower(), "nl") == 0


def is_inflected(pos: str, morph: str, surface: str) -> bool:
    """Does spaCy's morphology say ``surface`` differs from its citation form?

    VERB/AUX: participle, past tense, imperative or singular finite (ik werk, hij werkt, wil)
    are inflected; infinitives and plural-present forms (-en, equal to the infinitive) are
    not. NOUN: ``Number=Plur``. ADJ: comparative/superlative or an -e ending. PROPN (a
    sentence-initial capital that is really a common word) is treated as possibly plural.
    Everything else (pronouns, determiners, adverbs, ...) is never inflected.
    """
    low = surface.lower()
    feats = set(morph.split("|"))
    if pos in {"VERB", "AUX"}:
        if feats & {"VerbForm=Part", "Tense=Past", "Mood=Imp"}:
            return True
        if "VerbForm=Inf" in feats or ("VerbForm=Fin" in feats and "Number=Plur" in feats):
            return False
        # Dutch infinitives / plural presents end in -n (-en, gaan, zijn); no morphology: guess.
        return "Number=Sing" in feats or not low.endswith("n")
    if pos == "NOUN":
        return "Number=Plur" in feats
    if pos == "PROPN":
        return low.endswith(("en", "s", "n"))
    if pos == "ADJ":
        return bool(feats & {"Degree=Cmp", "Degree=Sup"}) or (low.endswith("e") and len(low) > 3)
    return False


def _past_read_as_present(surface: str, pos: str, morph: str) -> bool:
    """A plural past tense the parser calls present ("pleegden", "wierpen").

    A plural present has the infinitive's form, so it is a verb with meanings of its own (lopen,
    weten). When the dictionary only says the form is a form of another verb, it isn't one.
    """
    if pos not in {"VERB", "AUX"} or "Number=Plur" not in morph or "Tense=Past" in morph:
        return False
    lex = get_lexicon()
    if not lex.available or lex.own_verb(surface) is not False:
        return False
    return any(w != surface.lower() for w in lex.lemmas(surface, "VERB"))


def _sensible(surface: str, candidate: str, pos: str) -> bool:
    """Reject dictionary lemmas that are obviously derivation noise, not a base form.

    Nouns and adjectives inflect by adding letters, so their lemma can't be longer than the
    surface (simplemma: ``kat -> kater``, ``boot -> boten``). Verbs may lengthen (bel -> bellen).
    """
    if not candidate:
        return False
    return not (pos in {"NOUN", "PROPN", "ADJ"} and len(candidate) > len(surface))


def _dict_candidates(lang: str, surface: str, pos: str) -> tuple[list[str], bool]:
    """(dictionary lemmas, came_from_kaikki) for ``surface``; empty list when none is usable.

    The Kaikki forms table (when present) is authoritative and POS-aware. Otherwise
    simplemma's guess is used if it is a known word and passes :func:`_sensible`.
    """
    lex = get_lexicon()
    if lex.available:
        found = [w for w in lex.lemmas(surface, pos) if _sensible(surface.lower(), w, pos)]
        if pos in {"VERB", "AUX"}:
            # A Dutch infinitive ends in -n; Kaikki also lists participles as verb headwords
            # ("ontdekte" under both ontdekt and ontdekken): the infinitive first.
            found.sort(key=lambda w: not w.endswith("n"))
        if found:
            return found, True
    cand = _dictionary_lemma(lang, surface).lower()
    if cand and _sensible(surface.lower(), cand, pos) and _is_known(lang, cand):
        return [cand], False
    return [], False


def choose_lemma(
    lang: str, surface: str, model_lemma: str, pos: str = "", morph: str = ""
) -> tuple[str, list[str]]:
    """Combine spaCy's contextual lemma with a dictionary lemma. Returns (primary, alternatives).

    spaCy knows context (staat -> staan as a verb) but its edit-tree lemmatizer invents
    non-words (betekenissen -> betekeniss) or leaves inflected forms untouched (ontdekten).
    The dictionary (Kaikki forms table, else simplemma) has no context and mangles base forms
    (kat -> kater, bellen -> bel). The rule, precisely:

    1. spaCy's lemma stays primary when it equals the surface and is a real word, unless
       :func:`is_inflected` says the token is inflected (infinitives, plural presents and
       singular nouns therefore always keep spaCy's lemma).
    2. The dictionary lemma becomes primary only if it is usable (:func:`_dict_candidates`:
       sensible and known) AND one of: spaCy's lemma is a non-word; spaCy left an inflected
       token unchanged; or the token is inflected and Kaikki (authoritative, POS-aware) lists
       lemmas for the surface that exclude spaCy's, or whose best (most frequent) one is more
       frequent than spaCy's (regeert: regeeren -> regeren).
    3. Otherwise spaCy's lemma stays primary and the dictionary lemma is an alternative
       (only when it comes from Kaikki, or the token is inflected).

    The matcher tries the primary and all alternatives; the caller filters junk alternatives.
    """
    model_lemma = model_lemma or surface
    unchanged = model_lemma.lower() == surface.lower()
    inflected = is_inflected(pos, morph, surface) or _past_read_as_present(surface, pos, morph)
    model_ok = _is_known(lang, model_lemma)
    if unchanged and model_ok and not inflected:
        return model_lemma, []  # infinitive, singular noun, ...: the citation form already
    cands, from_kaikki = _dict_candidates(lang, surface, pos)
    if not cands:
        return model_lemma, []
    dict_lemma = cands[0]
    if model_lemma.lower() == dict_lemma:
        return model_lemma, []
    # Kaikki lists several lemmas (best = most frequent first); spaCy's is a rarer spelling
    # variant of the best one (regeeren vs regeren) -> prefer the frequent one.
    variant = (
        from_kaikki
        and inflected
        and (model_lemma.lower() not in cands or zipf(dict_lemma) > zipf(model_lemma.lower()))
    )
    # spaCy gave a participle ("ontdekt") for a verb the dictionary knows by its infinitive.
    participle = (
        pos in {"VERB", "AUX"}
        and from_kaikki
        and dict_lemma.endswith("n")
        and not model_lemma.lower().endswith("n")
    )
    take_dict = not model_ok or (unchanged and inflected) or variant or participle
    if take_dict:
        return dict_lemma, [model_lemma]
    return model_lemma, [dict_lemma] if (from_kaikki or inflected) else []


def syntax_lemma(
    lang: str, surface: str, pos: str, ours: str, alts: list[str], theirs: str | None
) -> tuple[str, list[str]]:
    """SyntaxDot's own lemma as one more candidate (SX2). Returns (primary, alternatives).

    Needs the dictionary. Theirs must be a word with meanings of its own (never a form such
    as lachten or had). It wins where ours is not one (geheugen, not geheug; vreemd, not
    vreemds; voorbijgaan, not voorbijgaat), or, for a verb, where theirs is a verb and ours is
    another word altogether (reed: rijden, not the noun reden). Otherwise it becomes an
    alternative for the matcher, when the dictionary lists it for this word. It never undoes
    what we do on purpose: a split verb joined to its particle (dichtdoen, not doen), a
    diminutive kept (broertje(s), not broer), a participle used as a word (volgende: volgend).
    """
    lex = get_lexicon()
    if not theirs or theirs == "_" or not lex.available:
        return ours, alts
    t = theirs if pos == "PROPN" else theirs.lower()
    low = ours.lower()
    if t == low or lex.own_entry(t) is not True:
        return ours, alts
    if low.endswith(t) and len(low) > len(t):
        return ours, alts  # a separable verb joined to its particle: dicht+doen
    if _is_diminutive(low, t) or (_is_diminutive(surface, t) and low == surface.lower()):
        return ours, alts  # broertje(s), beetje stay diminutives
    rest = [a for a in alts if a.lower() != t]
    # Ours is the word with an ending (volgend+e, gemaakt+e): that's a word, not a mistake.
    ending = surface.lower().startswith(low)
    verb_fix = (
        pos in {"VERB", "AUX"}
        and not ending
        and lex.own_verb(t) is True
        and lex.own_verb(low) is False
    )
    if lex.own_entry(low) is not True or verb_fix:
        return t, [ours, *rest]
    if t in lex.lemmas(surface.lower(), pos) and t not in alts:
        return ours, [*alts, t]
    return ours, alts


def _initial_capital_lemma(lang: str, text: str, model: str) -> tuple[str, list[str]]:
    """Lemma for a sentence-initial capitalised word that is really a common word.

    spaCy tags these PROPN ("Katten zijn...", "Nam hij deel...") so its morphology is useless.
    With the Kaikki DB: a plural-noun reading wins (Katten -> kat); else a verb reading wins
    (Nam -> nemen, Bel -> bellen: a bare singular noun rarely starts a sentence); else spaCy's
    lemma. Without the DB, :func:`choose_lemma` is used.
    """
    lex = get_lexicon()
    if not lex.available:
        primary, alt = choose_lemma(lang, text, model, "PROPN", "")
        return primary, [*alt, _dictionary_lemma(lang, text.lower())]
    low = text.lower()
    noun = [w for w in lex.lemmas(low, "NOUN") if len(w) < len(low)]  # plural -> shorter
    verb = [w for w in lex.lemmas(low, "VERB") if w != low]
    if noun:
        return noun[0], [model, *verb]
    if verb:  # a bare singular noun rarely starts a sentence: "Bel/Nam/Trek" are verb forms
        return verb[0], [model]
    return model, [*verb, *noun]


def _is_diminutive(surface: str, lemma: str) -> bool:
    low = surface.lower()
    return (
        len(low) > 4
        and low != lemma.lower()
        and low.endswith(DIMINUTIVE_SUFFIXES)
        and low.startswith(lemma.lower()[: max(2, len(lemma) - 2)])
    )


def _extra_candidates(lang: str, t: Token_) -> tuple[list[str], list[str]]:
    """Cheap extra lemma candidates for the matcher (recall), never the primary lemma.

    Returns (guesses, explicit). Guesses are suffix-stripping heuristics that the caller keeps
    only if they are known words (drops probleme, duurd, daarm). Explicit candidates come from
    deliberate rules (fused particles, infinitive-looking verbs, diminutives) and are kept.
    """
    low = t.text.lower()
    guesses: list[str] = []
    explicit: list[str] = []
    # Inflected adjective / participle used as adjective: bepaalde -> bepaald, knappe -> knap.
    if (
        t.pos_ in {"ADJ", "VERB", "ADV", "DET", "NUM", "PRON"}
        and low.endswith("e")
        and len(low) > 3
    ):
        base = low[:-1]
        guesses.append(base)
        if len(base) > 2 and base[-1] == base[-2] and base[-1] not in "aeiou":
            guesses.append(base[:-1])
    # Plural nouns the lemmatizers miss: katten -> kat, individuen -> individu, degenen -> degene.
    if t.pos_ in {"NOUN", "PRON"} and "Number=Plur" in str(t.morph):
        if low.endswith("en") and len(low) > 4:
            stem = low[:-2]
            guesses += [low[:-1], stem]
            if len(stem) > 2 and stem[-1] == stem[-2] and stem[-1] not in "aeiou":
                guesses.append(stem[:-1])
        elif low.endswith("s") and len(low) > 3:
            guesses.append(low[:-1])
    # Fused separable forms: aangelopen -> aanlopen, afdwong -> afdwingen.
    if t.pos_ in {"VERB", "ADJ", "AUX"}:
        for p in nl.SEPARABLE_PARTICLES:
            rest = low[len(p) :]
            if low.startswith(p) and len(rest) >= 3:
                rest_lemma = _dictionary_lemma(lang, rest).lower()
                joined = p + rest_lemma
                if rest_lemma != rest or rest.endswith("en"):
                    (explicit if joined.endswith("n") or _is_known(lang, joined) else []).append(
                        joined
                    )
                break
    # Infinitive-looking verb forms are their own lemma candidate (vragen in "vragen zich af").
    if t.pos_ in {"VERB", "AUX"} and low.endswith("en"):
        explicit.append(low)
    return guesses, explicit


def _stranded(doc: Doc, particle: Token_) -> bool:
    """R-pronoun earlier in the sentence: the preposition is stranded, not a verb particle.

    "Waar wacht je op?", "Ik denk er niet aan", "Daar staat hij bij": no opwachten/aandenken.
    """
    sent_start = particle.sent.start
    return any(nl.is_r_pronoun(w.text) for w in doc[sent_start : particle.i])


@lru_cache(maxsize=1)
def _compound_verbs() -> frozenset[str]:
    """OpenTaal's separable and compound verbs (``scripts/build_compound_verbs.py``)."""
    path = Path(__file__).with_name("compound-verbs-nl.txt.gz")
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return frozenset(w for w in (line.strip() for line in f) if w and not w.startswith("#"))


def _joinable(joined: str) -> bool:
    """May a particle and its verb be read as one verb, ``joined``?

    Only when it is a real word: in the dictionary (Kaikki) or in OpenTaal's word list, which
    has the separable verbs Wiktionary misses (meegeven, wegblijven). "Dat moet weg" stays
    moeten ("must go"), "Eerst deed zijn vinger pijn" stays doen. Without the dictionary the
    parser decides, as before.
    """
    known = get_lexicon().is_headword(joined)
    return known is not False or joined in _compound_verbs()


def _circumposition(particle: Token_) -> bool:
    """Does ``particle`` close a circumposition opened shortly before it ("naar hem toe")?

    The preposition must come at most four words earlier in the sentence, with no verb in
    between, so "Hij ging naar huis en deed de deur toe" still reads toedoen.
    """
    opens = nl.CIRCUMPOSITIONS.get(particle.lower_)
    if not opens:
        return False
    start = max(particle.sent.start, particle.i - 5)
    for w in reversed(particle.doc[start : particle.i]):
        if w.pos_ in {"VERB", "AUX"}:
            return False
        if w.lower_ in opens:
            return True
    return False


def _lemmas(doc: Doc, lang: str = "nl") -> tuple[list[str], list[list[str]], dict[int, int]]:
    """Corrected lemma per token, alternative lemmas, and a map particle index -> verb index.

    Alternatives are lowercase and de-junked: kept only if they are known words or came from an
    explicit rule (particle joining, te-infinitive, fused particle, diminutive, surface form).
    """
    lemmas: list[str] = []
    alts: list[list[str]] = []
    explicit: list[set[str]] = []
    for t in doc:
        model = t.lemma_ or t.text
        text = t.text
        # tokenizer keeps a sentence-final period on short words ("vol.") -> drop it
        if text.endswith(".") and len(text) > 2 and text[:-1].isalpha():
            text = text[:-1]
        if t.pos_ != "PROPN":
            model = model.lower()  # spaCy keeps the capital of sentence-initial words
        if t.pos_ in {"VERB", "AUX"}:
            model = nl.strip_unattested_particle(model, text)
        word_like = text.isalpha() and t.pos_ not in {"PUNCT", "SYM", "NUM"}
        if word_like and t.pos_ == "PROPN":
            # sentence-initial capitals are often mis-tagged nouns ("Katten zijn ...")
            word_like = t.is_sent_start and _is_known(lang, text.lower())
            text = text.lower() if word_like else text
        guesses: list[str] = []
        sure: list[str] = []
        if word_like and t.pos_ == "PROPN":
            primary, alt = _initial_capital_lemma(lang, text, model)
            guesses, sure = _extra_candidates(lang, t)
        elif word_like:
            primary, alt = choose_lemma(lang, text, model, t.pos_, str(t.morph))
            guesses, sure = _extra_candidates(lang, t)
            if t.pos_ == "NOUN" and _is_diminutive(text, primary):
                sure.append(text.lower())  # huisje -> primary "huis", alternative "huisje"
        else:
            primary, alt = model, []
        if text != t.text:
            sure.append(text.lower())
        lemmas.append(primary)
        explicit.append({s.lower() for s in sure})
        alts.append([a.lower() for a in [*alt, *guesses]])

    # keep only known words (explicit candidates are exempt), then add the explicit ones
    for i, xs in enumerate(alts):
        alts[i] = [
            a for a in xs if a in explicit[i] or (a.isalpha() and _is_known(lang, a, strict=True))
        ]
        alts[i] += sorted(explicit[i])

    particle_of: dict[int, int] = {}

    def attach(particle: Token_, verb: Token_, primary: bool) -> None:
        bases = [lemmas[verb.i], *alts[verb.i]]
        if verb.pos_ == "PROPN":  # mis-tagged sentence-initial imperative: prefer a verb reading
            bases.sort(key=lambda b: not b.endswith("n"))
        joined = [nl.join_particle(particle.text, b, verb.text) for b in bases]
        base_set = {b.lower() for b in bases}
        if _circumposition(particle):
            return
        new = [j for j in joined if j not in base_set and _joinable(j)]
        if not new:
            return
        # extra joined forms must look like infinitives (…n): no stems such as "opbel"/"bijstaat"
        extras = [j for j in new[1:] if j.endswith("n")]
        if primary:
            alts[verb.i] = [lemmas[verb.i].lower(), *alts[verb.i], *extras]
            lemmas[verb.i] = new[0]
            particle_of[particle.i] = verb.i
        else:
            alts[verb.i] = [
                *alts[verb.i],
                *(j for j in new if j.endswith("n")),
            ]

    # (a) parser-attached particles: "Ik bel je morgen op."
    prts = [
        t
        for t in doc
        if t.dep_ == "compound:prt"
        and t.is_alpha
        and t.head.i != t.i
        # head may be mis-tagged (sentence-initial imperative "Trek ... aan" -> PROPN)
        and t.head.pos_ in {"VERB", "AUX", "PROPN"}
        and not _stranded(doc, t)
    ]
    per_verb = Counter(t.head.i for t in prts if not _circumposition(t))
    for t in prts:
        # A verb has one particle. Two mean verbs left out: "helpt met zijn broek uit en zijn
        # pyjama aan" is uit(doen) and aan(doen), not aanhelpen.
        if per_verb[t.head.i] <= 1:
            attach(t, t.head, primary=True)
    # (a2) noun particles the parser leaves as objects: "nam deel" (spaCy proposed deelnemen,
    # the dictionary says nemen). Promote spaCy's candidate and mark "deel" as its particle,
    # so it is not counted as an independent noun.
    for v in doc:
        if v.pos_ not in {"VERB", "AUX"} or v.i in particle_of.values():
            continue
        for p in nl.TE_PARTICLES:
            near = [w for w in doc[v.i + 1 : v.i + 4] if w.lower_ == p and w.i not in particle_of]
            if not near:
                continue
            joined = p + lemmas[v.i]
            if lemmas[v.i].startswith(p) and len(lemmas[v.i]) > len(p) + 2:
                particle_of[near[0].i] = v.i  # spaCy's lemma already is "deelnemen"
            elif joined in alts[v.i]:
                alts[v.i] = [lemmas[v.i].lower(), *(a for a in alts[v.i] if a != joined)]
                lemmas[v.i] = joined
                particle_of[near[0].i] = v.i
            else:
                continue
            break
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
                or _stranded(doc, t)
            ):
                continue
            nxt = doc[t.i + 1] if t.i + 1 < len(doc) else None
            clause_final = nxt is None or nxt.is_punct or nxt.pos_ in {"CCONJ", "SCONJ"}
            if t.dep_ == "case" and not clause_final:
                continue
            from wordfreq import zipf_frequency

            # A known, common separable verb (OpenTaal, and used enough that it isn't a rare
            # reading like "samenlopen" for "lopen samen") with an adverb particle: it is the
            # particle, also with a phrase after it ("Hij ging mee naar Gorinchem").
            known = [
                v
                for v in finite
                if v.i < t.i
                and t.pos_ == "ADV"
                and (joined := nl.join_particle(t.text, lemmas[v.i], v.text)) in _compound_verbs()
                and zipf_frequency(joined, "nl") >= 2.5
            ]
            if len(known) == 1 and t.i not in particle_of:
                attach(t, known[0], primary=True)
                continue
            for v in finite:
                if v.i < t.i:
                    attach(t, v, primary=False)

    alts = [
        [a for a in dict.fromkeys(xs) if a and a.lower() != lemmas[i].lower()]
        for i, xs in enumerate(alts)
    ]
    return lemmas, alts, particle_of


def _utf16_offsets(text: str) -> list[int] | None:
    """Map code-point offsets to UTF-16 code-unit offsets, or None if they are identical.

    spaCy reports code-point offsets (``Token.idx``); JavaScript slices in UTF-16 code units,
    where each character above U+FFFF (emoji, rare CJK) takes two. Texts without such
    characters (the common case) hit the fast path. Otherwise returns a prefix table of length
    ``len(text) + 1`` so ``table[cp_offset]`` is the UTF-16 offset.
    """
    if text.isascii() or len(text.encode("utf-16-le")) == 2 * len(text):
        return None
    return [0, *accumulate(2 if ord(c) > 0xFFFF else 1 for c in text)]


def analyze_doc(doc: Doc, original: str | None = None) -> TextAnalysis:
    """``original``: the text before quote normalisation; token ``text`` is sliced from it."""
    src = original if original is not None and len(original) == len(doc.text) else doc.text
    lemmas, alts, particle_of = _lemmas(doc)
    to16 = _utf16_offsets(doc.text)

    def off(cp: int) -> int:
        return cp if to16 is None else to16[cp]

    sent_index = {s.start: n for n, s in enumerate(doc.sents)}
    sent_of: list[int] = []
    current = 0
    for t in doc:
        current = sent_index.get(t.i, current)
        sent_of.append(current)
    is_word = [
        t.pos_ not in NON_WORD_POS
        and not t.like_num
        and not t.is_space
        and any(c.isalpha() for c in t.text)
        for t in doc
    ]
    tokens = [
        Token(
            i=t.i,
            text=src[t.idx : t.idx + len(t.text)],
            lemma=lemmas[t.i],
            alt_lemmas=alts[t.i],
            pos=t.pos_,
            morph=str(t.morph),
            dep=t.dep_,
            head=t.head.i,
            sent=sent_of[t.i],
            start=off(t.idx),
            end=off(t.idx + len(t.text)),
            is_word=is_word[t.i],
            is_propn=t.pos_ == "PROPN",
            is_num=t.like_num or t.pos_ == "NUM",
            particle_of=particle_of.get(t.i),
            zipf=token_zipf(lemmas[t.i], t.text, is_word[t.i]),
            unlisted=is_word[t.i] and _unlisted(t.text, lemmas[t.i], t.pos_ == "PROPN"),
        )
        for t in doc
    ]
    return TextAnalysis(tokens=tokens)


def analyze_texts(lang: str, texts: list[str]) -> list[TextAnalysis]:
    """Analyse texts; raises ``ServiceError(413)`` if one exceeds spaCy's ``max_length`` (E088)."""
    nlp = get_nlp(lang)
    try:
        # Curly apostrophes and quotes -> straight before parsing, so clitics lemmatise ('t -> het).
        # One character for one character: offsets are unchanged.
        clean = [t.translate(_QUOTES) for t in texts]
        docs = list(nlp.pipe(clean, batch_size=64))
        out = [analyze_doc(doc, orig) for doc, orig in zip(docs, texts, strict=True)]
        # The sentence structure's own parse (SyntaxDot), when it is set up (syntax.py).
        from vuurtoren_nlp.syntax import add_syntax

        add_syntax(docs, out, texts)
        return out
    except ValueError as e:
        if "E088" in str(e):
            raise ServiceError(
                413, f"Text too long to analyse (limit {MAX_TEXT_CHARS} characters per text)."
            ) from e
        raise


# --------------------------------------------------------------------------- terms

_REFLEXIVE_MARK = re.compile(r"\(\s*zich\s*\)", re.IGNORECASE)
_BRACKETS = re.compile(r"\([^)]*\)|\[[^\]]*\]")
_GLOSS_SEP = re.compile(r"\s[-–—]\s|=")
_ALT_SEP = re.compile(r"\s*[,;|]\s*")
_SLASH = re.compile(r"\s*/\s*")


def _split_slashes(part: str) -> list[str]:
    """Split ``zij/ze`` into alternatives, but keep ``en/of`` and ``1/2`` whole.

    A slash separates alternatives only when the word before and after it each have >= 2
    letters and are not both function words (``nl.SLASH_FIXED``: en/of, dan/wel, ...).
    """
    pieces = _SLASH.split(part)
    out = [pieces[0]]
    for nxt in pieces[1:]:
        left = out[-1].split()[-1:] or [""]
        right = nxt.split()[:1] or [""]
        both_words = all(sum(c.isalpha() for c in w) >= 2 and w.isalpha() for w in (*left, *right))
        fixed = left[0].lower() in nl.SLASH_FIXED and right[0].lower() in nl.SLASH_FIXED
        if both_words and not fixed:
            out.append(nxt)
        else:
            out[-1] = f"{out[-1]}/{nxt}"
    return out


_ENUMERATOR = re.compile(r"^\s*(?:\d{1,3}[.)]|[-•*])\s+")
_ARTICLE_PAIR = re.compile(r"^\s*(de|het)\s*(?:/|,|\bof\b)\s*(?:de|het)\s+", re.IGNORECASE)


def split_term(raw: str) -> tuple[list[str], bool]:
    """Split a vocabulary field into headword alternatives; detect a ``(zich)`` marker.

    ``"zij, ze"`` -> (["zij", "ze"], False); ``"richten (zich)"`` -> (["richten"], True);
    ``"fietsen (fietste, gefietst)"`` -> (["fietsen"], False); ``"en/of"`` -> (["en/of"], False).
    """
    s = raw.translate(_QUOTES)
    s = _ENUMERATOR.sub("", s)  # "1) lopen", "- lopen"
    s = _ARTICLE_PAIR.sub(r"\1 ", s)  # "de/het deel", "de, het deel" -> "de deel"
    reflexive = bool(_REFLEXIVE_MARK.search(s))
    s = _BRACKETS.sub(" ", s)
    s = s.replace("…", " ").replace("...", " ")
    s = _GLOSS_SEP.split(s, maxsplit=1)[0]
    parts = [p for chunk in _ALT_SEP.split(s) for p in _split_slashes(chunk)]
    alts = [" ".join(a.split()).strip(" .!?:") for a in parts]
    alts = [a for a in alts if a]
    # a bare article is never a headword alternative ("deel, de")
    kept = [a for a in alts if a.lower() not in {"de", "het", "een"}]
    return (kept or alts), reflexive


def _strip_function_words(alt: str) -> tuple[str, str | None, bool]:
    """Remove a leading article / reflexive pronoun. Returns (headword, article, reflexive).

    Fixed expressions that start with an article (``de facto``, see
    ``nl.FIXED_ARTICLE_EXPRESSIONS``) are kept intact.
    """
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
    if (
        len(words) > 1
        and words[0].lower() in nl.ARTICLES
        and " ".join(words[:2]).lower() not in nl.FIXED_ARTICLE_EXPRESSIONS
    ):
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
    then their surface form (see packages/core). Keys use :func:`normalize_key`.
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
        # an article before a lone foreign/symbol-tagged word belongs to the term ("de facto")
        if article and len(words) == 1 and words[0].pos_ in {"SYM", "X"}:
            head, article = f"{article} {head}", None
            doc = nlp(head)
            words = [t for t in doc if not t.is_punct and not t.is_space]
        lemmas, _, _ = _lemmas(doc)
        multiword = len(words) > 1 and " " in head
        if len(words) > 1:
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
