from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Lang = Literal["nl"]

MAX_TEXT_CHARS = 200_000
"""Per-text limit of ``/analyze/text`` (characters). Longer texts are rejected with 422."""
MAX_TERM_CHARS = 500
"""Per-item limit of ``/analyze/terms``."""
MAX_TOTAL_CHARS = 2_000_000
"""Sum of all string lengths in one request; above it the API answers 413."""
MAX_ITEMS = 5000
DETECT_SAMPLE_CHARS = 400
"""``/detect`` only looks at the first this-many characters of each string (no length limit)."""

TextStr = Annotated[str, StringConstraints(max_length=MAX_TEXT_CHARS)]
TermStr = Annotated[str, StringConstraints(max_length=MAX_TERM_CHARS)]


class AnalyzeRequest(BaseModel):
    """``POST /analyze/text``: each text at most :data:`MAX_TEXT_CHARS` characters."""

    lang: Lang
    texts: list[TextStr] = Field(max_length=MAX_ITEMS)


class AnalyzeTermsRequest(BaseModel):
    """``POST /analyze/terms``: each term at most :data:`MAX_TERM_CHARS` characters."""

    lang: Lang
    texts: list[TermStr] = Field(max_length=MAX_ITEMS)


class Token(BaseModel):
    """One token. ``start``/``end`` are offsets in UTF-16 code units (what JavaScript's
    ``String.slice`` uses), NOT Python code points: they differ for text with characters above
    U+FFFF (emoji, rare CJK), where each such character counts as 2."""

    i: int
    text: str
    lemma: str
    alt_lemmas: list[str] = []
    """Other plausible lemmas (model vs dictionary); the matcher tries all of them."""
    pos: str
    morph: str
    dep: str
    head: int
    sent: int
    start: int
    end: int
    is_word: bool
    is_propn: bool
    is_num: bool
    particle_of: int | None = None
    """For a detached separable particle: index of its verb."""
    zipf: float = 0.0
    """wordfreq Zipf frequency of the lemma (surface fallback): ~7 common, ~1 rare, 0 unknown."""


class TextAnalysis(BaseModel):
    tokens: list[Token]


class TermAnalysis(BaseModel):
    input: str
    key: str
    """Normalised headword (citation form; NFKC, curly quotes -> ', lower, strip — see
    ``pipeline.normalize_key``). Empty if nothing usable."""
    aliases: list[str] = []
    """Alternative spellings/forms given on the card, e.g. ``ze`` for ``zij, ze``."""
    lemma: str
    """spaCy's lemma guess for the headword (informational; not used as key)."""
    pos: str
    article: str | None = None
    reflexive: bool = False
    multiword: bool = False


class DetectRequest(BaseModel):
    """``POST /detect``: strings of any length (only the first 400 characters are used)."""

    texts: list[str] = Field(max_length=MAX_ITEMS)


class Detection(BaseModel):
    lang: str | None
    confidence: float


class ExtractUrlRequest(BaseModel):
    url: str = Field(max_length=2048)


class UrlExtraction(BaseModel):
    title: str
    text: str
    url: str
    """Final URL after redirects."""


class PdfExtraction(BaseModel):
    title: str
    text: str
    pages: int
    needs_ocr: bool
    """True when the PDF has (almost) no text layer: send it to /ocr instead."""


class OcrResult(BaseModel):
    text: str
    confidence: float
    """Mean word confidence, 0..1."""
    pages: int


class GlossRequest(BaseModel):
    lang: Lang
    words: list[str] = Field(max_length=2000)


class GlossPart(BaseModel):
    part: str
    """Surface text of the compound part."""
    gloss: str | None = None
    """First full gloss of the part's dictionary entry."""


class GlossEntry(BaseModel):
    pos: str
    article: str | None = None
    """``de`` / ``het`` for nouns (``de/het`` if senses disagree)."""
    glosses: list[str]
    """Short English senses (at most 5)."""
    compound: bool = False
    """True if the word has no entry and was analysed as a compound of ``parts``.
    ``glosses`` is then one string ``"souvenir shop (souvenir + winkel)"``; ``pos`` and
    ``article`` are the head's."""
    parts: list[GlossPart] | None = None
    """Compound parts in order (only when ``compound``)."""
