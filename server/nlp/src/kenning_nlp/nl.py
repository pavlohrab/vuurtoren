"""Dutch-specific normalisation rules on top of spaCy's nl pipeline."""

from __future__ import annotations

# Separable verb particles (scheidbare werkwoorden), longest first for prefix matching.
SEPARABLE_PARTICLES: tuple[str, ...] = tuple(
    sorted(
        {
            "aan",
            "achter",
            "achterna",
            "af",
            "bij",
            "binnen",
            "buiten",
            "dicht",
            "door",
            "heen",
            "in",
            "kapot",
            "klaar",
            "langs",
            "los",
            "mee",
            "na",
            "neer",
            "om",
            "onder",
            "op",
            "open",
            "over",
            "rond",
            "samen",
            "schoon",
            "stil",
            "tegen",
            "terecht",
            "terug",
            "thuis",
            "toe",
            "uit",
            "vast",
            "voor",
            "voorbij",
            "vrij",
            "weg",
            "weer",
        },
        key=len,
        reverse=True,
    )
)

ARTICLES = {"de", "het", "een", "'t"}
REFLEXIVES = {"zich", "z'n"}


def strip_unattested_particle(lemma: str, surface: str) -> str:
    """Remove a separable particle that spaCy invented in a verb lemma.

    spaCy's nl lemmatizer sometimes returns e.g. ``bel -> terugbellen``. If the lemma
    starts with a particle that does not occur in the surface form, drop it.
    """
    low_lemma, low_surface = lemma.lower(), surface.lower()
    for p in SEPARABLE_PARTICLES:
        if low_lemma.startswith(p) and len(low_lemma) > len(p) + 2 and p not in low_surface:
            return lemma[len(p) :]
    return lemma


def join_particle(particle: str, base: str) -> str:
    """Combine a detached particle with its verb lemma: ``op`` + ``bellen`` -> ``opbellen``."""
    p = particle.lower()
    return base if base.lower().startswith(p) else p + base
