"""Word pairs of a whole sentence and its English translation, for the side-by-side reader.

The decoder attention of OPUS-MT (see :mod:`vuurtoren_nlp.align`) has one row per English
subword and one column per Dutch subword. :func:`pair_sentence` reads pairs off it:

1. Dutch subwords are placed in the sentence by their characters and belong to the Dutch word
   (a character span sent by the app) they overlap; English subwords are placed in the
   translation and belong to the English word they overlap. Words are runs of letters and
   digits, a contraction is a word of its own (``I`` + ``'ll``), and every other non-space
   character is a token of its own.
2. Dutch words the app joins (both parts of a split separable verb: ``bel … op``) form one
   group, so they pair with the same English.
3. Each English subword points at the Dutch subword it attends to most (argmax). An English
   word belongs to the Dutch group most of its subwords point at; punctuation is never paired.
4. A pair is one Dutch group with all English words that belong to it. Its confidence is the
   mean attention its English subwords give to the group's subwords (0-1); pairs below
   :data:`MIN_PAIR_CONFIDENCE` are dropped (on hand-checked sentences they are mostly wrong).

Limits: attention is a soft signal. Function words (``the``, ``to``, ``will``) often attend to a
neighbour, and English words with no Dutch counterpart are attached to whatever they attend to.
A Dutch word that no English word attends to stays unpaired (a particle on its own, ``er``).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from vuurtoren_nlp.align import AttentionResult

_TOKEN = re.compile(r"[^\W_]+|['’][^\W_]+|[^\w\s]|_")
_WORDLIKE = re.compile(r"\w")
MIN_PAIR_CONFIDENCE = 0.4


def english_tokens(translation: str) -> list[dict[str, Any]]:
    """``[{"start", "end", "text"}]`` of the words and punctuation marks of ``translation``."""
    return [
        {"start": m.start(), "end": m.end(), "text": m.group()}
        for m in _TOKEN.finditer(translation)
    ]


def piece_spans(pieces: Sequence[str], text: str) -> list[tuple[int, int] | None]:
    """Character span of each SentencePiece subword in ``text``, found in order.

    A subword that is not where the next characters are (normalised by the tokenizer, ``<unk>``)
    gets None and the search goes on after the last placed one.
    """
    out: list[tuple[int, int] | None] = []
    cursor = 0
    for piece in pieces:
        s = piece.replace("▁", "")
        k = text.find(s, cursor) if s else -1
        # Characters may be skipped only right after a subword that was not found.
        lost = bool(out) and out[-1] is None
        if k < 0 or (text[cursor:k].strip() and not lost):
            out.append(None)
            continue
        out.append((k, k + len(s)))
        cursor = k + len(s)
    return out


def _owner(span: tuple[int, int] | None, spans: Sequence[tuple[int, int]]) -> int | None:
    """Index of the first of ``spans`` that overlaps ``span``."""
    if span is None:
        return None
    a, b = span
    return next((k for k, (s, e) in enumerate(spans) if s < b and e > a), None)


def _groups(n: int, joins: Sequence[tuple[int, int]]) -> list[int]:
    """Group id (smallest member) per word, after joining the given word pairs."""
    root = list(range(n))

    def find(x: int) -> int:
        while root[x] != x:
            root[x] = root[root[x]]
            x = root[x]
        return x

    for a, b in joins:
        if 0 <= a < n and 0 <= b < n:
            ra, rb = find(a), find(b)
            root[max(ra, rb)] = min(ra, rb)
    return [find(x) for x in range(n)]


def pair_sentence(
    result: AttentionResult,
    sentence: str,
    translation: str,
    spans: Sequence[tuple[int, int]],
    joins: Sequence[tuple[int, int]] = (),
) -> dict[str, Any]:
    """Pairs of the Dutch words at ``spans`` of ``sentence`` and the words of ``translation``.

    ``joins`` are ``(word, word)`` indices into ``spans`` that belong together. ``sentence`` is
    the text the model read (character offsets as in ``spans``). An empty ``translation`` gives
    no English and no pairs.

    Returns ``{"english": [{start, end, text}], "words": [{start, end, en, pair, confidence}],
    "pairs": [{nl, en, confidence}]}``: ``nl`` and ``en`` are indices into ``spans`` and
    ``english``; a word's ``pair`` indexes ``pairs`` (None when unpaired).
    """
    english = english_tokens(translation) if translation else []
    words: list[dict[str, Any]] = [
        {"start": a, "end": b, "en": [], "pair": None, "confidence": 0.0} for a, b in spans
    ]
    if not english or not result.target or not result.attention:
        return {"english": english, "words": words, "pairs": []}

    lead = len(sentence) - len(sentence.lstrip())
    src_owner = [
        _owner((sp[0] + lead, sp[1] + lead), spans) if sp else None
        for sp in piece_spans(result.source, sentence.strip())
    ]
    group = _groups(len(spans), joins)
    members: dict[int, list[int]] = {}
    for w, g in enumerate(group):
        members.setdefault(g, []).append(w)
    pieces_of: dict[int, list[int]] = {}
    for j, w in enumerate(src_owner):
        if w is not None:
            pieces_of.setdefault(group[w], []).append(j)

    en_spans = [(t["start"], t["end"]) for t in english]
    tgt_owner = [_owner(sp, en_spans) for sp in piece_spans(result.target, translation)]
    n_src = len(result.source)
    votes: dict[int, dict[int, int]] = {}  # English word -> group -> subwords pointing there
    pointed: dict[int, list[int | None]] = {}
    for t, e in enumerate(tgt_owner):
        if e is None or t >= len(result.attention) or not _WORDLIKE.search(english[e]["text"]):
            continue
        row = result.attention[t]
        width = min(n_src, len(row))
        if width == 0:
            continue
        argmax = max(range(width), key=row.__getitem__)
        w = src_owner[argmax]
        g = group[w] if w is not None else None
        pointed.setdefault(e, []).append(t)
        if g is not None:
            votes.setdefault(e, {})
            votes[e][g] = votes[e].get(g, 0) + 1
    owner_of_en: dict[int, int] = {}
    for e, counts in votes.items():
        owner_of_en[e] = max(counts, key=lambda g: (counts[g], -g))

    by_group: dict[int, list[int]] = {}
    mass: dict[int, list[float]] = {}  # group -> attention of each of its English subwords
    for e, g in sorted(owner_of_en.items()):
        by_group.setdefault(g, []).append(e)
        row_mass = [
            sum(
                result.attention[t][j] for j in pieces_of.get(g, []) if j < len(result.attention[t])
            )
            for t in pointed[e]
        ]
        mass.setdefault(g, []).extend(row_mass)

    pairs: list[dict[str, Any]] = []
    for g in sorted(by_group, key=lambda g: members[g][0]):
        m = mass.get(g, [])
        confidence = round(sum(m) / len(m), 3) if m else 0.0
        if confidence < MIN_PAIR_CONFIDENCE:
            continue
        pair = {"nl": members[g], "en": by_group[g], "confidence": confidence}
        for w in members[g]:
            words[w].update(en=by_group[g], pair=len(pairs), confidence=confidence)
        pairs.append(pair)
    return {"english": english, "words": words, "pairs": pairs}
