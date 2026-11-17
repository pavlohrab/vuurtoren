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


def detect(texts: list[str]) -> list[Detection]:
    det = _detector()
    out: list[Detection] = []
    for text in texts:
        if not text.strip():
            out.append(Detection(lang=None, confidence=0.0))
            continue
        best = det.compute_language_confidence_values(text)[0]
        out.append(Detection(lang=ISO.get(best.language.name), confidence=round(best.value, 4)))
    return out
