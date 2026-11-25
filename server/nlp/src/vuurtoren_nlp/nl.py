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

# Circumpositions: the second word belongs to the preposition, not to the verb. "Ze ging naar
# hem toe" is gaan (no toegaan), "Hij keek om zich heen" is kijken, "van de grond af".
CIRCUMPOSITIONS: dict[str, set[str]] = {
    "toe": {"naar", "tot"},
    "heen": {"om", "door", "over", "langs", "naar"},
    "af": {"op", "van"},
    "uit": {"van"},
    "aan": {"achter"},
    "door": {"tussen", "dwars"},
}
# "z'n" is a possessive ("z'n best doen"), not a reflexive marker.
REFLEXIVES = {"zich"}
# Fixed expressions that start with an article and must not lose it ("de facto" is not "facto").
FIXED_ARTICLE_EXPRESSIONS = {"de facto", "de jure", "de luxe", "de rigueur", "het hoc"}
# Function words that, on both sides of a slash, form one term ("en/of"), not alternatives.
SLASH_FIXED = {"en", "of", "dan", "wel", "maar", "noch"}

# R-pronouns: "er/daar/hier/waar" + preposition form a stranded-preposition construction
# ("Waar wacht je op?", "Ik denk er niet aan") in which the clause-final preposition is NOT a
# separable particle.
R_WORDS = ("er", "daar", "hier", "waar")
_R_PREPOSITIONS = (
    "aan", "achter", "af", "bij", "binnen", "door", "in", "mee", "na", "naar", "om", "onder",
    "op", "over", "tegen", "toe", "tussen", "uit", "van", "voor",
)  # fmt: skip
R_PRONOUNS = frozenset(R_WORDS) | {r + p for r in R_WORDS for p in _R_PREPOSITIONS}


def is_r_pronoun(word: str) -> bool:
    """True for ``er``/``daar``/``hier``/``waar`` and their R-compounds (``ervan``, ``waarop``)."""
    return word.lower() in R_PRONOUNS


def strip_unattested_particle(lemma: str, surface: str) -> str:
    """Remove a separable particle that spaCy invented in a verb lemma.

    spaCy's nl lemmatizer sometimes returns e.g. ``bel -> terugbellen``. If the lemma
    starts with a particle that the surface form does not START with, drop it. (A substring
    test would wrongly keep ``oplopen`` for ``loopt``, which merely contains "op".) Participles
    keep the particle before ``ge``: ``opgebeld`` starts with ``op``.
    """
    low_lemma, low_surface = lemma.lower(), surface.lower()
    for p in SEPARABLE_PARTICLES:
        if (
            low_lemma.startswith(p)
            and len(low_lemma) > len(p) + 2
            and not low_surface.startswith(p)
        ):
            return lemma[len(p) :]
    return lemma


def join_particle(particle: str, base: str, surface: str = "") -> str:
    """Combine a detached particle with its verb lemma: ``op`` + ``bellen`` -> ``opbellen``.

    If the verb already carries a fused particle visible at the START of its surface form
    ("van de grond af opgebouwd": base ``opbouwen``), the detached word is not joined.
    The result is lowercase.
    """
    p = particle.lower()
    low = base.lower()
    if low.startswith(p):
        return low
    low_surface = surface.lower()
    if any(low.startswith(q) and low_surface.startswith(q) for q in SEPARABLE_PARTICLES):
        return low
    return p + low
