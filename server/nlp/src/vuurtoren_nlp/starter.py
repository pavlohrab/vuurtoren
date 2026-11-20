"""The starter word list: the most common Dutch lemmas, with a short gloss and an example.

Build-time only (``scripts/build_starter.py`` writes ``content/starter/nl-5000.json``); the
server does not use it. This module holds the pure rules so they can be tested on a tiny fixture:

* :func:`short_gloss`, :func:`form_of_target`, :func:`meaning_senses` and :func:`gloss_for` are
  a port of ``packages/core/src/reading/gloss.ts`` and of the gloss choice in
  ``apps/web/src/services/liveDictionary.ts``, so a starter card shows the meaning the reader
  shows. Both test suites run the cases in ``packages/core/src/reading/fixtures/gloss-cases.json``;
  the particle glosses are shared through ``packages/core/src/reading/particle-glosses.json``.
* :func:`merge_forms` turns ranked word forms into ranked lemmas (frequency summed).
* :func:`drop_reason` is the filter (proper nouns, numbers, letters, abbreviations, noise).
* :func:`pick_sentence` chooses the example sentence.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

# ---- gloss.ts ------------------------------------------------------------------------------

MAX_CHARS = 32
MAX_ALTERNATIVES = 2
MAX_WORDS = 4

_BRACKETS = re.compile(r"\s*[(\[][^)\]]*[)\]]")
_LEAD_EG = re.compile(r"^\s*(e\.g\.|i\.e\.)\s*", re.IGNORECASE)
_TRAIL = re.compile(r"[.,\s]+$")
# A letter is [^\W\d_] in Python's re (JavaScript: \p{L}).
_L = r"(?:[^\W\d_]|[\s/'’-])"
_FORM_OF_ANY = re.compile(
    rf"^{_L}*?\b(?:form|singular|plural|participle|person|inflection|diminutive|comparative"
    rf"|superlative|imperative|infinitive)\b{_L}*?\bof\s+(?:the\s+)?((?:[^\W\d_]|['’-])+)",
    re.IGNORECASE,
)
# liveDictionary.ts: Wiktionary form-of senses ("inflection of fietsen: …") are noise as glosses.
_FORM_OF = re.compile(
    r"^(inflection|plural|diminutive|singular|past|present|feminine|comparative|superlative)"
    r"[^:]* of ",
    re.IGNORECASE,
)

# liveDictionary.ts KAIKKI_POS: spaCy universal POS -> Wiktionary part of speech.
KAIKKI_POS: dict[str, list[str]] = {
    "NOUN": ["noun"],
    "PROPN": ["name", "noun"],
    "VERB": ["verb"],
    "AUX": ["verb"],
    "ADJ": ["adj"],
    "ADV": ["adv"],
    "PRON": ["pron"],
    "DET": ["det", "article", "pron"],
    "ADP": ["prep", "postp"],
    "NUM": ["num"],
    "CCONJ": ["conj"],
    "SCONJ": ["conj"],
    "INTJ": ["intj"],
}


def _strip_brackets(s: str) -> str:
    return _BRACKETS.sub("", s)


def _clean(s: str) -> str:
    s = _LEAD_EG.sub("", s, count=1)
    s = re.sub(r"\s+", " ", s)
    return _TRAIL.sub("", s).strip()


def _is_short(s: str) -> bool:
    return s != "" and len(s.split()) <= MAX_WORDS and len(s) <= MAX_CHARS


def gloss_head(sense: str) -> str:
    """One sense reduced to its head: no brackets, nothing after ";" or ":"."""
    return _clean(re.split(r"[;:]", _strip_brackets(sense))[0])


def _short_part(sense: str) -> str | None:
    lead = _strip_brackets(sense).split(":")[0]
    for raw in lead.split(";"):
        part = _clean(",".join(raw.split(",")[:MAX_ALTERNATIVES]))
        if _is_short(part):
            return part
        cut = _clean(part.split(",")[0])
        if _is_short(cut):
            return cut
    return None


def short_gloss(senses: Sequence[str], max_n: int = 1) -> str:
    """Up to ``max_n`` short meanings joined with ", " (``shortGloss`` in gloss.ts)."""
    out: list[str] = []
    for s in senses:
        part = _short_part(s)
        if part and part not in out:
            out.append(part)
        if len(out) >= max_n:
            break
    if out:
        return ", ".join(out)
    first = gloss_head(senses[0] if senses else "")
    return first if len(first) <= MAX_CHARS else first[: MAX_CHARS - 1].rstrip() + "…"


def form_of_target(sense: str) -> str | None:
    """The word a form-of sense points to ("unstressed form of zij" -> "zij"), or None."""
    m = _FORM_OF_ANY.match(_strip_brackets(sense).strip())
    return m.group(1) if m else None


def meaning_senses(senses: Iterable[str]) -> list[str]:
    """The senses that carry a meaning, without the form-of descriptions."""
    return [s for s in senses if form_of_target(s) is None]


@dataclass(frozen=True)
class Entry:
    """One dictionary entry (a row of ``entries``)."""

    pos: str
    article: str | None
    glosses: tuple[str, ...]
    word: str = ""
    """The headword as written (case kept: "Engels", "september")."""


def order_by_pos(entries: Sequence[Entry], pos: str | None) -> list[Entry]:
    """Entries whose part of speech fits the spaCy ``pos`` first (``orderByPos``)."""
    wanted = KAIKKI_POS.get(pos or "", [])
    return [e for e in entries if e.pos in wanted] + [e for e in entries if e.pos not in wanted]


def gloss_for(
    lemma: str,
    pos: str | None,
    lookup: Mapping[str, Sequence[Entry]],
    particles: Mapping[str, str],
) -> str:
    """The reader's inline gloss of a lemma (``lookupGlosses`` in liveDictionary.ts)."""
    fixed = particles.get(lemma)
    if fixed:
        return fixed

    def senses(word: str, p: str | None) -> list[str]:
        return [g for e in order_by_pos(lookup.get(word, ()), p) for g in e.glosses]

    every = senses(lemma, pos)
    target = None
    if not meaning_senses(every):
        target = next((t for t in map(form_of_target, every) if t is not None), None)
    own = meaning_senses(s for s in every if not _FORM_OF.match(s))
    return short_gloss(own if own or not target else meaning_senses(senses(target, None)))


