"""Dutch derivations: give an out-of-dictionary word a meaning from its base and affix.

``woordeloos`` is ``woord`` + linking ``e`` + ``-loos`` ("-less"), so it means "wordless";
``onverdedigbaar`` is ``on-`` + (``verdedigen`` + ``-baar``), "undefendable". :func:`derive`
finds such analyses. It is pure: all dictionary access goes through the injected ``resolve``
callable (the same one the compound splitter uses), and an optional ``split`` callable lets a
base be a compound (``vastgoedmakelaar`` + ``-ster``).

Affixes
-------
==========  =====================  ===========  ==========================================
affix       base                   result       English
==========  =====================  ===========  ==========================================
-loos       noun                   adjective    ``word`` -> ``wordless``
-baar       verb stem              adjective    ``work`` -> ``workable``
-lijk       noun, adjective, verb  adjective    ``friend`` -> ``friendly``; verb: ``-able``
-ig/-erig   noun, adjective, verb  adjective    ``powder`` -> ``powdery``
-achtig     noun, adjective        adjective    ``spider-like``, ``reddish``
-vormig     noun                   adjective    ``star-shaped``
-isch       noun                   adjective    ``symphony`` -> ``symphonic``
-heid       adjective              noun (de)    ``pale`` -> ``paleness``
-iteit      adjective              noun (de)    ``original`` -> ``originality``
-ing        verb                   noun (de)    ``book`` -> ``booking``
-er/-aar    verb                   noun (de)    ``stutter`` -> ``stutterer``
-ster       verb stem, -er noun    noun (de)    ``female designer``
-schap      noun                   noun (het)   ``owner`` -> ``ownership``
-dom        noun, adjective        noun (het)   ``pope`` -> ``popedom``
on-         adjective, participle  adjective    ``protected`` -> ``unprotected``
her-        verb, noun             same         ``write`` -> ``rewrite``
==========  =====================  ===========  ==========================================

A number or adjective + noun + ``-ig`` reads as "having": ``tweehandig`` "two-handed",
``koudhartig`` "cold-hearted", ``dertienjarig`` "thirteen-year-old".

``ver-``, ``be-`` and ``ont-`` change a verb's meaning in ways that cannot be guessed, so they are
never split off: a base that starts with them must be a dictionary verb (``verdedigen``).

Spelling. A base is looked up with the spelling changes Dutch makes at a suffix: a linking
``e``/``s``/``en``/``er`` (``woord-e-loos``, ``verkeer-s-loos``), a doubled consonant
(``rott-ig`` -> ``rot``), a single vowel in an open syllable (``slap-e-loos`` -> ``slaap``,
``drie-tal-ig`` -> ``taal``), and ``v``/``z`` for ``f``/``s`` (``slav-en-dom`` -> ``slaaf``).
A verb base before a vowel suffix is the infinitive minus ``-en`` (``lez-er`` -> ``lezen``);
before a consonant suffix it is the present stem (``lees-baar`` -> ``lezen``).

Choice. Every reading that resolves is scored: the base's length, minus a cost for an inflected,
derived or compound base and for a linker. The best reading wins. Bases may be derived
themselves, two levels deep (``on-`` + ``geneesbaar``).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass

from kenning_nlp import english as en
from kenning_nlp.compound import PartEntry, Resolver, real_glosses

MIN_WORD_LEN = 4
MAX_DEPTH = 2

_VOWELS = "aeiouy"
_DEVOICE = {"v": "f", "z": "s"}
_VOICE = {"f": "v", "s": "z"}

# Base costs (subtracted from the base length).
_COST_INFLECTED = 1
_COST_LINKER = 1
_COST_DERIVED = 3
_COST_COMPOUND = 6
_COST_HAVING = 2
"""Cost of an adjective + noun + ``-ig`` reading; with a number it gets a bonus instead."""

# Dutch number words for "having" adjectives (``driefasig`` "three-phased").
_NUMBERS = {
    "een": "one",
    "twee": "two",
    "drie": "three",
    "vier": "four",
    "vijf": "five",
    "zes": "six",
    "zeven": "seven",
    "acht": "eight",
    "negen": "nine",
    "tien": "ten",
    "elf": "eleven",
    "twaalf": "twelve",
    "dertien": "thirteen",
    "veertien": "fourteen",
    "vijftien": "fifteen",
    "zestien": "sixteen",
    "zeventien": "seventeen",
    "achttien": "eighteen",
    "negentien": "nineteen",
    "twintig": "twenty",
    "dertig": "thirty",
    "veertig": "forty",
    "vijftig": "fifty",
    "zestig": "sixty",
    "zeventig": "seventy",
    "tachtig": "eighty",
    "negentig": "ninety",
    "honderd": "hundred",
    "duizend": "thousand",
    "veel": "many",
    "meer": "multi",
    "half": "half",
}

# Words after which an English gloss is cut to its head ("seed inside a fruit" -> "seed").
_PHRASE_BREAKS = frozenset(
    {"of", "in", "inside", "for", "with", "on", "at", "from", "that", "which", "who", "used"}
    | {"by", "to", "as", "or", "into"}
)


@dataclass(frozen=True)
class Derivation:
    """Result of :func:`derive`."""

    pos: str
    article: str | None
    gloss: str
    """English meaning built from the base's meaning (``"wordless"``)."""
    parts: tuple[str, ...]
    """Base lemma(s) and affixes in order: ``("woord", "-loos")``, ``("on-", "verdedigen",
    "-baar")``."""
    score: float
    having: bool = False
    """True for a number/adjective + noun + ``-ig`` reading (``tweehandig``)."""

    @property
    def formed(self) -> str:
        """``"woord + -loos"``."""
        return " + ".join(self.parts)

    @property
    def suffix(self) -> str:
        """The outermost suffix without its dash (``"loos"``), or ``""`` for a prefix."""
        last = self.parts[-1]
        return last[1:] if last.startswith("-") else ""


