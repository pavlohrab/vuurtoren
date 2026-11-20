"""OCR review: find words the OCR engine may have misread and suggest fixes.

Pure logic plus small Pillow helpers; no OCR calls here. :mod:`kenning_nlp.ocr` and
:mod:`kenning_nlp.course` feed it RapidOCR's rows, shaped like an ``image_to_data`` table.

A word is *flagged* when

* the engine's own confidence for it is low (below :data:`LOW_CONF` on a 0-100 scale), or
* it is not a Dutch word: not in wordfreq, the Kaikki dictionary (when built) or simplemma, and
  not a plain two-part compound of known words, or
* it was glued together from a line-end hyphenation and the result is not a word.

Suggestions come from the typical confusions of print OCR (``rn``/``m``, ``l``/``I``/``1``,
``0``/``o``, ``ij``/``y``, ``cl``/``d``, a lost space, a stray hyphen...), applied at most twice,
kept only when the result is a known word, and ranked by Dutch frequency (wordfreq Zipf).

Every flag carries character offsets into the text the client shows, the page it is on and its
box on that page (fractions 0..1 of the page), so the client can show the image crop.
"""

from __future__ import annotations

import base64
import io
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Any

from kenning_nlp.cleanup import normalize_text
from kenning_nlp.freq import zipf

LOW_CONF = 70.0
"""RapidOCR word score (0-100) below which a known word is still flagged. Its scores separate
right from wrong words weakly; at 70 about 1 % of correct words get a flag."""
KNOWN_ZIPF = 2.0
"""wordfreq Zipf at or above which a word counts as Dutch."""
COMPOUND_PART_ZIPF = 2.5
MAX_SUGGESTIONS = 3
MAX_FLAGS = 400
"""Per request: a page of noise (a photo of a picture) should not produce thousands of flags."""
PREVIEW_LONG_SIDE = 1400
COURSE_PREVIEW_LONG_SIDE = 1100

# One-way character confusions of print OCR: what the engine wrote -> what was printed.
# Applied at every occurrence, one at a time (and at most two edits per candidate).
CONFUSIONS: tuple[tuple[str, str], ...] = (
    ("rn", "m"),
    ("m", "rn"),
    ("rn", "rm"),
    ("rmn", "m"),
    ("mn", "m"),
    ("nm", "m"),
    ("cl", "d"),
    ("d", "cl"),
    ("vv", "w"),
    ("w", "vv"),
    ("ii", "ij"),
    ("y", "ij"),
    ("ij", "y"),
    ("ij", "ii"),
    ("li", "h"),
    ("h", "li"),
    ("ni", "m"),
    ("in", "m"),
    ("I", "l"),
    ("l", "I"),
    ("1", "l"),
    ("l", "1"),
    ("I", "i"),
    ("i", "l"),
    ("l", "i"),
    ("1", "i"),
    ("!", "l"),
    ("|", "l"),
    ("0", "o"),
    ("O", "o"),
    ("o", "0"),
    ("5", "s"),
    ("8", "B"),
    ("c", "e"),
    ("e", "c"),
    ("e", "é"),
    ("e", "ë"),
    ("i", "ï"),
    ("u", "n"),
    ("n", "u"),
    ("fl", "fi"),
    ("fi", "fl"),
    ("tl", "ti"),
    ("f", "t"),
    ("t", "f"),
    ("h", "b"),
    ("b", "h"),
)
_HYPHENS = "-‐‑"
_EDGE_PUNCT = "\"'()[]{}.,;:!?…*«»–—/\\<>"
_WORDISH = re.compile(r"[^\W_]", re.UNICODE)


# --------------------------------------------------------------------------- lexicon


@lru_cache(maxsize=65536)
def is_known(word: str, lang: str = "nl", compounds: bool = True) -> bool:
    """True if ``word`` (any case) is a word of ``lang``.

    Dutch uses wordfreq, then the Kaikki dictionary (when built) and simplemma, then a split
    into two known parts (``fietsenstalling``) with an optional linking ``s``/``e``/``en``
    (skipped with ``compounds=False``, for suggestions).
    Other languages only use wordfreq.
    """
    low = word.lower()
    if zipf(low, lang) >= KNOWN_ZIPF:
        return True
    if lang != "nl":
        return False
    from kenning_nlp.lexicon import get_lexicon

    if get_lexicon().is_word(low):
        return True
    import simplemma

    if len(low) <= 12 and simplemma.is_known(low, lang="nl"):
        return True
    return compounds and _is_compound(low)


