"""OCR with PaddleOCR models through RapidOCR (ONNX Runtime, CPU).

RapidOCR finds text lines (detection model), reads each line (recognition model) and gives
every word a box and a score. The models are the PP-OCRv6 *small* detection and recognition
models that come inside the ``rapidocr`` wheel; the recognition model is multilingual and
reads Dutch with its diacritics (``ë``, ``é``, ``ï``).

RapidOCR returns lines top to bottom across the whole page. :func:`layout` puts them into
reading order with a recursive XY cut: the page is split at wide horizontal gaps (between
paragraphs and boxes), then at vertical gutters (between columns), until a region has
neither. A region whose columns are tables (three or more columns, or a narrow label column)
is read row by row instead of column by column.

The result has the shape of an ``image_to_data`` table (``text``, ``conf``, ``block_num``,
``par_num``, ``line_num``, ``left``, ``top``, ``width``, ``height``), from which the text, layout
blocks, word boxes and review flags are built. Confidences are RapidOCR's word scores times
100.
"""

from __future__ import annotations

import os
import re
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from PIL import Image

MAX_SIDE = 2000
"""Pages are scaled down to this long side (pixels) before detection and recognition."""
Y_GAP = 0.9
"""A horizontal gap of at least this many line heights splits a region (paragraphs, boxes)."""
X_GAP = 1.0
"""A vertical gutter of at least this many line heights splits a region into columns."""
NARROW = 0.2
"""A column narrower than this share of its region is a label column (read row by row)."""

_local = threading.local()


@lru_cache(maxsize=1)
def available() -> bool:
    """True when RapidOCR and ONNX Runtime are installed (checked without importing them)."""
    from importlib.util import find_spec

    return all(find_spec(m) is not None for m in ("rapidocr", "onnxruntime", "cv2"))


def threads() -> int:
    """ONNX Runtime threads for this thread's engine: the :func:`limit_threads` budget, else
    ``$KENNING_OCR_THREADS``, else all CPUs."""
    budget = getattr(_local, "threads", None)
    if budget:
        return int(budget)
    env = os.environ.get("KENNING_OCR_THREADS")
    if env and env.isdigit() and int(env) > 0:
        return int(env)
    return os.cpu_count() or 2


def limit_threads(n: int) -> None:
    """Cap the threads of the engine this thread creates (parallel course workers share the
    CPUs). Takes effect for an engine not created yet."""
    _local.threads = max(1, n)