Splitter = Callable[[str], Derivation | None]
"""Compound analysis of a base, shaped as a :class:`Derivation` (pos, gloss, parts)."""


@dataclass(frozen=True)
class _Base:
    lemma: str
    pos: str
    article: str | None
    english: str
    parts: tuple[str, ...]
    cost: float
    inflected: bool = False


def english_of(entry: PartEntry) -> str | None:
    """Short English for a dictionary entry, preferring one word.

    Within the first sense that gives anything, the first one-word fragment (separated by
    commas or semicolons) wins; else the first fragment of at most three words. A noun's
    fragment is cut to its head (``"seed inside a fruit"`` -> ``"seed"``). Leading
    ``a``/``an``/``the``/``to`` and parentheticals are dropped.
    """
    for gloss in real_glosses(entry.glosses)[:3]:
        text = _strip_parens(gloss).split(":")[0]
        heads: list[str] = []
        for frag in re.split(r"[,;]", text):
            words = frag.strip().split()
            while words and words[0].lower() in {"a", "an", "the", "to"}:
                words = words[1:]
            head: list[str] = []
            for w in words:
                if entry.pos == "noun" and w.lower() in _PHRASE_BREAKS and head:
                    break
                head.append(w)
            if head:
                heads.append(" ".join(head))
        for h in heads:
            if " " not in h:
                return h
        if heads and len(heads[0].split()) <= 3:
            return heads[0]
    return None


def _strip_parens(text: str) -> str:
    out, depth = [], 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
    return " ".join("".join(out).split())


# --------------------------------------------------------------------------- Dutch spelling


def _open_vowel(stem: str) -> str | None:
    """``slap`` -> ``slaap``: the closed-syllable spelling of a single vowel before a consonant."""
    if (
        len(stem) >= 2
        and stem[-1] not in _VOWELS
        and stem[-2] in "aeou"
        and (len(stem) < 3 or stem[-3] not in _VOWELS or stem[-3] == "i" and stem[-4:-2] != "ie")
    ):
        return stem[:-1] + stem[-2] + stem[-1]
    return None


def _spellings(rest: str, vowel_suffix: bool = False) -> list[str]:
    """Dictionary spellings a noun/adjective base may have before a suffix.

    Before a suffix that starts with a vowel, a single ``a``/``o``/``u`` before the last
    consonant is a long vowel (``tal-ig`` is ``taal``; ``tal`` would be ``tallig``).
    """
    out = [rest]
    if vowel_suffix and _open_vowel(rest) and rest[-2] in "aou":
        out = []
    if len(rest) >= 3 and rest[-1] == rest[-2] and rest[-1] not in _VOWELS:
        out.append(rest[:-1])  # rott -> rot
    out.append(rest + "e")  # fas -> fase
    devoiced = rest[:-1] + _DEVOICE[rest[-1]] if rest[-1:] in _DEVOICE else None
    for s in (rest, devoiced):
        if s is None:
            continue
        if s != rest:
            out.append(s)
        lengthened = _open_vowel(s)
        if lengthened:
            out.append(lengthened)  # slap -> slaap, slav -> slaaf
    return list(dict.fromkeys(out))


