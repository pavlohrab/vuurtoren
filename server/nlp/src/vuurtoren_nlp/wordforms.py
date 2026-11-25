"""Morphology for practice exercises (``POST /forms``): the TypeScript ``WordForms`` shape.

Two halves, like :mod:`vuurtoren_nlp.dictionary`:

* :func:`extract_word_forms` turns ONE Kaikki entry (raw JSON) into a ``WordForms`` dict. It is
  called by ``build_dictionary`` and stored in the ``wordforms`` table (so the 250 MB JSONL is
  only needed at build time) and by the tests with small fixtures.
* :class:`WordFormsStore` is the read-only lookup. It also resolves the perfect-tense auxiliary
  (see below) and falls back to the particle list in :mod:`vuurtoren_nlp.nl` for separable verbs
  that Wiktionary has no entry for.

Where each field comes from (English Wiktionary via Kaikki)::

    verbs      participle / past / present   conjugation rows of ``forms`` (tags first-person,
                                             past, plural, participle ...; separable verbs use
                                             the ``main-clause`` rows: "belde op")
               separable                     main-clause row "bel op" (last word = particle), else
                                             the category "Dutch separable verbs with op"
               aux                           ``aux=`` of the conjugation template (264 verbs);
                                             else see ``resolve_aux``
    nouns      plural, diminutive            ``forms`` tags ``plural`` / ``diminutive``
    adjectives comparative, superlative      ``forms`` tags; ``inflected`` is the declension
                                             row "definite positive" (mooi -> mooie)

Wiktionary does NOT record the auxiliary for ~97 % of verbs, so ``aux`` is resolved as:
Wiktionary template -> corpus evidence (``aux_evidence`` table of the Tatoeba sentence DB:
participle with a hebben/zijn auxiliary in the dependency parse) -> curated list of common
zijn-verbs (:data:`ZIJN_VERBS`, :data:`BOTH_VERBS`) -> ``hebben`` (the default for ~85 % of
Dutch verbs).
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from vuurtoren_nlp.nl import SEPARABLE_PARTICLES

# Form rows with any of these tags are not the plain textbook form.
_EXCLUDED = frozenset(
    {
        "archaic",
        "subjunctive",
        "formal",
        "Flanders",
        "colloquial",
        "majestic",
        "imperative",
        "dialectal",
        "obsolete",
        "rare",
        "dated",
        "nonstandard",
        "alternative",
        "table-tags",
        "inflection-template",
        "class",
    }
)

# spaCy UPOS -> Kaikki pos.
POS_MAP: dict[str, str] = {"VERB": "verb", "AUX": "verb", "NOUN": "noun", "ADJ": "adj"}


def _words(text: str) -> frozenset[str]:
    """Whitespace-separated word list -> frozenset (keeps the long lists below readable)."""
    return frozenset(text.split())


# Verbs that take "zijn" (motion / change of state), unprefixed base forms. Prefixed and
# separable verbs inherit from their stem (see :func:`curated_aux`).
ZIJN_VERBS = _words(
    "zijn gaan komen vallen blijven worden stijgen dalen groeien sterven overlijden verdwijnen "
    "gebeuren lukken slagen mislukken verschijnen opstaan vertrekken aankomen terugkomen "
    "ontstaan ontvallen ontsnappen ontwaken instappen uitstappen opstijgen afdalen wegglijden "
    "schrikken smelten stollen bevriezen ontdooien verdrinken verhuizen vluchten rijzen "
    "verbleken vergaan verzuren verrotten verwelken wennen opgroeien opschieten"
)
# Verbs whose perfect tense uses both, depending on sense (lopen/rijden/vliegen/zwemmen/varen:
# "ik ben naar huis gelopen" / "ik heb een uur gelopen").
BOTH_VERBS = _words(
    "lopen rijden vliegen zwemmen varen fietsen wandelen reizen springen duiken dansen "
    "klimmen kruipen rennen schaatsen trekken breken barsten"
)

# Verbs that only ever take "hebben" although a prefix/particle split or passive-heavy corpus
# evidence ("is aangevallen", "is onderbroken" are perfect PASSIVES) suggests "zijn".
HEBBEN_VERBS = _words("aanvallen overvallen onderbreken ondernemen onderhouden onderscheiden")
# Lexical entries whose two auxiliaries are both real; wins over one-sided corpus evidence
# ("zwemmen" is "hebben" in 7/7 sentences only because few of them name a destination).
# ``voorkomen``: zijn "to occur" / hebben "to prevent"; ``stoppen``: zijn "to halt".
BOTH_LEXICAL = _words("zwemmen voorkomen stoppen")
# Particles that are also inseparable verb prefixes (over+vallen = "overvallen", stressed on the
# stem, NOT "over" + "vallen"). A curated auxiliary is inherited through such a particle only
# when the split is confirmed by Wiktionary (``data["separable"]``), never by a guess.
AMBIGUOUS_PARTICLES = _words("over onder door om achter voor")

_AUX_VALUES = {"hebben", "zijn"}


def _tags(row: dict[str, Any]) -> set[str]:
    return {t for t in row.get("tags", []) if isinstance(t, str)}


def _plain_rows(entry: dict[str, Any]) -> list[tuple[str, set[str]]]:
    """(form, tags) of usable form rows: strings that are not placeholders or excluded variants."""
    out: list[tuple[str, set[str]]] = []
    for row in entry.get("forms", []):
        form = row.get("form")
        if not isinstance(form, str) or not form or form == "-":
            continue
        tags = _tags(row)
        if tags & _EXCLUDED:
            continue
        out.append((form, tags))
    return out


def _first(
    rows: list[tuple[str, set[str]]], need: set[str], avoid: Iterable[str] = ()
) -> str | None:
    """First form whose tags include all of ``need`` and none of ``avoid``."""
    banned = set(avoid)
    for form, tags in rows:
        if need <= tags and not tags & banned:
            return form
    return None


def _verb_forms(entry: dict[str, Any]) -> dict[str, Any]:
    rows = _plain_rows(entry)
    word = entry["word"]
    # Separable verbs have a main-clause ("belde op") and a subordinate-clause ("opbelde") row
    # per slot. Prefer main-clause; the participle row is tagged main-clause too.
    sep_rows = any("main-clause" in tags for _, tags in rows)
    avoid = {"subordinate-clause"} if sep_rows else set()
    out: dict[str, Any] = {}

    participle = _first(rows, {"participle", "past"})
    if participle:
        out["participle"] = participle
    past_sg = _first(rows, {"past", "first-person", "singular"}, avoid)
    past_pl = _first(rows, {"past", "plural"}, avoid)
    if past_sg and past_pl:
        out["past"] = [past_sg, past_pl]

    plural = _first(rows, {"present", "plural"}, avoid)
    present = {
        "ik": _first(rows, {"present", "first-person", "singular"}, avoid),
        "jij": _first(rows, {"present", "second-person", "singular"}, avoid),
        "hij": _first(rows, {"present", "third-person", "singular"}, avoid),
        "wij": plural,
        "jullie": plural,
        "zij": plural,
    }
    present = {k: v for k, v in present.items() if v}
    if present:
        out["present"] = present

    sep = _separable(entry, word, present.get("ik") if sep_rows else None)
    if sep:
        out["separable"] = sep

    aux = _template_aux(entry)
    if aux:
        out["aux"] = aux
    return out


def _separable(
    entry: dict[str, Any], word: str, main_clause_ik: str | None
) -> dict[str, str] | None:
    """``{"particle": "op", "stem": "bellen"}`` for a separable verb, else None."""
    # 1. "bel op": the last word of the first-person main-clause row is the particle.
    if main_clause_ik and " " in main_clause_ik:
        particle = main_clause_ik.split()[-1]
        if word.startswith(particle) and len(word) > len(particle) + 1:
            return {"particle": particle, "stem": word[len(particle) :]}
    # 2. Wiktionary category "Dutch separable verbs with op".
    prefix = "Dutch separable verbs with "
    cats = [c.get("name", "") for c in entry.get("categories", []) if isinstance(c, dict)]
    for s in entry.get("senses", []):
        cats += [c.get("name", "") for c in s.get("categories", []) if isinstance(c, dict)]
    for cat in cats:
        if cat.startswith(prefix):
            particle = cat[len(prefix) :]
            if word.startswith(particle) and len(word) > len(particle) + 1:
                return {"particle": particle, "stem": word[len(particle) :]}
    return None


def _template_aux(entry: dict[str, Any]) -> str | None:
    """Auxiliary from the conjugation template's ``aux=`` argument (``hebben,zijn`` -> both)."""
    for t in entry.get("inflection_templates", []) or []:
        raw = (t.get("args") or {}).get("aux")
        if not isinstance(raw, str):
            continue
        values = {v.strip() for v in raw.replace("/", ",").split(",")} & _AUX_VALUES
        if len(values) == 2:
            return "both"
        if values:
            return values.pop()
    return None


