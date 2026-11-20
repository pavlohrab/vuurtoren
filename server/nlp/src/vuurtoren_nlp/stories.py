"""Graded stories (``content/stories/<level>/<slug>.md``): parsing and the vocabulary check.

Build-time only (``scripts/check_stories.py`` checks the stories and writes the app's bundle);
the server does not use it. The pure rules live here so they can be tested without spaCy:

* :func:`parse_story` reads a story file: front matter, then Dutch paragraphs in which every
  Dutch sentence sits on its own line, followed by its English on a line starting with ``> ``.
* :func:`story_content` joins the Dutch into the text the app stores (sentences joined by a
  space, paragraphs by a blank line) and gives each sentence's character span in it.
* :func:`count_words` counts the running words and how many fall within the level's part of
  the starter list.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Protocol

REQUIRED = ("title", "level", "words", "summary", "kind", "licence", "review")
KINDS = ("legend", "classic", "original")


@dataclass(frozen=True)
class Level:
    """Targets of a level: length in words, the list rank words must fall within, and the
    longest sentence (words) the level allows (None: no limit)."""

    min_words: int
    max_words: int
    rank: int
    max_sentence: int | None
    share: float = 0.95


LEVELS: dict[str, Level] = {
    "A1": Level(150, 250, 1000, 10),
    "A2": Level(300, 500, 2000, 14),
    "B1": Level(600, 900, 3500, 20),
    "B2": Level(900, 1400, 4930, None),
}


@dataclass
class Sentence:
    nl: str
    en: str


@dataclass
class Story:
    meta: dict[str, str]
    paragraphs: list[list[Sentence]]
    problems: list[str] = field(default_factory=list)
    """Format problems: a Dutch line without English, English without Dutch, missing fields."""

    @property
    def sentences(self) -> list[Sentence]:
        return [s for p in self.paragraphs for s in p]

    @property
    def names(self) -> set[str]:
        """Words of the ``names`` field (comma separated), lowercased: not counted."""
        raw = self.meta.get("names", "")
        return {w.lower() for part in raw.split(",") for w in part.split() if w}


def parse_story(text: str) -> Story:
    """A story file: ``---`` front matter (``key: value`` lines), then the paragraphs."""
    lines = text.splitlines()
    meta: dict[str, str] = {}
    problems: list[str] = []
    body_at = 0
    if lines and lines[0].strip() == "---":
        for k, ln in enumerate(lines[1:], start=1):
            if ln.strip() == "---":
                body_at = k + 1
                break
            key, sep, value = ln.partition(":")
            if sep:
                meta[key.strip()] = value.strip().strip('"')
        else:
            problems.append("front matter is not closed with ---")
            body_at = len(lines)
    else:
        problems.append("no front matter")
    for key in REQUIRED:
        if not meta.get(key):
            problems.append(f"front matter: {key} is missing")
    if meta.get("kind") and meta["kind"] not in KINDS:
        problems.append(f"front matter: kind {meta['kind']!r} is not one of {', '.join(KINDS)}")
    if meta.get("kind") in ("legend", "classic") and not meta.get("credit"):
        problems.append("front matter: a retelling needs a credit")
    if meta.get("level") and meta["level"] not in LEVELS:
        problems.append(f"front matter: level {meta['level']!r} is unknown")

    paragraphs: list[list[Sentence]] = []
    current: list[Sentence] = []
    pending: str | None = None
    for n, raw in enumerate(lines[body_at:], start=body_at + 1):
        ln = raw.strip()
        if not ln:
            if pending is not None:
                problems.append(f"line {n - 1}: Dutch sentence without English: {pending!r}")
                pending = None
            if current:
                paragraphs.append(current)
                current = []
            continue
        if ln.startswith(">"):
            en = ln[1:].strip()
            if pending is None:
                problems.append(f"line {n}: English without a Dutch sentence: {en!r}")
            else:
                current.append(Sentence(pending, en))
                pending = None
            continue
        if pending is not None:
            problems.append(f"line {n - 1}: Dutch sentence without English: {pending!r}")
        pending = ln
    if pending is not None:
        problems.append(f"last line: Dutch sentence without English: {pending!r}")
    if current:
        paragraphs.append(current)
    return Story(meta, paragraphs, problems)


def story_content(story: Story) -> tuple[str, list[tuple[int, int]]]:
    """The Dutch text as the app stores it, and each sentence's [start, end) in it."""
    parts: list[str] = []
    spans: list[tuple[int, int]] = []
    at = 0
    for p, para in enumerate(story.paragraphs):
        if p:
            parts.append("\n\n")
            at += 2
        for k, s in enumerate(para):
            if k:
                parts.append(" ")
                at += 1
            parts.append(s.nl)
            spans.append((at, at + len(s.nl)))
            at += len(s.nl)
    return "".join(parts), spans


