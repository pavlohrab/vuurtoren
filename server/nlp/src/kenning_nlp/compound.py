"""Dutch compound analysis: give an out-of-dictionary word a meaning from its parts.

Dutch glues nouns together (``souvenir`` + ``winkel``), sometimes with a linking element
(``fiets`` + ``en`` + ``stalling``, ``gemeente`` + ``raad`` + ``s`` + ``verkiezing`` + ``en``).
:func:`split_compound` finds the best split of a word into 2-3 dictionary parts. It is pure:
all dictionary access goes through the injected ``resolve`` callable.

Rules
-----
* Word >= :data:`MIN_WORD_LEN` letters (3 parts: >= :data:`MIN_WORD_LEN_3_PARTS`); parts >=
  :data:`MIN_PART_LEN` letters (linkers excepted); an inflected head needs 4 letters.
* Prefix-like words (``ver``, ``aan``, ...) and verb forms that are no present stem are no
  modifiers; a verb modifier needs a head of >= 4 letters (``klaag`` + ``den`` is no compound).
* Linking elements between parts: :data:`LINKERS` (``""``, ``s``, ``e``, ``en``, ``er``).
* The head (last part) is preferably a noun, lemma or inflected (``verkiezingen``); an adjective
  or verb infinitive is accepted at a penalty. Modifiers may be nouns, adjectives or verb stems
  (reached through the forms table), lemma or inflected. Names are never parts.
* Best split = highest ``sum(len(part)**2)`` (long parts win) minus penalties per extra part,
  per linker and for less typical readings; so fewer, longer parts win.
* Title-case words (possible names) need >= 9 letters, two parts >= 4 letters and a noun head.
* The compound's article/gender is the head's (Dutch rule).

Gloss format: ``"<english of each part> (<dutch lemmas joined by ' + '>)"``, e.g.
``"souvenir shop (souvenir + winkel)"``. English of a part = a short (<= 3 words) non-form-of
gloss cut at the first comma/parenthetical/colon (see :func:`short_gloss`); if no sense is that
short the Dutch lemma is used instead (``"bicycle stalling (fiets + stalling)"``). An inflected
plural head is pluralised: ``"municipality council elections (gemeente + raad + verkiezing)"``.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass

MIN_WORD_LEN = 7
MIN_PART_LEN = 3
MAX_PARTS = 3
MIN_WORD_LEN_3_PARTS = 10
MAX_LOOKUPS = 400
"""Cap on distinct dictionary lookups per analysed word."""
LINKERS: tuple[str, ...] = ("", "s", "e", "en", "er")
_LINKER_COST = {"": 0, "s": 2, "e": 3, "en": 3, "er": 4}
_PART_PENALTY = 25
# (pos, inflected) -> cost; absent combinations are not usable in that role.
_HEAD_COST = {("noun", False): 0, ("noun", True): 2, ("adj", False): 10, ("verb", False): 15}
_MOD_COST = {
    ("noun", False): 0,
    ("noun", True): 3,
    ("adj", False): 2,
    ("adj", True): 6,
    ("verb", False): 4,
    ("verb", True): 4,
}

# Closed-class words / verb prefixes that are dictionary "nouns" or "adjectives" but are almost
# never the modifier of a real compound (``verwacht`` != ver + wacht, ``bijstand`` has an entry).
_NOT_MODIFIERS = frozenset(
    {"ver", "be", "ge", "ont", "her", "er", "aan", "bij", "acht", "met", "tot", "van", "voor"}
    | {"uit", "over", "onder", "achter", "tegen", "toe", "af", "op", "in", "om", "na", "te"}
    | {"door", "mis"}
)

# Glosses that merely point at another lemma ("plural of kost", "inflection of winkelen: ...").
_FORM_OF = re.compile(
    r"^(?:[\w/-]+ ){0,5}?(?:inflection|plural|diminutive|participle|form|spelling|comparative"
    r"|superlative|singular|genitive|dative|tense|indicative|subjunctive|imperative|infinitive"
    r"|variant|abbreviation|contraction|misspelling|clipping|alternative) of\b",
    re.I,
)


@dataclass(frozen=True)
class PartEntry:
    """One reading of a candidate part (a lemma entry, directly or via the forms table)."""

    lemma: str
    pos: str
    article: str | None
    glosses: tuple[str, ...]
    inflected: bool = False
    """True if the part is an inflected form of ``lemma`` (e.g. a plural), not the lemma."""


Resolver = Callable[[str], Sequence[PartEntry]]
_Cost = dict[tuple[str, bool], int]
_Split = tuple[float, tuple["Part", ...]]


@dataclass(frozen=True)
class Part:
    """A resolved compound part."""

    part: str
    """Surface text as it appears in the word."""
    entry: PartEntry
    linker: str = ""
    """Linking element that follows this part (``""`` if none)."""


@dataclass(frozen=True)
class CompoundAnalysis:
    """Result of :func:`split_compound`."""

    parts: tuple[Part, ...]
    score: float
    pos: str
    article: str | None
    gloss: str
    """Readable gloss, see the module docstring."""
    part_glosses: list[dict[str, str | None]]
    """``[{"part": surface, "gloss": first full gloss of the part or None}]``."""


def is_form_of_gloss(gloss: str) -> bool:
    """True for glosses that only describe an inflected form of another word."""
    return bool(_FORM_OF.match(gloss))


def real_glosses(glosses: Sequence[str]) -> list[str]:
    """Glosses that are not form-of descriptions."""
    return [g for g in glosses if not is_form_of_gloss(g)]


def part_gloss(entry: PartEntry) -> str | None:
    """First real gloss without parentheticals / sub-sense suffix (``"shop, store"``)."""
    glosses = real_glosses(entry.glosses)
    if not glosses:
        return None
    text = re.sub(r"\s*\([^)]*\)", "", glosses[0]).split(";")[0].split(":")[0].strip(" ,")
    return text or None


def short_gloss(entry: PartEntry) -> str | None:
    """Short English rendering of a part, or None if no sense is short enough.

    The first of the first three real glosses that, cut at its first comma / parenthesis /
    colon and stripped of a leading article, has at most 3 words (``"shop, store"`` -> ``shop``).
    """
    for gloss in real_glosses(entry.glosses)[:3]:
        text = re.sub(r"\s*\([^)]*\)", "", gloss).split(";")[0].split(":")[0].split(",")[0]
        text = re.sub(r"^(?:a|an|the|to)\s+", "", text.strip(), flags=re.I)
        if text and len(text.split()) <= 3:
            return text
    return None


def _pluralise(text: str) -> str:
    """Naive English plural of the last word of ``text``."""
    if text.endswith(("s", "x", "ch", "sh")):
        return text + "es"
    if text.endswith("y") and text[-2:-1] not in "aeiou":
        return text[:-1] + "ies"
    return text + "s"


def verb_stems(infinitive: str) -> set[str]:
    """Spellings of the present stem of a Dutch infinitive (``klagen`` -> ``klaag``).

    Over-generates slightly (both spelling variants); used to accept a verb form as a compound
    modifier only when it is a stem, not e.g. a past plural (``tegen`` of ``tijgen``).
    """
    base = infinitive[:-2] if infinitive.endswith("en") else infinitive[:-1]
    out = {base, infinitive[:-1]}
    if (
        len(base) >= 3
        and base[-1] not in "aeiou"
        and base[-2] in "aeiou"
        and base[-3] not in "aeiou"
    ):
        out.add(base[:-2] + base[-2] * 2 + base[-1])  # klag -> klaag
    if len(base) >= 2 and base[-1] == base[-2]:  # stap|pen -> stap
        out.add(base[:-1])
    for plain, voiced in (("f", "v"), ("s", "z")):
        if base.endswith(plain):
            out.add(base[:-1] + voiced)
        if infinitive[:-2].endswith(voiced):
            out.add(infinitive[:-2][:-1] + plain)
    return out


def _usable(e: PartEntry, surface: str, head: bool) -> bool:
    """Extra per-reading restrictions (see module docstring)."""
    if not real_glosses(e.glosses):
        return False
    if head:
        # short inflected heads are mostly inflection fragments (kop+eer); 3-letter lemmas are fine
        return len(surface) >= 4 or not e.inflected
    if surface in _NOT_MODIFIERS:
        return False
    if e.pos == "verb" and e.inflected:
        return surface in verb_stems(e.lemma.lower())
    return True


def _best_reading(
    surface: str, entries: Sequence[PartEntry], costs: _Cost, head: bool
) -> tuple[int, PartEntry] | None:
    """Cheapest usable ``(cost, entry)`` among a part's readings, or None."""
    best: tuple[int, PartEntry] | None = None
    for e in entries:
        cost = costs.get((e.pos, e.inflected))
        if cost is None or not _usable(e, surface, head):
            continue
        if best is None or cost < best[0]:
            best = (cost, e)
    return best