def _noun_forms(entry: dict[str, Any]) -> dict[str, Any]:
    rows = _plain_rows(entry)
    out: dict[str, Any] = {}
    plural = _first(rows, {"plural"})
    if plural:
        out["plural"] = plural
    dim = _first(rows, {"diminutive"})
    if dim:
        out["diminutive"] = dim
    return out


def _adj_forms(entry: dict[str, Any]) -> dict[str, Any]:
    rows = _plain_rows(entry)
    out: dict[str, Any] = {}
    # Top-level comparative/superlative rows come first in Kaikki ("mooier", "mooist").
    comp = _first(rows, {"comparative"}, {"predicative", "indefinite", "definite", "partitive"})
    sup = _first(rows, {"superlative"}, {"predicative", "indefinite", "definite", "partitive"})
    comp = comp or _first(rows, {"comparative", "predicative"})
    sup = sup or _first(rows, {"superlative", "predicative"})
    if comp:
        out["comparative"] = comp
    if sup:
        out["superlative"] = sup
    # Declension table: the attributive form before a noun ("de mooie"): "definite positive".
    inflected = _first(rows, {"definite", "positive"}) or _first(
        rows, {"indefinite", "positive", "plural"}
    )
    if inflected:
        out["inflected"] = inflected
    return out


def extract_word_forms(entry: dict[str, Any]) -> dict[str, Any]:
    """The ``WordForms`` dict (camelCase keys of the TS type; possibly empty) of a Kaikki entry."""
    pos = entry.get("pos")
    if not entry.get("word"):
        return {}
    if pos == "verb":
        return _verb_forms(entry)
    if pos == "noun":
        return _noun_forms(entry)
    if pos == "adj":
        return _adj_forms(entry)
    return {}