_INFLECTION = re.compile(
    r"^(inflection|plural|diminutive|past participle|present participle|comparative|superlative"
    r"|(?:[\w/-]+ )*(singular|plural) (past|present))\b[^:]*? of (?P<target>(?:[^\W\d_]|['’-])+)",
    re.IGNORECASE,
)
CONTENT_POS = frozenset({"NOUN", "VERB", "ADJ"})


def inflection_target(entries: Sequence[Entry]) -> str | None:
    """The lemma a word is only an inflection of ("huishoudens" -> "huishouden"), or None.

    Only when every sense of every entry is an inflection; "ze" (unstressed form of zij) and
    "het" (neuter singular of de) are words of their own.
    """
    senses = [g for e in entries for g in e.glosses]
    found = [_INFLECTION.match(g) for g in senses]
    if not senses or not all(found):
        return None
    return found[0].group("target").lower() if found[0] else None


# ---- ranking -------------------------------------------------------------------------------


@dataclass
class Lemma:
    """A lemma with its summed frequency and the parts of speech its forms were read as."""

    lemma: str
    freq: float = 0.0
    pos: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    forms: dict[str, float] = field(default_factory=lambda: defaultdict(float))

    def main_pos(self) -> str:
        return max(sorted(self.pos), key=lambda p: self.pos[p])


def merge_forms(
    forms: Sequence[tuple[str, float]],
    readings: Mapping[str, Mapping[tuple[str, str], float]],
) -> list[Lemma]:
    """Ranked forms -> ranked lemmas.

    ``forms`` are ``(form, frequency)``; ``readings[form]`` counts how the form was read in
    context as ``(lemma, POS)``. Each form's frequency is shared among its readings in
    proportion to those counts and summed per lemma. Proper-noun readings (POS ``PROPN``) go to
    the lemma too, so :func:`drop_reason` can see that it is mostly a name. Most frequent first;
    ties by lemma.
    """
    out: dict[str, Lemma] = {}
    for form, freq in forms:
        counts = readings.get(form) or {}
        total = sum(counts.values())
        if total <= 0:
            continue
        for (lemma, pos), n in sorted(counts.items()):
            share = freq * n / total
            item = out.setdefault(lemma, Lemma(lemma))
            item.freq += share
            item.pos[pos] += share
            item.forms[form] += share
    return sorted(out.values(), key=lambda x: (-x.freq, x.lemma))


# ---- filters -------------------------------------------------------------------------------