class _Search:
    """Memoised DP over split positions; ``max_lookups`` caps dictionary work per word."""

    def __init__(self, word: str, resolve: Resolver, max_lookups: int) -> None:
        self.word = word
        self.resolve = resolve
        self.max_lookups = max_lookups
        self._readings: dict[str, Sequence[PartEntry]] = {}
        self._tails: dict[tuple[int, int], _Split | None] = {}

    def _lookup(self, text: str) -> Sequence[PartEntry]:
        if text not in self._readings:
            if len(self._readings) >= self.max_lookups:
                return ()  # budget exhausted: further candidates count as unknown
            self._readings[text] = self.resolve(text)
        return self._readings[text]

    def tail(self, start: int, parts_left: int) -> _Split | None:
        """Best split of ``word[start:]`` into exactly ``parts_left`` parts (last = head)."""
        key = (start, parts_left)
        if key not in self._tails:
            self._tails[key] = self._compute_tail(start, parts_left)
        return self._tails[key]

    def _compute_tail(self, start: int, parts_left: int) -> _Split | None:
        rest = self.word[start:]
        if len(rest) < MIN_PART_LEN:
            return None
        if parts_left == 1:
            head = _best_reading(rest, self._lookup(rest), _HEAD_COST, True)
            if head is None:
                return None
            return len(rest) ** 2 - head[0], (Part(rest, head[1]),)
        winner: _Split | None = None
        for end in range(start + MIN_PART_LEN, len(self.word) - MIN_PART_LEN + 1):
            text = self.word[start:end]
            mod = _best_reading(text, self._lookup(text), _MOD_COST, False)
            if mod is None:
                continue
            for linker in LINKERS:
                nxt = end + len(linker)
                if self.word[end:nxt] != linker:
                    continue
                if mod[1].pos == "verb" and parts_left == 2 and len(self.word) - nxt < 4:
                    continue
                sub = self.tail(nxt, parts_left - 1)
                if sub is None:
                    continue
                score = len(text) ** 2 - mod[0] - _LINKER_COST[linker] + sub[0]
                if winner is None or score > winner[0]:
                    winner = (score, (Part(text, mod[1], linker), *sub[1]))
        return winner


