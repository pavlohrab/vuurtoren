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


class TextAnalysis(BaseModel):
    tokens: list[Token]


class TermAnalysis(BaseModel):
    input: str
    key: str
    """Normalised lookup key (casefolded lemma or lemma phrase). Empty if nothing usable."""
    lemma: str
    pos: str
    article: str | None = None
    reflexive: bool = False
    multiword: bool = False


class DetectRequest(BaseModel):
    texts: list[str] = Field(max_length=5000)


class Detection(BaseModel):
    lang: str | None
    confidence: float