def _engine() -> Any:
    """One RapidOCR instance per thread (course import recognises pages in parallel)."""
    eng = getattr(_local, "engine", None)
    if eng is None:
        from rapidocr import RapidOCR

        n = threads()
        eng = RapidOCR(
            params={
                "Global.log_level": "warning",
                "Global.return_word_box": True,
                "Global.max_side_len": MAX_SIDE,
                "EngineConfig.onnxruntime.intra_op_num_threads": n,
                "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            }
        )
        _local.engine = eng
    return eng


# --------------------------------------------------------------------------- layout


@dataclass
class Word:
    text: str
    score: float
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass
class Line:
    """One detected text line with its words (left to right)."""

    words: list[Word]
    x0: float = field(init=False)
    y0: float = field(init=False)
    x1: float = field(init=False)
    y1: float = field(init=False)

    def __post_init__(self) -> None:
        self.x0 = min(w.x0 for w in self.words)
        self.y0 = min(w.y0 for w in self.words)
        self.x1 = max(w.x1 for w in self.words)
        self.y1 = max(w.y1 for w in self.words)

    @property
    def height(self) -> float:
        return self.y1 - self.y0


def _bbox(points: Any) -> tuple[float, float, float, float]:
    xs = [float(p[0]) for p in points]
    ys = [float(p[1]) for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def _split_words(text: str, score: float, box: Any) -> list[Word]:
    """Words of a line without word boxes: the line box shared out by character count."""
    x0, y0, x1, y1 = _bbox(box)
    parts = text.split()
    total = sum(len(p) for p in parts) + max(0, len(parts) - 1)
    out, pos = [], 0
    for p in parts:
        a = x0 + (x1 - x0) * pos / max(total, 1)
        pos += len(p)
        b = x0 + (x1 - x0) * pos / max(total, 1)
        pos += 1
        out.append(Word(p, score, a, y0, b, y1))
    return out


# Short Dutch words the recognition model tends to glue to their neighbour ("zomooi", "Komtu").
FUNCTION_WORDS = frozenset({
    "de", "het", "een", "en", "in", "op", "is", "u", "ik", "zo", "te", "of", "al", "er", "je",
    "ze", "we", "om", "na", "nu", "van", "met", "aan", "bij", "tot", "voor", "dat", "die", "dan",
    "als", "maar", "wat", "wel", "niet", "ook", "nog", "erg", "hij", "zij", "wij", "jij",
})  # fmt: skip
_PUNCT_GLUE = re.compile(
    r"(?<=[^\W\d_][.,;:])(?=[A-Z][a-z])"  # woning.De
    r"|(?<=[?!])(?=['\"]?[^\W\d_])"  # dit?'of
    r"|(?<=\d)(?=[A-Z][a-z])"  # 3Fietsen
)
_EDGE = "\"'()[]{}.,;:!?"


def split_glued(token: str, lang: str = "nl") -> list[str]:
    """Undo a lost space in one recognised token, or return it unchanged.

    Splits after sentence punctuation before a capitalised word (``woning.De``), after ``?``
    or ``!`` before a letter, and after a digit before a capitalised word (``3Fietsen``). For
    Dutch it also splits off a short function word (``zomooi`` -> ``zo mooi``, ``Komtu`` ->
    ``Komt u``) when the token is not a word itself and the other part is; there is no
    compound guess here, so a real compound stays whole.
    """
    parts = [p for p in _PUNCT_GLUE.split(token) if p]
    if lang != "nl":
        return parts
    out: list[str] = []
    for part in parts:
        out += _split_function_word(part)
    return out


def _split_function_word(part: str) -> list[str]:
    from kenning_nlp.freq import zipf
    from kenning_nlp.ocr_review import is_known

    start, end = 0, len(part)
    while start < end and part[start] in _EDGE:
        start += 1
    while end > start and part[end - 1] in _EDGE:
        end -= 1
    core = part[start:end]
    if len(core) < 4 or not core.isalpha() or not core[1:].islower():
        return [part]
    if is_known(core, "nl", compounds=False):
        return [part]
    best: tuple[float, int] | None = None
    low = core.lower()
    for i in range(1, len(core)):
        a, b = low[:i], low[i:]
        if a in FUNCTION_WORDS and len(b) >= 2 and is_known(b, "nl", compounds=False):
            score = zipf(b, "nl")
        elif b in FUNCTION_WORDS and len(a) >= 2 and is_known(a, "nl", compounds=False):
            score = zipf(a, "nl")
        else:
            continue
        if best is None or score > best[0]:
            best = (score, i)
    if best is None:
        return [part]
    i = start + best[1]
    return [part[:i], part[i:]]


def _apply_splits(words: list[Word], lang: str) -> list[Word]:
    """Split glued words, sharing each word's box out by character count."""
    out: list[Word] = []
    for w in words:
        parts = split_glued(w.text, lang)
        if len(parts) == 1:
            out.append(w)
            continue
        total = sum(len(p) for p in parts) or 1
        x, step = w.x0, (w.x1 - w.x0) / total
        for p in parts:
            out.append(Word(p, w.score, x, w.y0, x + step * len(p), w.y1))
            x += step * len(p)
    return out


def lines_of(result: Any, lang: str = "nl") -> list[Line]:
    """RapidOCR output -> lines with word boxes (lines without text dropped, glued words
    split: :func:`split_glued`)."""
    if result is None or result.boxes is None or result.txts is None:
        return []
    word_results = result.word_results or ()
    lines: list[Line] = []
    rows = zip(result.boxes, result.txts, result.scores, strict=False)
    for i, (box, text, score) in enumerate(rows):
        words: list[Word] = []
        if i < len(word_results):
            for item in word_results[i]:
                wtext, wscore, wbox = item[0], item[1], item[2]
                # Word boxes come per run of characters; split runs that hold spaces.
                for piece in _split_words(str(wtext), float(wscore), wbox):
                    if piece.text.strip():
                        words.append(piece)
        if not words:
            words = _split_words(str(text), float(score), box)
        words = _apply_splits(words, lang)
        if words:
            words.sort(key=lambda w: w.x0)
            lines.append(Line(words))
    return lines


def _runs(spans: list[tuple[float, float, int]], gap: float) -> list[list[int]]:
    """Group intervals (start, end, index) whose gaps are below ``gap``."""
    groups: list[list[int]] = []
    end = None
    for start, stop, i in sorted(spans):
        if end is None or start - end >= gap:
            groups.append([i])
            end = stop
        else:
            groups[-1].append(i)
            end = max(end, stop)
    return groups


def _rows(lines: list[Line]) -> list[list[Line]]:
    """Lines grouped into rows (overlapping vertically by at least half a line), top down."""
    rows: list[list[Line]] = []
    for ln in sorted(lines, key=lambda ln: (ln.y0 + ln.y1) / 2):
        mid = (ln.y0 + ln.y1) / 2
        if rows:
            last = rows[-1]
            y0 = min(item.y0 for item in last)
            y1 = max(item.y1 for item in last)
            if y0 <= mid <= y1:
                last.append(ln)
                continue
        rows.append([ln])
    return [sorted(r, key=lambda ln: ln.x0) for r in rows]


def layout(lines: list[Line]) -> list[list[list[Line]]]:
    """Lines -> blocks in reading order; a block is a list of rows, a row a list of lines."""
    if not lines:
        return []
    heights = sorted(ln.height for ln in lines)
    h = max(1.0, heights[len(heights) // 2])
    blocks: list[list[list[Line]]] = []

    def cut(items: list[Line]) -> None:
        by_y = _runs([(ln.y0, ln.y1, i) for i, ln in enumerate(items)], Y_GAP * h)
        if len(by_y) > 1:
            for g in by_y:
                cut([items[i] for i in g])
            return
        by_x = _runs([(ln.x0, ln.x1, i) for i, ln in enumerate(items)], X_GAP * h)
        if len(by_x) > 1:
            width = max(ln.x1 for ln in items) - min(ln.x0 for ln in items)
            cols = [[items[i] for i in g] for g in by_x]
            narrow = any(
                max(ln.x1 for ln in c) - min(ln.x0 for ln in c) < NARROW * width for c in cols
            )
            if len(cols) == 2 and not narrow:
                for c in sorted(cols, key=lambda c: min(ln.x0 for ln in c)):
                    cut(c)
                return
        blocks.append(_rows(items))

    cut(lines)
    return blocks


def to_data(blocks: list[list[list[Line]]]) -> dict[str, list[Any]]:
    """Blocks -> rows shaped like an ``image_to_data`` table (one row per word)."""
    keys = ("text", "conf", "block_num", "par_num", "line_num", "left", "top", "width", "height")
    data: dict[str, list[Any]] = {k: [] for k in keys}
    for b, rows in enumerate(blocks, start=1):
        for r, row in enumerate(rows, start=1):
            for ln in row:
                for w in ln.words:
                    data["text"].append(w.text)
                    data["conf"].append(round(w.score * 100, 2))
                    data["block_num"].append(b)
                    data["par_num"].append(1)
                    data["line_num"].append(r)
                    data["left"].append(round(w.x0))
                    data["top"].append(round(w.y0))
                    data["width"].append(max(1, round(w.x1 - w.x0)))
                    data["height"].append(max(1, round(w.y1 - w.y0)))
    return data


def recognize(img: Image.Image, lang: str = "nl") -> dict[str, list[Any]]:
    """OCR one page image; ``image_to_data``-shaped rows in reading order (see the module
    docstring)."""
    import numpy as np

    arr = np.asarray(img.convert("RGB"))
    # RapidOCR expects OpenCV's BGR channel order for arrays.
    result = _engine()(arr[:, :, ::-1].copy())
    return to_data(layout(lines_of(result, lang)))
