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
# Non-particle first parts of separable verbs seen in te-infinitives: "waar te nemen".
TE_PARTICLES = {"waar", "plaats", "deel", "teleur", "gade", "kennis"}
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


def join_particle(particle: str, base: str, surface: str = "") -> str:
    """Combine a detached particle with its verb lemma: ``op`` + ``bellen`` -> ``opbellen``.

    If the verb already carries a fused particle visible in its surface form
    ("van de grond af opgebouwd": base ``opbouwen``), the detached word is not joined.
    """
    p = particle.lower()
    low = base.lower()
    if low.startswith(p):
        return base
    if any(low.startswith(q) and q in surface.lower() for q in SEPARABLE_PARTICLES):
        return base
    return p + base
