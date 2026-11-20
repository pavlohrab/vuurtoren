"""Word frequency (Zipf scale) lookups backed by ``wordfreq``."""

from __future__ import annotations

from functools import lru_cache


@lru_cache(maxsize=65536)
def zipf(word: str, lang: str = "nl") -> float:
    """Zipf frequency of ``word`` (about 7 = very common, 1 = rare, 0 = unknown). Cached."""
    from wordfreq import zipf_frequency

    return float(zipf_frequency(word, lang))


def token_zipf(lemma: str, surface: str, is_word: bool, lang: str = "nl") -> float:
    """Zipf frequency for a token: the lemma, else the lowercased surface, else 0.

    Non-words (punctuation, numbers, symbols) always score 0.
    """
    if not is_word:
        return 0.0
    score = zipf(lemma, lang)
    if score == 0.0:
        score = zipf(surface.lower(), lang)
    return score