def _is_compound(low: str) -> bool:
    if len(low) < 8 or not low.isalpha():
        return False
    for i in range(3, len(low) - 3):
        head, tail = low[:i], low[i:]
        if zipf(tail, "nl") < COMPOUND_PART_ZIPF:
            continue
        stems = (
            head,
            head[:-1] if head[-1] in "se" else "",
            head[:-2] if head.endswith("en") else "",
        )
        for stem in stems:
            if len(stem) >= 3 and zipf(stem, "nl") >= COMPOUND_PART_ZIPF:
                return True
    return False


_SHORT_OK = {
    "al", "de", "en", "er", "het", "ik", "in", "is", "je", "na", "nu", "om", "op", "te", "we",
    "ze", "zo", "u",
}  # fmt: skip


def _match_case(template: str, word: str, sentence_start: bool = False) -> str:
    """``word`` in the letter case of ``template``.

    When the first letter itself was the misread one (``Iand`` -> ``land``), its case comes
    from the position instead: capital only at a sentence start.
    """
    if template.isupper() and len(template) > 2:
        return word.upper()
    if template[:1] in "I1l|!0O" and template[:1].lower() != word[:1].lower():
        first_up = sentence_start
    else:
        first_up = template[:1].isupper()
    return (word[:1].upper() if first_up else word[:1]) + word[1:]


def _edits(word: str) -> set[str]:
    out: set[str] = set()
    for wrong, right in CONFUSIONS:
        start = word.find(wrong)
        while start != -1:
            out.add(word[:start] + right + word[start + len(wrong) :])
            start = word.find(wrong, start + 1)
    # A stray hyphen or apostrophe inside a word ("ver-haal" on one line).
    for i, ch in enumerate(word):
        if ch in _HYPHENS + "'.," and 0 < i < len(word) - 1:
            out.add(word[:i] + word[i + 1 :])
    out.discard(word)
    return out


def suggestions(
    word: str, lang: str = "nl", limit: int = MAX_SUGGESTIONS, sentence_start: bool = False
) -> list[str]:
    """Likely intended words for an OCR'd ``word``, most frequent first (may be empty).

    Candidates are one or two confusion edits away (see :data:`CONFUSIONS`) and must be known
    words; a lost space (``eenhuis`` -> ``een huis``) is offered when both halves are common.
    The original letter case is kept (``Iand`` -> ``Land``, at a sentence start).
    """
    if not word or len(word) > 40:
        return []
    first = _edits(word) | (_edits(word.lower()) if word[:1].isupper() else set())
    second: set[str] = set()
    if len(word) <= 20:
        for cand in list(first)[:200]:
            second |= _edits(cand)
    scored: dict[str, float] = {}
    for cand in first | second:
        if cand.lower() == word.lower() or not _WORDISH.search(cand):
            continue
        if len(cand) < 2 <= len(word):
            continue
        if is_known(cand, lang, compounds=False):
            # One edit beats two: a small penalty keeps "rnaar" -> "maar" above stranger reads.
            penalty = 0.0 if cand in first else 0.6
            low_cand = cand.lower()
            score = zipf(low_cand, lang) - penalty
            scored[low_cand] = max(scored.get(low_cand, -9.0), score)
    low = word.lower()
    if low.isalpha() and len(low) >= 5:
        for i in range(2, len(low) - 1):
            a, b = low[:i], low[i:]
            if (
                all(len(p) >= 3 or p in _SHORT_OK for p in (a, b))
                and min(zipf(a, lang), zipf(b, lang)) >= 3.5
            ):
                scored[f"{a} {b}"] = min(zipf(a, lang), zipf(b, lang)) - 1.0
    ranked = sorted(scored, key=lambda w: (-scored[w], w))
    # Far less frequent readings than the best one are noise ("hoe" beats "hoc").
    ranked = [w for w in ranked if scored[w] >= scored[ranked[0]] - 2.5][:limit]
    return [_match_case(word, w, sentence_start) for w in ranked]


