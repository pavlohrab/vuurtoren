"""Side-by-side word pairs and grammar hits of the bundled stories, computed at build time.

On a phone there is no language server, so the app cannot ask ``/translate/pairs`` or
``/grammar`` for a story. ``scripts/build_story_extras.py`` (run by ``check_stories.py --write``)
asks the same code here, once, and writes the answers into ``content/stories/stories.json``:

- ``pairs``: per spaCy sentence (``Token.sent``), the pairs of ``/translate/pairs`` with the
  story's own English given (forced decoding), exactly as the reader asks: the sentence runs from
  its first to its last token, its spans are its word tokens, its joins the separable verbs, and
  its English the story lines whose first word falls in it (joined by a space, like the app's
  ``storyEnglish``). Each pair is ``[nl word indices, en token indices, confidence]`` (indices
  as the server gives them: into the sentence's words and into the English tokens), the
  confidence rounded to 2 decimals. ``null`` for a sentence with words but without a story line
  (the app asks the server for it); ``[]`` for one without words (a quote on its own).
- ``pairsEnglish``: ``{sent: english}`` for the rare sentence whose English the server returns
  differently from the story's: padding dots cleaned (the English token indices refer to it), or
  ``""`` when the model's check rejected the pair (the server answers no English, no pairs).
- ``grammar``: the hits of ``/grammar`` for the story's text, ``[topic, token indices, note]``
  (sentence and offsets follow from the tokens).

The versions go into the bundle (``extras``) so a stale bundle shows: the analyzer version
(which covers the grammar detectors), the translation model and the pairing code.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from vuurtoren_nlp import align, pairs, translate
from vuurtoren_nlp.grammar import detect_grammar
from vuurtoren_nlp.models import TextAnalysis, Token

EXTRAS_FORMAT = 1
"""Bump when the layout of ``pairs``/``grammar`` in the bundle changes."""


def pairer_version() -> str:
    """``p-`` + 12 hex digits of the pairing code (attention reading, pairing, MT wrapper)."""
    h = hashlib.sha256()
    for mod in (align, pairs, translate):
        h.update(Path(mod.__file__ or "").read_bytes())
    return f"p-{h.hexdigest()[:12]}"


def model_version() -> str:
    """The installed ``mt-nl-en`` pack (``mt-nl-en 2026.11.1``), else a hash of its files."""
    from vuurtoren_nlp import packs

    marker = packs.installed("mt-nl-en")
    if marker and marker.get("version"):
        return f"mt-nl-en {marker['version']}"
    h = hashlib.sha256()
    for name in translate.MODEL_FILES:
        h.update((translate.model_dir() / name).read_bytes())
    return f"mt-nl-en sha256:{h.hexdigest()[:12]}"


def sentence_english(
    tokens: Sequence[Token], lines: Sequence[tuple[int, int, str]]
) -> dict[int, str]:
    """The story's English per spaCy sentence: each line goes to the sentence holding the first
    word at or after its start (inside the line); several lines in one sentence are joined.
    The same rule as ``storyEnglish`` in apps/web/src/services/stories.ts."""
    words = [t for t in tokens if t.is_word]
    out: dict[int, str] = {}
    k = 0
    for start, end, en in lines:
        while k < len(words) and words[k].start < start:
            k += 1
        if k >= len(words) or words[k].start >= end:
            continue
        sent = words[k].sent
        out[sent] = f"{out[sent]} {en}" if sent in out else en
    return out


def pair_item(
    content: str, toks: Sequence[Token]
) -> tuple[str, list[tuple[int, int]], list[tuple[int, int]]]:
    """A sentence as the reader sends it to ``/translate/pairs`` (``pairItem`` in livePairs.ts):
    its text from the first to the last token, its word spans and separable-verb joins."""
    start = toks[0].start if toks else 0
    end = toks[-1].end if toks else start
    words = [t for t in toks if t.is_word]
    at = {t.i: k for k, t in enumerate(words)}
    joins = [
        (k, at[t.particle_of])
        for k, t in enumerate(words)
        if t.particle_of is not None and t.particle_of in at
    ]
    spans = [(t.start - start, t.end - start) for t in words]
    return content[start:end], spans, joins


def story_extras(
    content: str, tokens: Sequence[Token], lines: Sequence[tuple[int, int, str]]
) -> dict[str, Any]:
    """``{"pairs", "pairsEnglish"?, "grammar"}`` of one story (see the module docstring).

    ``tokens`` is the story's analysis, ``lines`` its ``[start, end, English]`` per Dutch line.

    Raises:
        ValueError: for text with characters above U+FFFF (token offsets are UTF-16 units, the
            pairs code reads code points; no story has any).
        ServiceError: 503 when the translation model is not installed.
    """
    if any(ord(c) > 0xFFFF for c in content):
        raise ValueError("a story with characters above U+FFFF: offsets would not match")
    by_sent: dict[int, list[Token]] = {}
    for t in tokens:
        by_sent.setdefault(t.sent, []).append(t)
    english = sentence_english(tokens, lines)
    sents = sorted(by_sent)
    if sents != list(range(len(sents))):
        raise ValueError("sentence numbers are not 0..n-1")
    asked = [s for s in sents if english.get(s, "").strip()]
    items = [(*pair_item(content, by_sent[s]), english[s]) for s in asked]
    paired = dict(zip(asked, translate.pair_texts("nl", "en", items), strict=True))

    out_pairs: list[list[Any] | None] = []
    differs: dict[str, str] = {}
    for s in sents:
        r = paired.get(s)
        if r is None:
            # No words (a closing quote on its own): nothing to pair, nothing to ask.
            wordless = not any(t.is_word for t in by_sent[s])
            out_pairs.append([] if wordless else None)
            continue
        if r["translation"] != english[s].strip():
            differs[str(s)] = r["translation"]
        out_pairs.append([[p["nl"], p["en"], round(float(p["confidence"]), 2)] for p in r["pairs"]])

    analysis = TextAnalysis(tokens=list(tokens))
    grammar = [
        [h.topic, h.tokens, h.note] if h.note else [h.topic, h.tokens]
        for h in detect_grammar(content, analysis)
    ]
    return {
        "pairs": out_pairs,
        **({"pairsEnglish": differs} if differs else {}),
        "grammar": grammar,
    }


def extras_meta(analyzer: str) -> dict[str, Any]:
    """The versions the extras were computed with (the bundle's ``extras``)."""
    return {
        "format": EXTRAS_FORMAT,
        "analyzerVersion": analyzer,
        "model": model_version(),
        "pairer": pairer_version(),
    }
