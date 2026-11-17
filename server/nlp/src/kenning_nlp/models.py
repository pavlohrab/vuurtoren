from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Lang = Literal["nl"]


class AnalyzeRequest(BaseModel):
    lang: Lang
    texts: list[str] = Field(max_length=5000)


class Token(BaseModel):
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
    """Normalised headword (citation form, casefolded). Empty if nothing usable."""
    aliases: list[str] = []
    """Alternative spellings/forms given on the card, e.g. ``ze`` for ``zij, ze``."""
    lemma: str
    """spaCy's lemma guess for the headword (informational; not used as key)."""
    pos: str
    article: str | None = None
    reflexive: bool = False
    multiword: bool = False


class DetectRequest(BaseModel):
    texts: list[str] = Field(max_length=5000)


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


class GlossEntry(BaseModel):
    pos: str
    article: str | None = None
    """``de`` / ``het`` for nouns (``de/het`` if senses disagree)."""
    glosses: list[str]
    """Short English senses (at most 5)."""