# --------------------------------------------------------------------------- words and boxes


@dataclass
class OcrWord:
    """One recognised word with its page and box (fractions of the page)."""

    text: str
    conf: float
    page: int
    x: float
    y: float
    w: float
    h: float
    line: tuple[int, int, int] = (0, 0, 0)


def page_words(data: dict[str, list[Any]], width: int, height: int, page: int) -> list[OcrWord]:
    """``image_to_data``-shaped rows -> words in reading order (block, paragraph, line).

    The order is the one :func:`kenning_nlp.ocr.words_to_text` and
    :func:`kenning_nlp.course.data_to_blocks` use to build the page text.
    """
    rows: list[tuple[tuple[int, int, int], int, OcrWord]] = []
    for i, raw in enumerate(data["text"]):
        text = str(raw).strip()
        conf = float(data["conf"][i])
        if not text or conf < 0:
            continue
        key = (int(data["block_num"][i]), int(data["par_num"][i]), int(data["line_num"][i]))
        left, top = int(data["left"][i]), int(data["top"][i])
        rows.append(
            (
                key,
                i,
                OcrWord(
                    text=text,
                    conf=conf,
                    page=page,
                    x=round(left / width, 4),
                    y=round(top / height, 4),
                    w=round(int(data["width"][i]) / width, 4),
                    h=round(int(data["height"][i]) / height, 4),
                    line=key,
                ),
            )
        )
    rows.sort(key=lambda r: (r[0], r[1]))
    return [r[2] for r in rows]


def _key(token: str) -> str:
    return token.strip(_EDGE_PUNCT).lower()


@dataclass
class _Token:
    start: int
    end: int
    text: str
    words: list[OcrWord] = field(default_factory=list)


def _tokens(text: str) -> list[_Token]:
    return [_Token(m.start(), m.end(), m.group()) for m in re.finditer(r"\S+", text)]


def align(text: str, words: Sequence[OcrWord]) -> list[_Token]:
    """Tokens of ``text`` (whitespace-separated) with the OCR words each came from.

    ``text`` is the OCR text after cleanup (headers dropped, line-end hyphenations joined,
    characters normalised), so tokens and words mostly match one to one. Runs that differ are
    matched by their letters: ``woor-`` + ``den`` -> ``woorden`` gets both words.
    """
    tokens = _tokens(text)
    norm = [normalize_text(w.text) for w in words]
    a = [_key(t) for t in norm]
    b = [_key(t.text) for t in tokens]
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                tokens[j1 + k].words.append(words[i1 + k])
        elif op == "replace":
            _align_run(norm[i1:i2], words[i1:i2], tokens[j1:j2])
    return tokens


def _letters(s: str) -> str:
    return "".join(ch for ch in s.lower() if ch.isalnum())


def _align_run(norm: Sequence[str], words: Sequence[OcrWord], tokens: Sequence[_Token]) -> None:
    """Map a differing run by letter positions (hyphen joins, punctuation changes)."""
    owner: list[int] = []
    for k, t in enumerate(norm):
        owner += [k] * len(_letters(t))
    pos = 0
    if len("".join(_letters(t) for t in norm)) != sum(len(_letters(t.text)) for t in tokens):
        return  # not the same letters: leave unmapped rather than guess
    for tok in tokens:
        n = len(_letters(tok.text))
        seen: list[int] = []
        for k in owner[pos : pos + n]:
            if k not in seen:
                seen.append(k)
        tok.words.extend(words[k] for k in seen)
        pos += n


# --------------------------------------------------------------------------- flags


def _core(token: str) -> tuple[int, int]:
    """Offsets of a token's word part, without surrounding punctuation."""
    start, end = 0, len(token)
    while start < end and token[start] in _EDGE_PUNCT:
        start += 1
    while end > start and token[end - 1] in _EDGE_PUNCT:
        end -= 1
    return start, end


