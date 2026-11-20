"""Pure text cleanup for PDF-extracted and OCR'd text (no I/O, no model dependencies).

Pipeline (:func:`clean_pages`): normalise characters -> drop running headers/footers and bare
page numbers -> de-hyphenate and re-flow lines into paragraphs -> join pages (merging a
paragraph that continues across a page break).

Example::

    >>> clean_pages(["Het was een lange, moeilijke woor-\\nden verhaal.\\n\\nNieuw."])
    'Het was een lange, moeilijke woorden verhaal.\\n\\nNieuw.'
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter

_LIGATURES = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",
    "\ufb06": "st",
    "\u0132": "IJ",
    "\u0133": "ij",
}
_QUOTES = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u201f": '"',
        "\u00ab": '"',
        "\u00bb": '"',
    }
)
_INVISIBLE = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff"), None)
_SPACES = str.maketrans({"\u00a0": " ", "\u2009": " ", "\u202f": " ", "\u2002": " ", "\u2003": " "})

# Words that follow a suspended hyphen in Dutch ("land- en tuinbouw"): keep "- ".
_SUSPENDED_HYPHEN_NEXT = {"en", "of", "en/of", "tot", "noch"}
_HYPHENS = "-\u2010"
_TERMINAL = ".!?\u2026:\"')]\u00bb"
_PAGE_NUMBER = re.compile(
    r"^\s*(?:[-\u2013\u2014]\s*)?(?:(?:page|pagina|blz\.?|p\.|s\.)\s*)?"
    r"(?:\d{1,4}|(?=[ivxlc])(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))\s*(?:[-\u2013\u2014])?\s*(?:/\s*\d{1,4})?\s*$",
    re.IGNORECASE,
)
_EDGE_LINES = 2  # how many lines at the top/bottom of a page may be header/footer
_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")


def normalize_text(text: str) -> str:
    """Normalise unicode, ligatures, quotes and whitespace (line breaks are preserved).

    Removes soft hyphens and zero-width characters, expands ligatures (``\\ufb01`` -> ``fi``),
    turns typographic quotes/apostrophes into ASCII, and collapses runs of spaces/tabs.
    """
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    # PDFium marks a line-end hyphen (and swallows its line break) as U+FFFE: restore it so
    # de-hyphenation can decide between a break hyphen and a real compound.
    text = text.replace(chr(0xFFFE), "-\n")
    text = text.replace(chr(0xAD), "").translate(_INVISIBLE)
    for lig, plain in _LIGATURES.items():
        text = text.replace(lig, plain)
    text = text.translate(_QUOTES).translate(_SPACES)
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def is_page_number(line: str) -> bool:
    """True for a bare page number line: ``12``, ``- 12 -``, ``Pagina 3``, ``iv``, ``3 / 10``."""
    return bool(_PAGE_NUMBER.match(line)) and bool(line.strip())


def _signature(line: str) -> str:
    """Line key for repetition detection: lowercase, digits collapsed (running page counters)."""
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", line.lower())).strip()


def _edge_indices(lines: list[str]) -> list[int]:
    """Indices of non-blank lines within the first/last few non-blank lines of a page."""
    idx = [i for i, ln in enumerate(lines) if ln.strip()]
    return sorted(set(idx[:_EDGE_LINES] + idx[-_EDGE_LINES:]))


def remove_running_lines(pages: list[str]) -> list[str]:
    """Drop headers/footers repeated across pages and bare page numbers at page edges.

    A page-edge line is removed when its digit-normalised form occurs at the edge of at
    least two pages and at least half of all pages. Bare page numbers at the edges are
    always removed (also on single-page input).
    """
    split = [p.split("\n") for p in pages]
    counts: Counter[str] = Counter()
    for lines in split:
        counts.update({_signature(lines[i]) for i in _edge_indices(lines)})
    min_pages = max(2, (len(pages) + 1) // 2)
    repeated = {sig for sig, n in counts.items() if n >= min_pages and len(pages) >= 2}
    cleaned: list[str] = []
    for lines in split:
        drop = {
            i
            for i in _edge_indices(lines)
            if is_page_number(lines[i]) or _signature(lines[i]) in repeated
        }
        kept = [ln for i, ln in enumerate(lines) if i not in drop]
        cleaned.append("\n".join(kept).strip("\n"))
    return cleaned


def join_lines(prev: str, nxt: str) -> str:
    """Join two consecutive lines of one paragraph, repairing a line-end hyphenation.

    * ``woor-`` + ``den`` -> ``woorden`` (next part is lowercase: the hyphen was a break)
    * ``Noord-`` + ``Amerika`` -> ``Noord-Amerika`` (capitalised: a real compound)
    * ``land-`` + ``en tuinbouw`` -> ``land- en tuinbouw`` (suspended hyphen)
    * otherwise the lines are joined by one space.
    """
    prev, nxt = prev.rstrip(), nxt.lstrip()
    if not prev:
        return nxt
    if not nxt:
        return prev
    if len(prev) >= 2 and prev[-1] in _HYPHENS and prev[-2].isalpha():
        first = nxt.split(" ", 1)[0]
        if first.lower() in _SUSPENDED_HYPHEN_NEXT:
            return f"{prev} {nxt}"
        if first[:1].islower():
            return prev[:-1] + nxt
        if first[:1].isalpha():
            return prev + nxt
    return f"{prev} {nxt}"


def _ends_paragraph(prev: str, longest: int) -> bool:
    """Heuristic for OCR text without blank lines: a short line ending a sentence ends a block."""
    return bool(prev) and prev[-1] in ".!?\u2026" and longest >= 40 and len(prev) < 0.6 * longest


def reflow_paragraph(block: str) -> str:
    """Merge the hard-wrapped lines of one blank-line-delimited block into paragraph(s).

    Returns one or more paragraphs separated by a blank line (a block is split again where a
    markedly short line ends a sentence, as at the end of a paragraph in OCR output).
    """
    lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
    if not lines:
        return ""
    longest = max(len(ln) for ln in lines)
    paragraphs: list[str] = []
    current = lines[0]
    for prev_line, line in zip(lines, lines[1:], strict=False):
        if _ends_paragraph(prev_line, longest) and line[:1].isupper():
            paragraphs.append(current)
            current = line
        else:
            current = join_lines(current, line)
    paragraphs.append(current)
    return "\n\n".join(paragraphs)


def _page_paragraphs(page: str) -> list[str]:
    blocks = (reflow_paragraph(b) for b in _PARAGRAPH_SPLIT.split(page))
    return [p for b in blocks for p in b.split("\n\n") if p]


def _continues(prev: str, nxt: str) -> bool:
    """True when ``nxt`` (first paragraph of a page) continues ``prev`` (the last one before)."""
    if not prev or not nxt:
        return False
    if prev[-1] in _HYPHENS and len(prev) >= 2 and prev[-2].isalpha():
        return True
    return prev[-1] not in _TERMINAL and nxt[0].islower()


def clean_pages(pages: list[str]) -> str:
    """Full cleanup of per-page text; returns paragraphs separated by blank lines."""
    pages = [normalize_text(p) for p in pages]
    pages = remove_running_lines(pages)
    paragraphs: list[str] = []
    for page in pages:
        page_paras = _page_paragraphs(page)
        if not page_paras:
            continue
        if paragraphs and _continues(paragraphs[-1], page_paras[0]):
            paragraphs[-1] = join_lines(paragraphs[-1], page_paras[0])
            page_paras = page_paras[1:]
        paragraphs.extend(page_paras)
    return "\n\n".join(paragraphs)


def clean_text(text: str) -> str:
    """Cleanup for a single block of text (form feeds, if any, are treated as page breaks)."""
    return clean_pages(text.split("\f"))
