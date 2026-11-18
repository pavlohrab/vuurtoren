"""Language identification for short strings (used to auto-detect Anki decks/fields).

A small naive-Bayes classifier built from data we already ship: ``wordfreq``'s "small" word
lists (top ~30k words per language). Each word scores its log-frequency in each language; a word
missing from a list scores a floor plus a character-trigram estimate trained on that list's
spelling, so rare words (``woordeloos``) still lean towards the right language. Scripts are
separated first (Cyrillic vs Latin), so Ukrainian/Russian never compete with Dutch.

It replaced ``lingua`` (~290 MB of n-gram models) in D1; see docs/research/10-nlp-footprint.md
for the accuracy comparison on Tatoeba sentences and dictionary words.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from functools import lru_cache

from kenning_nlp.models import DETECT_SAMPLE_CHARS, Detection

DETECTOR_VERSION = "wf1"
"""Bumped whenever the classifier changes (part of the analyzer version)."""

LATIN = ("nl", "en", "de", "fr", "es", "it", "pt", "pl")
CYRILLIC = ("uk", "ru")
LANGS = LATIN + CYRILLIC

MIN_CONFIDENCE = 0.2
OOV_FLOOR = -7.0  # log10 frequency of a word missing from a list (the lists stop near 1e-6)
_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*")
_CYR = re.compile(r"[Ѐ-ӿ]")


def _trigrams(word: str) -> list[str]:
    padded = f"^{word}$"
    return [padded[i : i + 3] for i in range(len(padded) - 2)]


class _Model:
    """Word log10-frequencies plus a smoothed char-trigram model for one language."""

    def __init__(self, freqs: dict[str, float]) -> None:
        self.words = {w: math.log10(f) for w, f in freqs.items() if f > 0}
        tri: Counter[str] = Counter()
        for w in self.words:
            if _WORD.fullmatch(w):
                tri.update(_trigrams(w))
        self.tri = tri
        self.tri_denominator = sum(tri.values()) + len(tri) + 1

    def word_score(self, word: str) -> float:
        known = self.words.get(word)
        if known is not None:
            return known
        # Add-one smoothed trigram log-probability, averaged so long words are not punished.
        grams = _trigrams(word)
        logp = sum(math.log10((self.tri.get(g, 0) + 1) / self.tri_denominator) for g in grams)
        return OOV_FLOOR + logp / len(grams)


@lru_cache(maxsize=len(LANGS))
def _model(lang: str) -> _Model:
    from wordfreq import get_frequency_dict

    return _Model(get_frequency_dict(lang, wordlist="small"))


def _classify(words: list[str], langs: tuple[str, ...]) -> tuple[str, float]:
    scores = {lang: sum(_model(lang).word_score(w) for w in words) for lang in langs}
    # Softmax over the log-likelihoods (log10 -> natural log).
    top = max(scores.values())
    exp = {lang: math.exp((s - top) * math.log(10)) for lang, s in scores.items()}
    best = max(exp, key=lambda k: exp[k])
    return best, exp[best] / sum(exp.values())


def detect(texts: list[str]) -> list[Detection]:
    """Best language per text, or ``None`` for letterless / undecidable input.

    Only the first ``DETECT_SAMPLE_CHARS`` characters are examined (bounds the cost of huge
    inputs). Results below ``MIN_CONFIDENCE`` are reported as unknown.
    """
    out: list[Detection] = []
    for full_text in texts:
        words = _WORD.findall(full_text[:DETECT_SAMPLE_CHARS].lower())
        if not words:
            out.append(Detection(lang=None, confidence=0.0))
            continue
        cyrillic = sum(len(_CYR.findall(w)) for w in words) * 2 > sum(map(len, words))
        lang, conf = _classify(words, CYRILLIC if cyrillic else LATIN)
        conf = round(conf, 4)
        out.append(Detection(lang=lang if conf >= MIN_CONFIDENCE else None, confidence=conf))
    return out