def _listed(base: str) -> str | None:
    """``both`` / ``zijn`` when ``base`` itself is in the curated lists, else None."""
    if base in BOTH_VERBS or base in BOTH_LEXICAL:
        return "both"
    if base in ZIJN_VERBS:
        return "zijn"
    return None


def curated_aux(lemma: str, particle: str | None = None) -> str | None:
    """Auxiliary from the curated lists; separable verbs inherit from their stem.

    ``opstaan`` is listed itself; ``terugkomen`` inherits ``komen`` through the particle.
    ``particle`` must be a CONFIRMED separable particle (Wiktionary data); without it only
    unambiguous particles are tried. Inseparable prefixes (over-, onder-, door-, om-, achter-,
    voor-) never inherit by guesswork: ``overvallen`` is not ``over`` + ``vallen``.
    """
    low = lemma.lower()
    if low in HEBBEN_VERBS:
        return "hebben"
    direct = _listed(low)
    if direct:
        return direct
    if particle and low.startswith(particle):
        return _listed(low[len(particle) :])
    if particle is None:
        for p in SEPARABLE_PARTICLES:
            if p in AMBIGUOUS_PARTICLES or not low.startswith(p) or len(low) <= len(p) + 2:
                continue
            inherited = _listed(low[len(p) :])
            if inherited:
                return inherited
    return None


def resolve_aux(
    template_aux: str | None,
    evidence: tuple[int, int] | None,
    lemma: str,
    particle: str | None,
    nl_aux: str | None = None,
) -> str:
    """Final auxiliary: template > curated hebben/both > the Dutch Wiktionary (``nl_aux``) >
    evidence ``(hebben, zijn)`` > curated.

    Corpus ``zijn`` counts include perfect passives ("is aangevallen"), so for a verb not
    curated as zijn/both a hebben-majority of at least 2:1 means "hebben", not "both". A curated
    "both" that was merely INHERITED never overrides hebben-only evidence.
    """
    if template_aux:
        return template_aux
    low = lemma.lower()
    curated = curated_aux(low, particle)
    if curated == "hebben" or (curated == "both" and _listed(low) == "both"):
        return curated
    if nl_aux:
        return nl_aux
    if evidence and sum(evidence) >= 2:
        heb, zij = evidence
        total = heb + zij
        if min(heb, zij) >= 2 and min(heb, zij) / total >= 0.25:
            if curated is None and heb >= 2 * zij:
                return "hebben"  # zijn count is mostly passives
            return "both"
        if curated == "both" and zij >= 1 and heb >= 1:
            return "both"
        return "zijn" if zij > heb else "hebben"
    return curated or "hebben"


def _merge_homograph_aux(best: dict[str, Any], datas: list[dict[str, Any]]) -> dict[str, Any]:
    """``both`` when homograph verb entries (different participles) disagree on the auxiliary.

    ``voorkomen`` has a separable entry (``voorgekomen``, zijn: "to occur") and an inseparable
    one (``voorkomen``, no template aux: "to prevent", hebben).
    """
    entries = [d for d in datas if d.get("participle")]
    if len({d["participle"] for d in entries}) < 2:
        return best
    auxes = {d.get("aux") for d in entries}
    if len(auxes) > 1 and auxes - {None}:
        return {**best, "aux": "both"}
    return best


