"""Language identification for short strings (used to auto-detect Anki decks/fields)."""

from __future__ import annotations

from functools import lru_cache

from kenning_nlp.models import Detection

ISO = {
    "DUTCH": "nl",
    "ENGLISH": "en",
    "GERMAN": "de",
    "UKRAINIAN": "uk",
    "RUSSIAN": "ru",
    "FRENCH": "fr",
    "SPANISH": "es",
    "ITALIAN": "it",
    "PORTUGUESE": "pt",
    "POLISH": "pl",
    "AFRIKAANS": "af",
}


@lru_cache(maxsize=1)
def _detector():  # type: ignore[no-untyped-def]
    from lingua import Language, LanguageDetectorBuilder

    langs = [getattr(Language, name) for name in ISO]
    return LanguageDetectorBuilder.from_languages(*langs).build()


MIN_CONFIDENCE = 0.2


def detect(texts: list[str]) -> list[Detection]:
    """Best language per text, or ``None`` for letterless / undecidable input.

    lingua returns an all-zero confidence list for e.g. "17.31", whose first entry is
    arbitrary — so low-confidence results are reported as unknown.
    """
    det = _detector()
    out: list[Detection] = []
    for text in texts:
        if not any(c.isalpha() for c in text):
            out.append(Detection(lang=None, confidence=0.0))
            continue
        best = det.compute_language_confidence_values(text)[0]
        if best.value < MIN_CONFIDENCE:
            out.append(Detection(lang=None, confidence=round(best.value, 4)))
            continue
        out.append(Detection(lang=ISO.get(best.language.name), confidence=round(best.value, 4)))
    return out