def _looks_like_number(s: str) -> bool:
    return bool(re.fullmatch(r"[\d.,:/%+\-–]+", s)) and any(ch.isdigit() for ch in s)


def _digit_confusable(s: str) -> bool:
    """Mostly letters with a digit the engine may have put for a letter (``we1``, ``h0e``)."""
    letters = sum(ch.isalpha() for ch in s)
    return letters >= 2 and any(ch in "01568|!" for ch in s)


def assess(
    word: str,
    conf: float,
    lang: str = "nl",
    sentence_start: bool = False,
    joined: Sequence[str] = (),
    low_conf: float = LOW_CONF,
) -> tuple[str, list[str]] | None:
    """Decide whether one word should be flagged; returns ``(reason, suggestions)`` or None.

    ``reason`` is ``"unknown"`` (not a word), ``"hyphen"`` (a line-end hyphenation was joined
    into a non-word), ``"confusable"`` (a rare short word next to a very common reading:
    ``ln`` -> ``in``) or ``"low"`` (a known word the engine was unsure about). ``joined`` holds
    the OCR pieces when the word was glued from a hyphenated line end. ``low_conf`` is the
    engine's own threshold for an unsure word (on its 0-100 scale).
    """
    if not word or _looks_like_number(word):
        return None
    if not _WORDISH.search(word):
        return None
    alpha = word.replace("-", "").replace("'", "")
    known = is_known(word, lang) or (
        "-" in word and all(is_known(p, lang) for p in word.split("-") if p)
    )
    if len(joined) >= 2 and not known:
        left = joined[0].rstrip(_HYPHENS)
        right = joined[-1]
        options = [o for o in (f"{left}-{right}", f"{left} {right}") if _known_phrase(o, lang)]
        more = suggestions(word, lang, sentence_start=sentence_start)
        return "hyphen", (options + more)[:MAX_SUGGESTIONS]
    if known:
        own = zipf(word.lower(), lang)
        if len(alpha) <= 3 and alpha.lower() not in _SHORT_OK:
            # Short junk that wordfreq knows ("ln", "dc") next to a very common reading.
            likely = [
                s
                for s in suggestions(word, lang, sentence_start=sentence_start)
                if zipf(s.lower(), lang) >= own + 2.5
            ]
            if likely:
                return "confusable", likely
        if conf < low_conf and len(word) >= 2:
            better = suggestions(word, lang, sentence_start=sentence_start)
            return "low", [s for s in better if zipf(s.lower(), lang) > own]
        return None
    if len(alpha) <= 1:
        return ("low", []) if conf < low_conf else None
    found = suggestions(word, lang, sentence_start=sentence_start)
    capital = word[:1].isupper() and not word.isupper()
    if capital and not sentence_start and not found and not _digit_confusable(word):
        # Probably a name: flag only when the engine itself was unsure.
        return ("low", []) if conf < low_conf else None
    if word.isupper() and len(word) <= 4 and not found:
        return None  # abbreviations: EU, NOS, KLM
    return "unknown", found


def _known_phrase(s: str, lang: str) -> bool:
    parts = [p for p in re.split(r"[\s-]", s) if p]
    return bool(parts) and all(is_known(p, lang) and len(p) >= 2 for p in parts)


def _box(words: Iterable[OcrWord]) -> dict[str, float | int]:
    ws = list(words)
    page = ws[0].page
    same = [w for w in ws if w.page == page and w.line == ws[0].line] or ws[:1]
    x0 = min(w.x for w in same)
    y0 = min(w.y for w in same)
    x1 = max(w.x + w.w for w in same)
    y1 = max(w.y + w.h for w in same)
    return {
        "page": page,
        "x": round(x0, 4),
        "y": round(y0, 4),
        "w": round(x1 - x0, 4),
        "h": round(y1 - y0, 4),
    }