def _participle(form: str) -> bool:
    """True if a verb form looks like a participle (``beschermd``, ``gezoet``, ``bestaand``)."""
    if form.endswith("nd"):
        return True
    return form.endswith(("d", "t", "en")) and form.startswith(
        ("ge", "be", "ver", "ont", "her", "er")
    )


_PARTICLES = frozenset({"out", "up", "down", "off", "on", "in", "away", "back", "over", "around"})


def _verb_phrase(english: str) -> str | None:
    """The English verb to inflect: one word, or a verb + particle (``dig up``); else None."""
    words = english.split()
    if len(words) == 1 or (len(words) == 2 and words[1] in _PARTICLES):
        return english
    return None


def dutch_stems(infinitive: str) -> set[str]:
    """Present stems of a Dutch infinitive (``halen`` -> ``haal``, ``stappen`` -> ``stap``).

    Stricter than :func:`kenning_nlp.compound.verb_stems`: ``hal`` is no stem of ``halen``. An
    ``e`` or ``o`` before the last consonant may be a short vowel or a schwa (``wandelen`` ->
    ``wandel``, ``komen`` -> ``kom``), so both spellings are kept for those.
    """
    if not infinitive.endswith("n") or len(infinitive) < 3:
        return set()
    if not infinitive.endswith("en") or (len(infinitive) <= 5 and infinitive[-3] in _VOWELS):
        return {infinitive[:-1]}  # doen -> doe, zien -> zie
    x = infinitive[:-2]
    if len(x) >= 2 and x[-1] == x[-2] and x[-1] not in _VOWELS:
        return {x[:-1]}
    y = x[:-1] + _DEVOICE.get(x[-1], x[-1])
    lengthened = _open_vowel(y)
    if lengthened is None:
        return {y}
    if y[-2] in "eo":
        return {y, lengthened}
    return {lengthened}


def _infinitives_of_stem(stem: str) -> list[str]:
    """Infinitives whose present stem may be ``stem`` (checked with :func:`dutch_stems`)."""
    out = [stem + "en", stem + "n"]
    if len(stem) >= 3 and stem[-2] == stem[-3] and stem[-2] in "aeou":
        short = stem[:-2] + stem[-1]  # haal -> hal, lees -> les
        out += [short + "en", short[:-1] + _VOICE.get(short[-1], short[-1]) + "en"]
    if stem[-1:] in _VOICE:
        out.append(stem[:-1] + _VOICE[stem[-1]] + "en")  # beschrijf -> beschrijven
    if len(stem) >= 2 and stem[-1] not in _VOWELS and stem[-2] in _VOWELS:
        out.append(stem + stem[-1] + "en")  # stap -> stappen
    return [inf for inf in dict.fromkeys(out) if stem in dutch_stems(inf)]


# --------------------------------------------------------------------------- the search