class WordFormsMissingError(RuntimeError):
    """The dictionary DB is missing, or was built before the ``wordforms`` table existed."""


class WordFormsStore:
    """Read-only ``/forms`` lookup over the dictionary DB (+ optional sentence-DB evidence)."""

    def __init__(self, dict_path: Path, sentences_path: Path | None = None) -> None:
        if not dict_path.is_file():
            raise WordFormsMissingError(
                f"Dictionary database not found at {dict_path}. "
                "Build it once with: uv run python scripts/build_dictionary.py"
            )
        self.dict_path = dict_path
        self.sentences_path = (
            sentences_path if sentences_path and sentences_path.is_file() else None
        )
        con = self._dict()
        try:
            has = con.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='wordforms'"
            ).fetchone()
        finally:
            con.close()
        if not has:
            raise WordFormsMissingError(
                f"{dict_path} has no morphology table (built by an older version). "
                "Rebuild it with: uv run python scripts/build_dictionary.py"
            )

    def _dict(self) -> sqlite3.Connection:
        return sqlite3.connect(f"file:{self.dict_path}?mode=ro", uri=True)

    def _evidence(self, lemmas: list[str]) -> dict[str, tuple[int, int]]:
        """``{lemma: (hebben, zijn)}`` perfect-tense counts from the sentence DB (if present)."""
        if not self.sentences_path or not lemmas:
            return {}
        con = sqlite3.connect(f"file:{self.sentences_path}?mode=ro", uri=True)
        try:
            if not con.execute("SELECT 1 FROM sqlite_master WHERE name='aux_evidence'").fetchone():
                return {}
            marks = ",".join("?" * len(lemmas))
            return {
                r[0]: (r[1], r[2])
                for r in con.execute(
                    f"SELECT lemma, hebben, zijn FROM aux_evidence WHERE lemma IN ({marks})",
                    lemmas,
                )
            }
        finally:
            con.close()

    def _stem_known(self, con: sqlite3.Connection, stem: str) -> bool:
        return bool(
            con.execute(
                "SELECT 1 FROM entries WHERE lower(word)=? AND pos='verb' LIMIT 1", (stem,)
            ).fetchone()
        )

    def lookup(self, items: Iterable[tuple[str, str]]) -> dict[str, dict[str, Any]]:
        """``WordForms`` per lemma for ``(lemma, UPOS)`` pairs. Unknown lemmas map to ``{}``.

        With several pairs for one lemma (verb + noun) the first with data wins.
        """
        pairs = list(dict.fromkeys(items))
        verbs = [lemma.lower() for lemma, pos in pairs if POS_MAP.get(pos) == "verb"]
        evidence = self._evidence(verbs)
        result: dict[str, dict[str, Any]] = {}
        con = self._dict()
        try:
            for lemma, pos in pairs:
                kind = POS_MAP.get(pos)
                if kind is None or result.get(lemma):
                    result.setdefault(lemma, {})
                    continue
                row = con.execute(
                    "SELECT data FROM wordforms WHERE lower(lemma)=? AND pos=? ORDER BY rowid",
                    (lemma.lower(), kind),
                ).fetchall()
                datas = [json.loads(r[0]) for r in row]
                data = max(datas, key=len, default={})
                if kind == "verb":
                    data = _merge_homograph_aux(data, datas)
                    data = self._finish_verb(con, lemma, data, evidence)
                result[lemma] = data
        finally:
            con.close()
        return result

    def _finish_verb(
        self,
        con: sqlite3.Connection,
        lemma: str,
        data: dict[str, Any],
        evidence: dict[str, tuple[int, int]],
    ) -> dict[str, Any]:
        """Add the separable fallback (particle list) and the resolved auxiliary."""
        low = lemma.lower()
        if "separable" not in data and not data.get("participle"):
            # No conjugation data: guess "particle + known verb stem" ("terugbellen").
            for p in SEPARABLE_PARTICLES:
                stem = low[len(p) :]
                if p in AMBIGUOUS_PARTICLES:
                    continue  # over-/onder-/... may be inseparable: needs Wiktionary evidence
                if low.startswith(p) and len(stem) > 2 and self._stem_known(con, stem):
                    data = {**data, "separable": {"particle": p, "stem": stem}}
                    break
        if not data:
            return data
        particle = (data.get("separable") or {}).get("particle")
        out = dict(data)
        out["aux"] = resolve_aux(
            data.get("aux"), evidence.get(low), low, particle, out.pop("aux_nl", None)
        )
        return out