def find_flags(
    text: str,
    words: Sequence[OcrWord],
    lang: str = "nl",
    limit: int = MAX_FLAGS,
    low_conf: float = LOW_CONF,
) -> list[dict[str, Any]]:
    """Flags for the words of ``text`` that may be misread, in text order.

    Each flag is ``{"start", "end", "word", "reason", "conf", "suggestions", "box"}`` where
    ``start``/``end`` are offsets into ``text``, ``conf`` is 0..1 and ``box`` is
    ``{"page", "x", "y", "w", "h"}`` (page 1-based, box in fractions of that page) of the
    word's first line. Words that could not be traced back to the image are not flagged.
    ``low_conf`` is the engine's threshold for an unsure word (see :func:`assess`).
    """
    flags: list[dict[str, Any]] = []
    prev_end = ""
    tokens = align(text, words)
    skip = False
    for i, tok in enumerate(tokens):
        if skip:
            skip = False
            prev_end = tok.text[-1:]
            continue
        cs, ce = _core(tok.text)
        word = tok.text[cs:ce]
        sentence_start = prev_end == "" or prev_end in ".!?:\u2026\"'"
        prev_end = tok.text[-1:]
        if not tok.words or not word:
            continue
        conf = min(w.conf for w in tok.words)
        broken = _broken_hyphen(text, tok, cs, tokens[i + 1] if i + 1 < len(tokens) else None, lang)
        if broken is not None:
            end, joined_word = broken
            flags.append(
                {
                    "start": tok.start + cs,
                    "end": end,
                    "word": text[tok.start + cs : end],
                    "reason": "hyphen",
                    "conf": round(conf / 100, 3),
                    "suggestions": [joined_word],
                    "box": _box(tok.words),
                }
            )
            skip = True
            continue
        joined = [w.text for w in tok.words] if len(tok.words) >= 2 else []
        if joined and not any(j.rstrip(_EDGE_PUNCT)[-1:] in _HYPHENS for j in joined[:-1]):
            joined = []
        verdict = assess(word, conf, lang, sentence_start, joined, low_conf)
        if verdict is None:
            continue
        reason, sugg = verdict
        flags.append(
            {
                "start": tok.start + cs,
                "end": tok.start + ce,
                "word": word,
                "reason": reason,
                "conf": round(conf / 100, 3),
                "suggestions": sugg,
                "box": _box(tok.words),
            }
        )
        if len(flags) >= limit:
            break
    return flags


def _broken_hyphen(
    text: str, tok: _Token, cs: int, nxt: _Token | None, lang: str
) -> tuple[int, str] | None:
    """A hyphenation the cleanup could not join (``groen-`` ... ``ten`` across a block break).

    Returns the end offset of the flag (end of the next word) and the joined word, when the
    token ends in a hyphen, the next word starts in lowercase and the two make a known word.
    """
    if nxt is None or len(tok.text) < 3 or tok.text[-1] not in _HYPHENS:
        return None
    if not tok.text[-2].isalpha():
        return None
    ns, ne = _core(nxt.text)
    tail = nxt.text[ns:ne]
    if not tail[:1].islower():
        return None
    head = tok.text[cs:].rstrip(_HYPHENS)
    if head.lower() in {"en", "of"} or tail.lower() in {"en", "of", "tot", "noch"}:
        return None
    joined = head + tail
    if not is_known(joined, lang):
        return None
    return nxt.start + ne, joined


# --------------------------------------------------------------------------- page previews


def preview_webp(img: Any, long_side: int = PREVIEW_LONG_SIDE, quality: int = 62) -> bytes:
    """A downscaled grayscale WebP of a page (EXIF rotation applied, as for OCR)."""
    from PIL import Image, ImageOps

    page = ImageOps.exif_transpose(img) or img
    page = ImageOps.grayscale(page)
    scale = min(1.0, long_side / max(page.size))
    if scale < 1.0:
        page = page.resize(
            (max(1, round(page.width * scale)), max(1, round(page.height * scale))),
            Image.Resampling.LANCZOS,
        )
    out = io.BytesIO()
    page.save(out, "WEBP", quality=quality, method=4)
    return out.getvalue()


def data_url(webp: bytes) -> str:
    return "data:image/webp;base64," + base64.b64encode(webp).decode("ascii")