class _Deriver:
    def __init__(self, resolve: Resolver, split: Splitter | None) -> None:
        self.resolve = resolve
        self.split = split
        self._memo: dict[tuple[str, int], Derivation | None] = {}

    # ---- bases

    def _readings(self, text: str, pos: tuple[str, ...]) -> Iterator[_Base]:
        for e in self.resolve(text):
            if e.pos not in pos or not real_glosses(e.glosses):
                continue
            english = english_of(e)
            if english is None:
                continue
            cost = _COST_INFLECTED if e.inflected else 0
            yield _Base(e.lemma, e.pos, e.article, english, (e.lemma,), cost, e.inflected)

    def bases(self, text: str, pos: tuple[str, ...], depth: int) -> list[_Base]:
        """Readings of ``text`` as a base: dictionary, else derived, else compound."""
        if len(text) < 3:
            return [b for b in self._readings(text, pos) if b.pos == "noun" and not b.inflected]
        found = list(self._readings(text, pos))
        if found:
            return found
        if depth > 0:
            d = self.derive(text, depth - 1)
            if d is not None and d.pos in pos:
                cost = _COST_DERIVED + (len(text) - d.score) / 2
                return [_Base(text, d.pos, d.article, d.gloss, d.parts, cost)]
        if self.split is not None and len(text) >= 7:
            c = self.split(text)
            if c is not None and c.pos in pos:
                return [_Base(text, c.pos, c.article, c.gloss, c.parts, _COST_COMPOUND)]
        return []

    def verb_bases(self, stems: list[str], depth: int, *, stem: bool) -> list[tuple[_Base, str]]:
        """Verb readings: ``stem=True`` treats each text as a present stem, else as the
        infinitive minus ``-en``."""
        out: list[tuple[_Base, str]] = []
        for s in stems:
            infinitives = _infinitives_of_stem(s) if stem else [s + "en"]
            for inf in infinitives:
                for b in self._readings(inf, ("verb",)):
                    if not b.inflected:
                        out.append((b, s))
        return out

    # ---- analyses

    def derive(self, word: str, depth: int) -> Derivation | None:
        key = (word, depth)
        if key not in self._memo:
            self._memo[key] = None  # guards against cycles
            self._memo[key] = self._derive(word, depth)
        return self._memo[key]

    def _derive(self, word: str, depth: int) -> Derivation | None:
        if len(word) < MIN_WORD_LEN:
            return None
        cands = [*self._suffixes(word, depth), *self._prefixes(word, depth)]
        if not cands:
            return None
        return max(cands, key=lambda d: d.score)

    def _make(
        self,
        base: _Base,
        base_text: str,
        affix: str,
        gloss: str | None,
        pos: str,
        article: str | None,
        extra_cost: float = 0,
    ) -> Derivation | None:
        if not gloss:
            return None
        parts = (affix, *base.parts) if affix.endswith("-") else (*base.parts, affix)
        score = len(base_text) - base.cost - extra_cost
        return Derivation(pos, article, gloss, parts, score)

    def _suffixes(self, word: str, depth: int) -> Iterator[Derivation]:
        for spec in _SUFFIXES:
            if not word.endswith(spec.form) or len(word) - len(spec.form) < 2:
                continue
            stem_all = word[: -len(spec.form)]
            for linker in spec.linkers:
                if linker and not stem_all.endswith(linker):
                    continue
                rest = stem_all[: len(stem_all) - len(linker)]
                if len(rest) < 2:
                    continue
                cost = _COST_LINKER if linker else 0
                yield from spec.analyse(self, rest, depth, cost)
        yield from self._having(word, depth)

    def _having(self, word: str, depth: int) -> Iterator[Derivation]:
        """Number/adjective + noun + ``-ig``: ``tweehandig`` -> "two-handed"."""
        if not word.endswith("ig"):
            return
        rest = word[:-2]
        for i in range(2, len(rest) - 1):
            mod, noun = rest[:i], rest[i:]
            mod_en = _NUMBERS.get(mod)
            bonus = 1.0
            if mod_en is None:
                # An adjective + an "-ig" adjective is a compound (dol + gelukkig), not this.
                if any(e.pos == "adj" for e in self.resolve(noun + "ig")):
                    continue
                adj = next(iter(self._readings(mod, ("adj",))), None)
                if adj is None or adj.inflected or " " in adj.english:
                    continue
                mod_en, bonus = adj.english, -_COST_HAVING
            for spelling in _spellings(noun, vowel_suffix=True):
                for b in self._readings(spelling, ("noun",)):
                    if b.inflected or " " in b.english:
                        continue
                    tail = "year-old" if b.lemma == "jaar" else en.having(b.english)
                    gloss = f"{mod_en}-{tail}"
                    parts = (mod, b.lemma, "-ig")
                    score = len(rest) - b.cost + bonus
                    yield Derivation("adj", None, gloss, parts, score, having=True)

    def _prefixes(self, word: str, depth: int) -> Iterator[Derivation]:
        if word.startswith("on") and len(word) >= 6:
            rest = word[2:]
            for b in self.bases(rest, ("adj", "verb"), depth):
                if b.pos == "verb":
                    verb = _verb_phrase(b.english)
                    if not b.inflected or verb is None or not _participle(rest):
                        continue  # on- + infinitive or finite verb is no Dutch word
                    form = en.ing(verb) if rest.endswith("nd") else en.participle(verb)
                else:
                    form = b.english
                d = self._make(b, rest, "on-", en.prefixed("un", form), "adj", None)
                if d:
                    yield d
        if word.startswith("her") and len(word) >= 7:
            rest = word[3:]
            for b in self.bases(rest, ("verb", "noun"), depth):
                if b.pos == "noun" and len(rest) < 4:
                    continue
                article = b.article if b.pos == "noun" else None
                d = self._make(b, rest, "her-", en.prefixed("re", b.english), b.pos, article)
                if d:
                    yield d


