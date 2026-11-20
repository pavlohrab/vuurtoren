"""Small English word-formation helpers for glosses built from parts (``word`` + ``less``).

Each function takes one English word (or a short phrase whose first word is inflected, for verbs
like ``dig up``) and returns the derived form with the usual spelling changes: a final silent
``e`` drops before a vowel (``use`` -> ``usable``), ``y`` after a consonant becomes ``i``
(``happy`` -> ``happiness``), and a short final consonant doubles (``stop`` -> ``stopping``).
"""

from __future__ import annotations

import re

_VOWELS = "aeiou"

# Past participles of common irregular verbs (for "un-" + participle: "unwritten").
_IRREGULAR_PARTICIPLES = {
    "be": "been",
    "begin": "begun",
    "bite": "bitten",
    "break": "broken",
    "bring": "brought",
    "build": "built",
    "buy": "bought",
    "choose": "chosen",
    "do": "done",
    "draw": "drawn",
    "drink": "drunk",
    "drive": "driven",
    "eat": "eaten",
    "fall": "fallen",
    "feel": "felt",
    "find": "found",
    "fly": "flown",
    "forget": "forgotten",
    "forgive": "forgiven",
    "freeze": "frozen",
    "get": "got",
    "give": "given",
    "go": "gone",
    "grow": "grown",
    "hear": "heard",
    "hide": "hidden",
    "hold": "held",
    "keep": "kept",
    "know": "known",
    "lose": "lost",
    "make": "made",
    "pay": "paid",
    "read": "read",
    "ride": "ridden",
    "say": "said",
    "see": "seen",
    "sell": "sold",
    "send": "sent",
    "shake": "shaken",
    "sing": "sung",
    "speak": "spoken",
    "spend": "spent",
    "steal": "stolen",
    "take": "taken",
    "teach": "taught",
    "tell": "told",
    "think": "thought",
    "throw": "thrown",
    "understand": "understood",
    "wear": "worn",
    "win": "won",
    "write": "written",
}


def _split(phrase: str) -> tuple[str, str]:
    """``("dig", " up")``: the word to inflect and the rest of the phrase."""
    head, sep, rest = phrase.partition(" ")
    return head, sep + rest


def _syllables(word: str) -> int:
    return len(re.findall(r"[aeiouy]+", word.lower())) or 1


def _doubles(word: str) -> bool:
    """True if a one-syllable word ending consonant-vowel-consonant doubles (``stop``)."""
    w = word.lower()
    return (
        len(w) >= 3
        and _syllables(w) == 1
        and w[-1] not in _VOWELS + "wxy"
        and w[-2] in _VOWELS
        and w[-3] not in _VOWELS
    )


def _vowel_suffix(word: str, suffix: str) -> str:
    """``word`` + a suffix starting with a vowel (silent e drops, y -> i, consonant doubles)."""
    w = word
    if w.endswith("ie") and suffix == "ing":
        return w[:-2] + "ying"
    if w.endswith("e") and not w.endswith(("ee", "ye", "oe")):
        if suffix.startswith(("a", "o")) and w.endswith(("ce", "ge")):
            return w + suffix
        return w[:-1] + suffix
    if w.endswith("y") and len(w) > 2 and w[-2] not in _VOWELS and suffix != "ing":
        return w[:-1] + "i" + suffix
    if _doubles(w):
        return w + w[-1] + suffix
    return w + suffix


def _consonant_suffix(word: str, suffix: str) -> str:
    """``word`` + a suffix starting with a consonant (y -> i after a consonant, long words)."""
    if word.endswith("y") and len(word) > 3 and word[-2] not in _VOWELS:
        return word[:-1] + "i" + suffix
    return word + suffix


def ing(phrase: str) -> str:
    head, rest = _split(phrase)
    return _vowel_suffix(head, "ing") + rest


def agent(phrase: str) -> str:
    """``bake`` -> ``baker``, ``translate`` -> ``translator``."""
    head, rest = _split(phrase)
    if head.endswith("ate") and _syllables(head) > 1:
        return head[:-1] + "or" + rest
    return _vowel_suffix(head, "er") + rest


def able(phrase: str) -> str:
    head, rest = _split(phrase)
    return _vowel_suffix(head, "able") + rest


def ness(word: str) -> str:
    return _consonant_suffix(word, "ness")


def less(word: str) -> str:
    return _consonant_suffix(word, "less")


def ly(word: str) -> str:
    if word.endswith("le") and len(word) > 3 and word[-3] not in _VOWELS:
        return word[:-1] + "y"
    if word.endswith("ic") and word != "public":
        return word + "ally"
    return _consonant_suffix(word, "ly")


def y(word: str) -> str:
    """Adjective in ``-y``: ``powder`` -> ``powdery``, ``flake`` -> ``flaky``."""
    if word.endswith("y"):
        return word
    return _vowel_suffix(word, "y")


def ish(word: str) -> str:
    return _vowel_suffix(word, "ish")


def ity(word: str) -> str:
    """``original`` -> ``originality``, ``active`` -> ``activity``, ``nervous`` -> ``nervosity``."""
    if word.endswith("ble"):
        return word[:-3] + "bility"
    if word.endswith("ous"):
        return word[:-3] + "osity"
    if word.endswith("e"):
        return word[:-1] + "ity"
    return word + "ity"


def ic(word: str) -> str:
    """Adjective in ``-ic``: ``symphony`` -> ``symphonic``, ``drama`` -> ``dramatic``."""
    if word.endswith("ics"):
        return word[:-1]
    if word.endswith(("ist", "ic", "an", "ese", "ish")):
        return word  # sexist, Armenian, Japanese: already adjectives
    if word.endswith("ism"):
        return word[:-1] + "tic"
    if word.endswith("ia"):
        return word[:-2] + "ic"
    if word.endswith("a"):
        return word + "tic"
    if word.endswith(("y", "e")):
        return word[:-1] + "ic"
    return word + "ic"


def participle(phrase: str) -> str:
    """Past participle: ``protect`` -> ``protected``, ``write`` -> ``written``."""
    head, rest = _split(phrase)
    if head in _IRREGULAR_PARTICIPLES:
        return _IRREGULAR_PARTICIPLES[head] + rest
    if head.endswith("e"):
        return head + "d" + rest
    return _vowel_suffix(head, "ed") + rest


def having(word: str) -> str:
    """Second half of ``two-handed``: ``hand`` -> ``handed``, ``lip`` -> ``lipped``."""
    if word.endswith("ed"):
        return word
    return _vowel_suffix(word, "ed")


def prefixed(prefix: str, phrase: str) -> str:
    """``un`` + ``happy``; ``re-`` takes a hyphen before an ``e`` (``re-elect``)."""
    if prefix == "re" and phrase[:1] == "e":
        return f"{prefix}-{phrase}"
    return prefix + phrase