# Interjections a beginner needs; other interjections ("haha", "eh", "hm") are noise.
KEEP_INTERJECTIONS = frozenset(
    [
        "ja",
        "nee",
        "hallo",
        "hoi",
        "dag",
        "doei",
        "dank",
        "bedankt",
        "alsjeblieft",
        "alstublieft",
        "oké",
        "sorry",
        "welkom",
        "jammer",
        "gezondheid",
        "proost",
        "help",
        "pardon",
        "nou",
        "hè",
        "hoor",
    ]
)
# Single letters that are words.
KEEP_LETTERS = frozenset({"u"})
_ABBREV = re.compile(
    r"^(abbreviation|initialism|acronym|clipping|symbol)\b[^:]*\bof\b", re.IGNORECASE
)
_NAME_SENSE = re.compile(r"^an? ([\w ]+ )?(given name|surname|placename|place name)\b", re.I)
PROPER_SHARE = 0.5
"""A lemma read as a proper noun more often than this is a name, unless the dictionary has it
as an ordinary word: lowercase ("september", "maandag", "god") or a capitalised adjective or
noun that is not a name ("Engels", "Nederlands")."""
NAME_PARTS = frozenset(
    [
        "den",
        "parijs",
        "zweden",
        "haag",
        "la",
        "le",
        "el",
        "san",
        "da",
        "du",
        "di",
        "sint",
        "mark",
        "frank",
        "max",
        "bill",
        "rob",
        "don",
        "will",
        "john",
        "tom",
        "ma",
    ]
)
"""Parts of names that are also rare ordinary words ("Den Haag": den "fir", haag "hedge")."""
ENGLISH_MARGIN = 0.5
"""A word this much more frequent in English (Zipf) that Dutch sentences hardly use is English."""


def drop_reason(
    item: Lemma,
    entries: Sequence[Entry],
    *,
    zipf_en: float,
    zipf_nl: float,
    corpus_count: int,
) -> str | None:
    """Why a lemma stays out of the list, or None to keep it.

    ``entries`` are its dictionary entries; ``zipf_en``/``zipf_nl`` the wordfreq Zipf values
    of the lemma in English and Dutch; ``corpus_count`` how often its forms were read as it in
    the Dutch sentences (Tatoeba), names included.
    """
    w = item.lemma
    pos = item.main_pos()
    total = sum(item.pos.values()) or 1.0
    if any(ch.isdigit() for ch in w):
        return "number"
    if not any(ch.isalpha() for ch in w):
        return "symbol"
    if len(w) == 1 and w not in KEEP_LETTERS:
        return "letter"
    if w in NAME_PARTS:
        return "proper noun"
    if item.pos.get("PROPN", 0.0) / total > PROPER_SHARE and not any(
        e.pos not in {"name", "character", "symbol", "punct"}
        and (e.word == w or (e.word[:1].isupper() and e.pos in {"adj", "noun"}))
        for e in entries
    ):
        return "proper noun"
    if pos in {"X", "SYM", "PUNCT"}:
        return "not a word"
    real = [e for e in entries if e.pos not in {"name", "character", "symbol", "punct"}]
    meanings = [g for e in real for g in e.glosses if not _NAME_SENSE.match(g)]
    if not meanings:
        return "no dictionary entry"
    if all(_ABBREV.match(g) for g in meanings) and (w.isupper() or len(w) <= 4):
        return "abbreviation"
    if pos == "INTJ" and w not in KEEP_INTERJECTIONS:
        return "interjection"
    if corpus_count == 0 and len(w) <= 3 and not any(e.pos == "num" for e in entries):
        return "noise"
    if zipf_en - zipf_nl >= ENGLISH_MARGIN and corpus_count < 3:
        return "English"
    return None


# ---- example sentence ----------------------------------------------------------------------


@dataclass(frozen=True)
class Sentence:
    """A Tatoeba sentence with its English, word count, practice score and lemmas."""

    id: int
    text: str
    translation: str
    n_words: int
    score: float
    lemmas: tuple[str, ...]
    exact: bool = False
    """The word appears in the sentence as the lemma itself (not "beter" for goed)."""


SENTENCE_MIN_WORDS = 5
SENTENCE_MAX_WORDS = 10
EASIER_BY = 1000
"""The other words of a preferred sentence rank at most this far after the word itself."""


def pick_sentence(
    lemma: str, rank: int, candidates: Iterable[Sentence], ranks: Mapping[str, int]
) -> Sentence | None:
    """The example for ``lemma`` (rank ``rank``, 1-based).

    Preferred: 5-10 words whose other lemmas all rank at most ``rank + 1000`` (a lemma outside
    the list counts as too rare), with the word written as its lemma; the lowest practice score,
    then the fewest words, then the lowest id. Otherwise the shortest sentence (the lemma
    written first, then score, then id).
    """
    pool = sorted(candidates, key=lambda s: (not s.exact, s.n_words, s.score, s.id))
    if not pool:
        return None
    limit = rank + EASIER_BY

    def easy(s: Sentence) -> bool:
        return SENTENCE_MIN_WORDS <= s.n_words <= SENTENCE_MAX_WORDS and all(
            ranks.get(x, 1 << 30) <= limit for x in s.lemmas if x != lemma
        )

    good = [s for s in pool if easy(s)]
    if good:
        return min(good, key=lambda s: (not s.exact, s.score, s.n_words, s.id))
    return pool[0]