class TokenLike(Protocol):
    text: str
    lemma: str
    alt_lemmas: list[str]
    is_word: bool
    is_propn: bool
    is_num: bool
    particle_of: int | None
    start: int


@dataclass
class Counts:
    words: int
    """Running words (every word token)."""
    counted: int
    """Words the coverage counts: not names, numbers or detached verb particles."""
    within: int
    """Counted words whose lemma ranks within the level's limit."""
    outside: Counter[str]
    """Lemmas beyond the limit (or not in the list), with how often they occur."""

    @property
    def coverage(self) -> float:
        return self.within / self.counted if self.counted else 1.0


def rank_of(token: TokenLike, ranks: Mapping[str, int]) -> int | None:
    """The best list rank of the token's lemma (or one of its other readings)."""
    best: int | None = None
    for lemma in (token.lemma, *token.alt_lemmas, token.text):
        r = ranks.get(lemma.lower())
        if r is not None and (best is None or r < best):
            best = r
    return best


def count_words(
    tokens: Sequence[TokenLike], ranks: Mapping[str, int], limit: int, names: Iterable[str] = ()
) -> Counts:
    """Count the running words and those whose lemma ranks at most ``limit``."""
    skip = {n.lower() for n in names}
    words = counted = within = 0
    outside: Counter[str] = Counter()
    for t in tokens:
        if not t.is_word:
            continue
        words += 1
        if t.is_propn or t.is_num or t.particle_of is not None or t.text.lower() in skip:
            continue
        counted += 1
        r = rank_of(t, ranks)
        if r is not None and r <= limit:
            within += 1
        else:
            outside[t.lemma.lower()] += 1
    return Counts(words, counted, within, outside)


def sentence_words(tokens: Sequence[TokenLike], spans: Sequence[tuple[int, int]]) -> list[int]:
    """Word count per sentence span."""
    out = [0] * len(spans)
    k = 0
    for t in tokens:
        if not t.is_word:
            continue
        while k < len(spans) and t.start >= spans[k][1]:
            k += 1
        if k < len(spans) and t.start >= spans[k][0]:
            out[k] += 1
    return out


class SentToken(TokenLike, Protocol):
    sent: int


def sentence_starts(tokens: Sequence[SentToken]) -> set[int]:
    """Where each spaCy sentence's first word starts (sentences without words left out)."""
    first: dict[int, int] = {}
    for t in tokens:
        if t.is_word:
            first.setdefault(t.sent, t.start)
    return set(first.values())


def line_starts(tokens: Sequence[TokenLike], spans: Sequence[tuple[int, int]]) -> list[int | None]:
    """Where the first word of each sentence span starts (None for a span without words)."""
    out: list[int | None] = [None] * len(spans)
    k = 0
    for t in tokens:
        if not t.is_word:
            continue
        while k < len(spans) and t.start >= spans[k][1]:
            k += 1
        if k < len(spans) and t.start >= spans[k][0] and out[k] is None:
            out[k] = t.start
    return out