# --------------------------------------------------------------------------- suffix rules


GlossFn = Callable[[_Base, str], str | None]
"""(base, the word minus suffix and linker) -> English."""


@dataclass(frozen=True)
class _Suffix:
    form: str
    pos: str
    article: str | None
    nominal: tuple[str, ...]
    """POS of non-verb bases (``noun``, ``adj``)."""
    verb: str | None
    """``"stem"`` (consonant suffix: present stem), ``"inf"`` (vowel suffix: infinitive minus
    ``-en``) or None (no verb bases)."""
    gloss: GlossFn
    linkers: tuple[str, ...] = ("",)
    extra: Callable[[str], list[str]] | None = None
    """More base spellings to try (``-isch``, ``-iteit``)."""
    vowel: bool = False
    """The suffix starts a new syllable with a vowel (``-ig``, not ``-achtig``)."""

    def analyse(self, d: _Deriver, rest: str, depth: int, cost: float) -> Iterator[Derivation]:
        label = "-" + self.form
        spellings = _spellings(rest, self.vowel) + (self.extra(rest) if self.extra else [])
        for text in dict.fromkeys(spellings):
            if not self.nominal:
                break
            for b in d.bases(text, self.nominal, depth):
                made = d._make(b, text, label, self.gloss(b, rest), self.pos, self.article, cost)
                if made:
                    yield made
        if self.verb:
            texts = [rest] if self.verb == "inf" else _spellings(rest)[:1]
            for b, text in d.verb_bases(texts, depth, stem=self.verb == "stem"):
                made = d._make(b, text, label, self.gloss(b, rest), self.pos, self.article, cost)
                if made:
                    yield made


def _single(fn: Callable[[str], str]) -> GlossFn:
    """Apply a one-word English rule; phrases fall back to None."""
    return lambda b, _: None if " " in b.english else fn(b.english)


def _able(b: _Base, _: str = "") -> str | None:
    verb = _verb_phrase(b.english)
    return None if verb is None else en.able(verb.split()[0])


def _ing(b: _Base, _: str = "") -> str | None:
    verb = _verb_phrase(b.english)
    return None if verb is None else en.ing(verb)


def _ness(b: _Base, _: str = "") -> str | None:
    if b.pos == "verb":  # a participle used as an adjective (uitgestrekt)
        verb = _verb_phrase(b.english)
        if not b.inflected or verb is None or " " in verb:
            return None
        return en.ness(en.participle(verb))
    return None if " " in b.english else en.ness(b.english)


_ABSTRACT = ("ness", "ity", "tion", "sion", "ment", "ship", "ism", "ance", "ence", "ing")


def _less(b: _Base, _: str = "") -> str:
    return f"without {b.english}" if " " in b.english else en.less(b.english)


def _lijk(b: _Base, _: str = "") -> str | None:
    if b.pos == "verb":
        return _able(b)
    if " " in b.english:
        return None
    return en.ly(b.english)


def _ig(b: _Base, _: str = "") -> str | None:
    if b.pos == "adj":
        return b.english
    if " " in b.english or b.english.endswith(_ABSTRACT):
        return None
    return en.y(b.english)


def _achtig(b: _Base, _: str = "") -> str | None:
    if " " in b.english:
        return None
    return en.ish(b.english) if b.pos == "adj" else f"{b.english}-like"


def _agent(b: _Base, _: str = "") -> str | None:
    verb = _verb_phrase(b.english)
    return None if verb is None else en.agent(verb)


def _ster_extra(rest: str) -> list[str]:
    """``medewerk-ster`` -> ``medewerker``; not ``hal-ster`` -> ``haler`` (that is ``haal``)."""
    return [] if _open_vowel(rest) and rest[-2] in "aou" else [rest + "er"]