def _build_gloss(parts: Sequence[Part]) -> tuple[str, list[dict[str, str | None]]]:
    """Readable gloss plus the per-part gloss list."""
    english: list[str] = []
    details: list[dict[str, str | None]] = []
    for i, p in enumerate(parts):
        short = short_gloss(p.entry)
        is_plural_head = (
            i == len(parts) - 1 and p.entry.inflected and p.entry.pos == "noun" and short
        )
        if short and is_plural_head:
            short = _pluralise(short)
        english.append(short or p.entry.lemma)
        details.append({"part": p.part, "gloss": part_gloss(p.entry)})
    lemmas = " + ".join(p.entry.lemma for p in parts)
    return f"{' '.join(english)} ({lemmas})", details


def _with_original_case(word: str, parts: Sequence[Part]) -> tuple[Part, ...]:
    """Re-cut the surface text of ``parts`` from the original-case ``word``."""
    out, i = [], 0
    for p in parts:
        out.append(Part(word[i : i + len(p.part)], p.entry, p.linker))
        i += len(p.part) + len(p.linker)
    return tuple(out)


def split_compound(
    word: str, resolve: Resolver, *, max_lookups: int = MAX_LOOKUPS
) -> CompoundAnalysis | None:
    """Best 2-3 part compound analysis of ``word``, or None.

    ``resolve(part)`` returns the :class:`PartEntry` readings of a lowercase string (``()`` if
    unknown). The caller must not call this for words that have an entry of their own.
    All-caps and non-alphabetic strings are never split.
    """
    if len(word) < MIN_WORD_LEN or not word.isalpha() or word.isupper():
        return None
    cautious = word[0].isupper()
    if cautious and len(word) < 9:
        return None
    search = _Search(word.lower(), resolve, max_lookups)
    best: _Split | None = None
    for n_parts in range(2, MAX_PARTS + 1):
        if n_parts == 3 and len(word) < MIN_WORD_LEN_3_PARTS:
            break
        found = search.tail(0, n_parts)
        if found is None:
            continue
        score = found[0] - _PART_PENALTY * (n_parts - 1)
        if best is None or score > best[0]:
            best = (score, found[1])
    if best is None:
        return None
    parts = _with_original_case(word, best[1])
    head = parts[-1].entry
    if cautious and (len(parts) != 2 or min(len(p.part) for p in parts) < 4 or head.pos != "noun"):
        return None
    gloss, details = _build_gloss(parts)
    return CompoundAnalysis(parts, best[0], head.pos, head.article, gloss, details)
