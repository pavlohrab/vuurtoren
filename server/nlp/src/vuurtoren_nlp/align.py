"""The English word(s) a Dutch word became in the machine translation of its sentence.

OPUS-MT's decoder attends to the source subwords it is translating; CTranslate2 returns that
attention for the best hypothesis (one row per target subword, one column per source subword).
:func:`align_word` reads a word's translation off it:

1. The Dutch word's subwords are found through the sentence's whitespace words (SentencePiece
   starts every word with ``▁``, so its word groups match ``sentence.split()``).
2. A target word is aligned to the Dutch word when one of its subwords attends most to one of the
   Dutch word's subwords (argmax over the source).
3. Aligned target words form runs of neighbours; the run whose subwords give the Dutch word the
   most attention in total wins.
   Leading and trailing articles, ``to`` and punctuation are dropped; a run of more than
   :data:`MAX_WORDS` words is no word meaning.
4. Confidence = the mean attention its subwords give to the Dutch word (0-1), kept only when
   the word translated on its own shares a word stem with it (:func:`agrees`), else scaled down
   by :data:`DISAGREE_FACTOR`. Attention alone hardly separates right from wrong; agreement
   does (88% vs 62% right on the meanings test set, ``tests/test_meanings.py``).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

MAX_WORDS = 3
MIN_CONFIDENCE = 0.5
"""Below this the alignment is not used as a meaning."""
DISAGREE_FACTOR = 0.4

# Words at the edge of a run that belong to the phrase, not to the word's meaning.
_SKIP_EDGE = frozenset(
    {"the", "a", "an", "to", "of", "'s", "s", "some", "any", "more", "most", "very", "so", "too"}
    | {"be", "is", "are", "was", "been", "my", "your", "his", "her", "its", "our", "their"}
    | {"this", "that", "these", "those", "on", "in", "at", "with", "by", "for", "from", "not"}
)
_PUNCT = re.compile(r"^\W+$")


@dataclass(frozen=True)
class Aligned:
    text: str
    """The English word(s), as they appear in the translation (``"wordless"``)."""
    confidence: float


@dataclass(frozen=True)
class AttentionResult:
    """One translated sentence with its subwords and decoder attention."""

    translation: str
    source: Sequence[str]
    """Source subwords, without the end-of-sentence token."""
    target: Sequence[str]
    attention: Sequence[Sequence[float]]
    """``attention[t][s]``: target subword ``t`` -> source subword ``s`` (may include ``</s>``)."""


def _groups(pieces: Sequence[str]) -> list[list[int]]:
    """Indices of subwords per word: a new word starts at each ``▁``."""
    out: list[list[int]] = []
    for i, p in enumerate(pieces):
        if p.startswith("▁") or not out:
            out.append([i])
        else:
            out[-1].append(i)
    return out


def _word_index(sentence: str, start: int, end: int) -> list[int]:
    """Indices of the whitespace words of ``sentence`` that overlap ``[start, end)``."""
    return [
        i
        for i, m in enumerate(re.finditer(r"\S+", sentence))
        if m.start() < end and m.end() > start
    ]


def align_word(result: AttentionResult, sentence: str, start: int, end: int) -> Aligned | None:
    """The translation of ``sentence[start:end]`` in ``result``, or None if unclear."""
    groups = _groups(result.source)
    words = _word_index(sentence.strip(), start - _lead(sentence), end - _lead(sentence))
    if len(groups) != len(sentence.split()) or not words:
        return None
    src = {j for w in words for j in groups[w] if not _PUNCT.match(result.source[j].lstrip("▁"))}
    if not src:
        return None
    target_words = _groups(result.target)
    mass: list[float] = []  # attention to the Dutch word, summed over the word's subwords
    pieces: list[int] = []
    aligned: list[bool] = []
    n = len(result.source)
    for group in target_words:
        total, hit = 0.0, False
        for t in group:
            row = result.attention[t]
            argmax = max(range(min(n, len(row))), key=row.__getitem__)
            total += sum(row[j] for j in src if j < len(row))
            hit = hit or argmax in src
        mass.append(total)
        pieces.append(len(group))
        aligned.append(hit)
    runs: list[list[int]] = []
    for i, hit in enumerate(aligned):
        if hit and runs and runs[-1][-1] == i - 1:
            runs[-1].append(i)
        elif hit:
            runs.append([i])
    if not runs:
        return None
    best = max(runs, key=lambda r: sum(mass[i] for i in r))
    texts = ["".join(result.target[t] for t in target_words[i]).lstrip("▁") for i in best]
    # A word copied from elsewhere in the sentence (a name, a number) is not this word's meaning.
    split = sentence.split()
    others = {w.lower().strip(".,;:!?\"'") for k, w in enumerate(split) if k not in words}
    keep = [(i, t) for i, t in zip(best, texts, strict=True) if t.lower() not in others]
    while keep and (keep[0][1].lower() in _SKIP_EDGE or _PUNCT.match(keep[0][1])):
        keep.pop(0)
    while keep and (keep[-1][1].lower() in _SKIP_EDGE or _PUNCT.match(keep[-1][1])):
        keep.pop()
    if not keep or len(keep) > MAX_WORDS:
        return None
    text = " ".join(t for _, t in keep)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text).strip(" ,.;:!?\"'")
    text = re.sub(r"'s$", "", text)
    dutch = sentence.strip()[_span(sentence, words)].lower()
    if not text or text.lower() == dutch:
        return None  # left untranslated
    confidence = sum(mass[i] for i, _ in keep) / sum(pieces[i] for i, _ in keep)
    return Aligned(text, round(confidence, 3))


def _span(sentence: str, words: list[int]) -> slice:
    spans = [m.span() for m in re.finditer(r"\S+", sentence.strip())]
    return slice(spans[words[0]][0], spans[words[-1]][1])


_SUFFIXES = ("ies", "es", "ed", "ing", "s", "d", "en", "ly")


def _stem(word: str) -> str:
    w = word.lower()
    for suf in _SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            w = w[: -len(suf)]
            break
    return w.rstrip("e")


def stems(text: str) -> set[str]:
    """Crude English word stems (``"Unanswered questions"`` -> ``{"unanswer", "question"}``)."""
    return {_stem(w) for w in re.findall(r"[a-zA-Z]+", text)} - {""}


def agrees(aligned: str, alone: str) -> bool:
    """True if the aligned words and the word's own translation share a stem."""
    return bool(stems(aligned) & stems(alone))


def _lead(text: str) -> int:
    return len(text) - len(text.lstrip())