_AGENT_ENDINGS = ("aar", "er", "eur", "ier", "ist", "ant", "ent")


def _ster(b: _Base, _: str = "") -> str | None:
    """Female agent: from a verb stem (``naai-ster``) or an agent noun (``leugenaar-ster``)."""
    if b.pos == "verb":
        agent = _agent(b)
    else:
        agent = b.english if b.lemma.endswith(_AGENT_ENDINGS) else None
    return None if agent is None else f"female {agent}"


def _isch_extra(rest: str) -> list[str]:
    out = [rest + "ie", rest + "e"]
    if rest.endswith("t"):
        out.append(rest[:-1])  # melodramat -> melodrama
    if rest.endswith("at"):
        out += _spellings(rest[:-2])  # idiomat -> idioom
    return out


def _isch(b: _Base, rest: str = "") -> str | None:
    if " " in b.english:
        return None
    if rest.endswith("at") and not b.lemma.endswith(("at", "a")):
        return b.english + "atic"  # idioom + at + isch: idiomatic
    return en.ic(b.english)


_ITEIT_ENDINGS = (("al", "aal"), ("al", "eel"), ("iv", "ief"), ("os", "eus"), ("il", "iel"))
_ITEIT_ENDINGS += (("bil", "bel"), ("ar", "air"), ("ul", "uul"))


def _iteit_extra(rest: str) -> list[str]:
    return [rest[: -len(a)] + b for a, b in _ITEIT_ENDINGS if rest.endswith(a)]


def _schap(b: _Base, _: str = "") -> str | None:
    return None if " " in b.english else f"{b.english}ship"


def _dom(b: _Base, _: str = "") -> str | None:
    return None if " " in b.english else f"{b.english}dom"


def _shaped(b: _Base, _: str = "") -> str | None:
    return None if " " in b.english else f"{b.english}-shaped"


_ALL_LINKERS = ("", "e", "s", "en", "er")

# Longer suffixes first; every matching suffix is tried and the best-scoring reading wins.
_SUFFIXES: tuple[_Suffix, ...] = (
    _Suffix("achtig", "adj", None, ("noun", "adj"), None, _achtig, _ALL_LINKERS),
    _Suffix("vormig", "adj", None, ("noun",), None, _shaped, ("", "s", "e", "en")),
    _Suffix("iteit", "noun", "de", ("adj",), None, _single(en.ity), extra=_iteit_extra, vowel=True),
    _Suffix("schap", "noun", "het", ("noun",), None, _schap),
    _Suffix("erig", "adj", None, ("noun", "adj"), "inf", _ig, vowel=True),
    _Suffix("heid", "noun", "de", ("adj", "verb"), None, _ness),
    _Suffix("loos", "adj", None, ("noun",), None, _less, _ALL_LINKERS),
    _Suffix("baar", "adj", None, (), "stem", _able),
    _Suffix("lijk", "adj", None, ("noun", "adj"), "stem", _lijk, ("", "e")),
    _Suffix("isch", "adj", None, ("noun",), None, _isch, extra=_isch_extra, vowel=True),
    _Suffix("ster", "noun", "de", ("noun",), "stem", _ster, extra=_ster_extra),
    _Suffix("dom", "noun", "het", ("noun", "adj"), None, _dom, ("", "en")),
    _Suffix("ing", "noun", "de", (), "inf", _ing, vowel=True),
    _Suffix("aar", "noun", "de", (), "inf", _agent, vowel=True),
    _Suffix("ig", "adj", None, ("noun", "adj"), "inf", _ig, vowel=True),
    _Suffix("er", "noun", "de", (), "inf", _agent, vowel=True),
)


def derive(
    word: str,
    resolve: Resolver,
    *,
    split: Splitter | None = None,
    depth: int = MAX_DEPTH,
) -> Derivation | None:
    """Best derivational analysis of ``word``, or None.

    ``resolve(text)`` returns the :class:`PartEntry` readings of a lowercase string (``()`` if
    unknown). ``split(text)``, if given, analyses a base as a compound. The caller must not call
    this for words that have an entry of their own. Non-alphabetic and all-caps strings are
    never analysed.
    """
    if not word.isalpha() or word.isupper():
        return None
    return _Deriver(resolve, split).derive(word.lower(), depth)
