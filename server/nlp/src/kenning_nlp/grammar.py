"""Rule-based grammar detectors for Dutch on top of the spaCy analysis (``POST /grammar``).

Each detector looks at one sentence of a :class:`~kenning_nlp.models.TextAnalysis` (POS, morphology,
dependencies, ``particle_of``) and yields :class:`Hit` objects: a topic id (the id of the grammar
topic page in ``packages/content/grammar/nl``), the indices of the tokens that make up the
construction and a short note in plain English.

Design rules:

* **Precision over recall.** A detector fires only when the parse and the word forms agree; a
  missed example costs nothing, a wrong underline teaches the wrong thing.
* Detectors never look at raw text, only at tokens, so they work on any analysis, including the
  ones the app already stored.
* One construction produces one hit; the same token may belong to hits of several topics
  (``zijn`` in a perfect tense and in a subordinate clause, say).

Usage::

    analysis = analyze_texts("nl", [text])[0]
    for hit in detect_grammar(text, analysis):
        print(hit.topic, hit.tokens, hit.note)
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from kenning_nlp.models import GrammarHit, TextAnalysis, Token

# --------------------------------------------------------------------------------- vocabulary

WH_WORDS = frozenset(
    [
        "wie",
        "wat",
        "waar",
        "waarom",
        "wanneer",
        "hoe",
        "welk",
        "welke",
        "welks",
        "hoeveel",
        "hoelang",
        "hoeveel",
        "waarheen",
        "waarvoor",
        "waarmee",
        "waarover",
        "waaraan",
        "waarvan",
        "waardoor",
        "wiens",
    ]
)
SUBORDINATORS = frozenset(
    [
        "omdat",
        "dat",
        "als",
        "wanneer",
        "toen",
        "terwijl",
        "hoewel",
        "zodat",
        "voordat",
        "nadat",
        "totdat",
        "zodra",
        "sinds",
        "aangezien",
        "indien",
        "doordat",
        "ofschoon",
        "tenzij",
        "naarmate",
        "nu",
        "of",
        "mits",
        "alsof",
        "zolang",
    ]
)
MODALS = frozenset({"kunnen", "mogen", "moeten", "willen"})
# Verbs that form the perfect with zijn (motion towards a goal, change of state).
ZIJN_VERBS = frozenset(
    [
        "gaan",
        "komen",
        "worden",
        "blijven",
        "vallen",
        "lopen",
        "rijden",
        "vliegen",
        "fietsen",
        "zwemmen",
        "reizen",
        "vertrekken",
        "sterven",
        "groeien",
        "verdwijnen",
        "gebeuren",
        "beginnen",
        "stijgen",
        "dalen",
        "slagen",
        "mislukken",
        "verschijnen",
        "ontstaan",
        "springen",
        "rennen",
        "kruipen",
        "zinken",
        "verhuizen",
        "opstaan",
        "wakker\xadworden",
        "vergaan",
        "verdrinken",
        "stoppen",
        "aankomen",
        "thuiskomen",
        "terugkomen",
        "bevriezen",
        "smelten",
    ]
)
SPEECH_VERBS = frozenset(
    [
        "zeggen",
        "vertellen",
        "denken",
        "geloven",
        "vinden",
        "hopen",
        "beweren",
        "antwoorden",
        "schrijven",
        "melden",
        "vragen",
        "roepen",
        "fluisteren",
        "beloven",
        "vermoeden",
    ]
)
CONJUNCTIONS = frozenset({"en", "maar", "want", "of"})
# Words that look like quantities, not adjectives to inflect.
NOT_ADJECTIVES = frozenset({"veel", "weinig", "genoeg", "meer", "minder", "enkel", "elk", "ieder"})
# Degree words that are not instructive comparatives / superlatives.
NOT_COMPARISON = frozenset(
    [
        "meer",
        "meest",
        "minder",
        "minst",
        "laatste",
        "eerste",
        "volgende",
        "meeste",
        "minste",
        "laat",
        "later",
        "latere",
        "vroeger",
        "vroegere",
    ]
)
IRREGULAR_PLURALS = frozenset(
    [
        "stad",
        "schip",
        "blad",
        "ei",
        "lid",
        "glas",
        "god",
        "gat",
        "dag",
        "weg",
        "kind",
        "rad",
        "lied",
        "hoofd",
        "schaap",
    ]
)
IRREGULAR_DEGREE = frozenset({"beter", "beste", "best", "liever", "liefst", "liefste"})
NOT_DIMINUTIVES = frozenset({"oranje", "kastanje", "pyjama", "mevrouwtje", "wijze", "bonje"})
DIMINUTIVE_ENDINGS = ("je", "tje", "pje", "kje", "etje", "jes", "tjes", "pjes", "kjes", "etjes")
DEMONSTRATIVES = frozenset({"deze", "dit", "die", "dat"})
QUOTES = frozenset("\"'“”„‘’«»")
# Subject pronoun lemma -> reflexive pronoun forms it takes (zich for every third person).
REFLEXIVE_FOR = {
    "ik": {"me"},
    "wij": {"ons"},
    "we": {"ons"},
    "jij": {"je"},
    "je": {"je"},
    "jullie": {"je"},
    "u": {"zich"},
}


def _morph(t: Token) -> set[str]:
    return set(t.morph.split("|")) if t.morph else set()


def _is_fin(t: Token) -> bool:
    return t.pos in {"VERB", "AUX"} and "VerbForm=Fin" in _morph(t)


@dataclass(frozen=True)
class Hit:
    """One detected construction: topic id, token indices (document-wide) and a note."""

    topic: str
    tokens: tuple[int, ...]
    note: str


class Sentence:
    """One sentence with the lookups the detectors share."""

    def __init__(self, toks: list[Token], by_index: dict[int, Token]) -> None:
        self.toks = toks
        self.by_index = by_index
        self.kids: dict[int, list[Token]] = defaultdict(list)
        for t in toks:
            if t.head != t.i and t.head in by_index:
                self.kids[t.head].append(t)

    @property
    def words(self) -> list[Token]:
        return [t for t in self.toks if t.pos != "PUNCT"]

    def head_of(self, t: Token) -> Token | None:
        return self.by_index.get(t.head) if t.head != t.i else None

    def children(self, t: Token, *deps: str) -> list[Token]:
        return [c for c in self.kids[t.i] if not deps or c.dep in deps]

    def clause_head(self, fin: Token) -> Token:
        """The head of the clause of a finite verb: the verb itself, or the participle /
        infinitive / predicate it is the auxiliary or copula of."""
        if fin.dep in {"aux", "aux:pass", "cop"}:
            head = self.head_of(fin)
            if head is not None:
                return head
        return fin

    def finite_of(self, head: Token) -> Token | None:
        """The finite verb of the clause headed by ``head`` (itself, or an aux / cop child)."""
        if _is_fin(head):
            return head
        for c in self.children(head, "aux", "aux:pass", "cop"):
            if _is_fin(c):
                return c
        return None

    def subjects(self, head: Token) -> list[Token]:
        return self.children(head, "nsubj", "nsubj:pass", "csubj")

    def subtree(self, t: Token, skip: frozenset[str] = frozenset()) -> list[Token]:
        out, stack = [], [t]
        while stack:
            cur = stack.pop()
            out.append(cur)
            stack.extend(c for c in self.kids[cur.i] if c.dep not in skip)
        return sorted(out, key=lambda x: x.i)

    @property
    def is_question(self) -> bool:
        return bool(self.toks) and self.toks[-1].text == "?"


Detector = Callable[[Sentence], Iterable[Hit]]

# ---------------------------------------------------------------------------------- detectors


def detect_inversion(s: Sentence) -> Iterable[Hit]:
    """Main clause whose finite verb comes before the subject because something else is first."""
    if s.is_question:
        return
    for f in s.toks:
        if not _is_fin(f):
            continue
        head = s.clause_head(f)
        if head.dep != "ROOT":
            continue
        subs = [x for x in s.children(head, "nsubj", "nsubj:pass") if x.i > f.i]
        if not subs:
            continue
        before = [t for t in s.toks if t.i < f.i]
        content = [t for t in before if t.pos not in {"PUNCT", "CCONJ", "INTJ"} and t.lemma != "er"]
        if not content or any(t.text in QUOTES for t in before):
            continue
        if before[0].text.lower() in WH_WORDS or before[0].pos == "INTJ":
            continue  # questions and exclamations ("Wat is de wereld toch klein!")
        if any(t.dep in {"nsubj", "nsubj:pass", "csubj"} for t in content):
            continue  # a subject already stands in front: parse noise, not an inversion
        first = next(t for t in before if t.pos != "PUNCT")
        yield Hit(
            "inversion",
            (f.i, subs[0].i),
            f"«{first.text}» comes first, so the verb «{f.text}» goes "
            f"before the subject «{subs[0].text}».",
        )


def detect_question(s: Sentence) -> Iterable[Hit]:
    """A question with a question word, or a yes/no question starting with the verb."""
    words = s.words
    if not s.is_question or not words:
        return
    first = words[0]
    fin = next((t for t in words if _is_fin(t)), None)
    if fin is None:
        return
    if first.text.lower() in WH_WORDS:
        yield Hit(
            "questions",
            (first.i, fin.i),
            f"Question word «{first.text}», then the verb «{fin.text}».",
        )
    elif first.i == fin.i:
        yield Hit(
            "questions",
            (fin.i,),
            f"A yes/no question: the verb «{fin.text}» comes first.",
        )


def detect_subordinate(s: Sentence) -> Iterable[Hit]:
    """Clause opened by a subordinating conjunction with the finite verb at its end."""
    skip = frozenset({"conj", "cc", "parataxis", "punct"})
    for m in s.toks:
        if m.dep != "mark" or m.pos != "SCONJ" or m.lemma.lower() not in SUBORDINATORS:
            continue
        head = s.head_of(m)
        fin = s.finite_of(head) if head else None
        if head is None or fin is None or fin.i < m.i:
            continue
        clause = [t for t in s.subtree(head, skip) if t.i > fin.i and t.pos != "PUNCT"]
        # After the finite verb only the rest of the verb cluster may follow.
        if any(
            not (
                (t.pos in {"VERB", "AUX"} and not _is_fin(t))
                or t.particle_of is not None
                or t.dep == "compound:prt"
            )
            for t in clause
        ):
            continue
        # A subject must stand between the conjunction and the verb.
        if not any(m.i < x.i < fin.i for x in s.subjects(head)):
            continue
        yield Hit(
            "subordinate-clauses",
            (m.i, fin.i),
            f"After «{m.text}» the finite verb «{fin.text}» moves to the end of the clause.",
        )


def detect_separable(s: Sentence) -> Iterable[Hit]:
    """A separable verb whose particle stands apart from the verb."""
    for t in s.toks:
        if t.particle_of is None or t.particle_of not in s.by_index:
            continue
        verb = s.by_index[t.particle_of]
        if verb.lemma.lower() in {"zijn", "hebben"}:
            continue  # "thuis zijn" is not a separable verb
        yield Hit(
            "separable-verbs",
            (verb.i, t.i),
            f"«{verb.text}»…«{t.text}» is one verb: «{verb.lemma}», with the particle split off.",
        )


def _is_zijn_verb(lemma: str) -> bool:
    low = lemma.lower()
    return any(low.endswith(v) for v in ZIJN_VERBS)


def detect_perfect(s: Sentence) -> Iterable[Hit]:
    """hebben/zijn (finite) with a past participle: ``heeft gelezen``, ``is gegaan``."""
    for aux in s.toks:
        if not _is_fin(aux) or aux.lemma.lower() not in {"hebben", "zijn"}:
            continue
        if aux.dep == "aux:pass" or "Tense=Past" in _morph(aux):
            continue  # passives; "had/was + participle" is the past perfect
        head = s.head_of(aux)
        parts = [head] if head is not None and aux.dep == "aux" else []
        parts += [c for c in s.children(aux) if c.dep in {"xcomp", "ccomp"}]
        for p in parts:
            if p.pos != "VERB" or "VerbForm=Part" not in _morph(p):
                continue
            if any(c.lemma.lower() == "zullen" for c in s.children(p, "aux")):
                continue  # "zou gekomen zijn" (the tagger may call zijn finite)
            if aux.lemma.lower() == "zijn" and not _is_zijn_verb(p.lemma):
                continue  # most "zijn + participle" is a passive or a state ("is gesloten")
            yield Hit(
                "perfect-tense",
                tuple(sorted((aux.i, p.i))),
                f"Perfect tense: «{aux.text}» + participle «{p.text}» ({p.lemma}).",
            )
            break


def _past_perfect_participle(s: Sentence, aux: Token) -> Token | None:
    """The participle of ``had/was + participle`` (past perfect), or None."""
    if not _is_fin(aux) or aux.dep != "aux" or "Tense=Past" not in _morph(aux):
        return None
    lemma = aux.lemma.lower()
    if lemma not in {"hebben", "zijn"}:
        return None
    head = s.head_of(aux)
    if head is None or head.pos != "VERB" or "VerbForm=Part" not in _morph(head):
        return None
    if lemma == "zijn" and not _is_zijn_verb(head.lemma):
        return None  # "was gesloten" is a state or a passive
    return head


def detect_past_perfect(s: Sentence) -> Iterable[Hit]:
    """had / was + past participle: ``had gelezen``, ``was vertrokken``."""
    for aux in s.toks:
        p = _past_perfect_participle(s, aux)
        if p is not None:
            yield Hit(
                "past-perfect",
                tuple(sorted((aux.i, p.i))),
                f"Past perfect: «{aux.text}» + participle «{p.text}», "
                "one step further back in the past.",
            )


def _complement_infinitives(s: Sentence, fin: Token) -> list[Token]:
    """Infinitives governed by (or governing, for auxiliaries) a finite verb."""
    out = []
    head = s.head_of(fin)
    if head is not None and fin.dep in {"aux", "aux:pass"} and "VerbForm=Inf" in _morph(head):
        out.append(head)
    out += [c for c in s.children(fin) if c.pos in {"VERB", "AUX"} and "VerbForm=Inf" in _morph(c)]
    return out


def detect_modal(s: Sentence) -> Iterable[Hit]:
    """kunnen / mogen / moeten / willen with an infinitive."""
    for f in s.toks:
        if _is_fin(f) and f.lemma.lower() in MODALS:
            infs = _complement_infinitives(s, f)
            if infs:
                yield Hit(
                    "modal-verbs",
                    tuple(sorted((f.i, infs[0].i))),
                    f"Modal «{f.text}» with the infinitive «{infs[0].text}» (no «te»).",
                )


def detect_imperfect(s: Sentence) -> Iterable[Hit]:
    """A finite verb in the simple past."""
    for t in s.toks:
        if _is_fin(t) and "Tense=Past" in _morph(t):
            if t.lemma.lower() == "zullen" or (
                t.dep == "aux" and t.lemma.lower() in {"hebben", "zijn"}
            ):
                continue  # "zou" is the conditional, "had gelezen" the past perfect
            weak = t.text.lower().endswith(("te", "de", "ten", "den"))
            kind = "weak (-te/-de)" if weak else "strong (stem change)"
            yield Hit(
                "imperfect-tense",
                (t.i,),
                f"«{t.text}» is the simple past of «{t.lemma}», {kind}.",
            )


def detect_future(s: Sentence) -> Iterable[Hit]:
    """zullen or gaan + infinitive."""
    for f in s.toks:
        if not _is_fin(f) or f.lemma.lower() not in {"zullen", "gaan"}:
            continue
        if "Tense=Pres" not in _morph(f):
            continue  # "zou" (conditional) and "ging" are not the future
        infs = _complement_infinitives(s, f)
        if infs:
            yield Hit(
                "future",
                tuple(sorted((f.i, infs[0].i))),
                f"Future: «{f.text}» + infinitive «{infs[0].text}».",
            )


def _subject_lemma(s: Sentence, verb: Token) -> str | None:
    for v in (verb, s.head_of(verb)):
        if v is None:
            continue
        subs = s.subjects(v)
        if subs:
            return subs[0].lemma.lower()
    return None


def detect_reflexive(s: Sentence) -> Iterable[Hit]:
    """zich, or me / je / ons that refers back to the subject."""
    for t in s.toks:
        if t.pos != "PRON" or "Poss=Yes" in _morph(t):
            continue
        verb = s.head_of(t)
        if verb is None or verb.pos not in {"VERB", "AUX"}:
            continue
        low = t.text.lower()
        if low == "zich":
            ok = True
        elif low in {"me", "ons", "je"} and t.dep in {"expl:pv", "obj", "iobj"}:
            subject = _subject_lemma(s, verb)
            other_objects = [c for c in s.children(verb, "obj", "iobj") if c.i != t.i]
            ok = (
                subject is not None
                and low in REFLEXIVE_FOR.get(subject, set())
                and not other_objects
            )
        else:
            ok = False
        if ok:
            yield Hit(
                "reflexive-verbs",
                tuple(sorted((t.i, verb.i))),
                f"«{verb.text}» is used reflexively with «{t.text}».",
            )


def detect_om_te(s: Sentence) -> Iterable[Hit]:
    """``om ... te`` + infinitive."""
    for om in s.toks:
        if om.dep != "mark" or om.text.lower() != "om":
            continue
        verb = s.head_of(om)
        if verb is None:
            continue
        te = next((c for c in s.children(verb, "mark") if c.text.lower() == "te"), None)
        if te is not None and te.i > om.i:
            yield Hit(
                "om-te-infinitive",
                (om.i, te.i, verb.i),
                f"«om … te» + infinitive «{verb.text}» expresses a purpose or a reason.",
            )


def detect_te_infinitive(s: Sentence) -> Iterable[Hit]:
    """``te`` + infinitive without ``om``."""
    for te in s.toks:
        if te.dep != "mark" or te.text.lower() != "te":
            continue
        verb = s.head_of(te)
        if verb is None or verb.pos not in {"VERB", "AUX"} or "VerbForm=Inf" not in _morph(verb):
            continue
        if any(c.text.lower() == "om" for c in s.children(verb, "mark")):
            continue
        yield Hit(
            "te-infinitive",
            (te.i, verb.i),
            f"«te» + infinitive: «{te.text} {verb.text}».",
        )


def detect_adjective(s: Sentence) -> Iterable[Hit]:
    """An adjective directly before its noun: with or without the -e ending."""
    for adj in s.toks:
        if adj.pos != "ADJ" or adj.dep != "amod" or "Degree=Pos" not in _morph(adj):
            continue
        noun = s.head_of(adj)
        if noun is None or noun.pos != "NOUN" or noun.i < adj.i:
            continue
        if adj.lemma.lower() in NOT_ADJECTIVES or noun.i - adj.i > 3:
            continue
        dets = [d for d in s.children(noun, "det") if d.i < adj.i]
        det = dets[0].text.lower() if dets else ""
        plural = "Number=Plur" in _morph(noun)
        neuter = "Gender=Neut" in _morph(noun)
        low = adj.text.lower()
        if low.endswith("e") and low != adj.lemma.lower():
            why = (
                "the noun is plural"
                if plural
                else f"«{det}» is definite"
                if det in {"de", "het", "deze", "dit", "die", "dat"}
                else "the noun is a de-word"
            )
            note = f"«{adj.text}» takes -e because {why}."
        elif det == "een" and neuter and not plural:
            note = f"No -e: «een» + a het-word in the singular («{adj.text}»)."
        else:
            note = f"«{adj.text}» before «{noun.text}», without -e."
        yield Hit("adjective-inflection", (adj.i, noun.i), note)


def detect_comparison(s: Sentence) -> Iterable[Hit]:
    """Comparative and superlative adjectives and adverbs."""
    for t in s.toks:
        if t.pos not in {"ADJ", "ADV"}:
            continue
        degree = next((m for m in _morph(t) if m.startswith("Degree=")), "")
        if degree not in {"Degree=Cmp", "Degree=Sup"}:
            continue
        low = t.text.lower()
        if low in NOT_COMPARISON or t.lemma.lower() in NOT_COMPARISON:
            continue
        suffixes = ("er", "ere") if degree == "Degree=Cmp" else ("st", "ste")
        if not low.endswith(suffixes) and low not in IRREGULAR_DEGREE:
            continue  # tagger noise ("waste", "jaloers")
        what = "comparative" if degree == "Degree=Cmp" else "superlative"
        yield Hit(
            "comparison",
            (t.i,),
            f"«{t.text}» is the {what} of «{t.lemma}».",
        )


def detect_negation(s: Sentence) -> Iterable[Hit]:
    """``niet`` and ``geen``."""
    for t in s.toks:
        low = t.text.lower()
        if low == "niet" and t.pos in {"ADV", "PART"}:
            yield Hit("negation", (t.i,), "«niet» negates the verb or the word after it.")
        elif low == "geen" and t.pos in {"DET", "PRON", "ADJ"}:
            yield Hit(
                "negation",
                (t.i,),
                "«geen» negates a noun without an article or with «een».",
            )


def detect_demonstrative(s: Sentence) -> Iterable[Hit]:
    """deze / dit / die / dat used as demonstratives (not relative pronouns or conjunctions)."""
    for t in s.toks:
        is_dem = t.text.lower() in DEMONSTRATIVES and t.pos in {"DET", "PRON"}
        if is_dem and ("PronType=Dem" in _morph(t) or t.pos == "DET"):
            yield Hit(
                "demonstratives",
                (t.i,),
                f"«{t.text}» points at something: de-word and plural "
                "«deze/die», het-word «dit/dat».",
            )


def detect_er(s: Sentence) -> Iterable[Hit]:
    """The word ``er``, labelled by use: existential, quantitative, prepositional or place."""
    for t in s.toks:
        if t.text.lower() != "er" or t.pos not in {"ADV", "PRON"}:
            continue
        verb = s.head_of(t)
        if verb is None:
            continue
        after = [x for x in s.toks if x.i > t.i and x.pos != "PUNCT"]
        stranded = [x for x in after if x.pos == "ADP" and not s.children(x)]
        passive = [c for c in s.children(verb, "aux:pass") if c.lemma.lower() == "worden"]
        if passive and not s.subjects(verb):
            note = "«Er» fills the empty subject place: «er wordt…» (impersonal passive)."
        elif t.dep == "expl" or any(x.dep == "nsubj" and x.i > t.i for x in s.kids[verb.i]):
            note = "«Er» introduces something new: «er is… / er staat…»."
        elif any(x.pos == "NUM" or x.lemma in {"veel", "weinig", "genoeg"} for x in after):
            note = "«Er» stands for the thing being counted: «Ik heb er twee»."
        elif stranded:
            note = (
                f"«Er» replaces a thing after «{stranded[-1].text}»: "
                "the preposition goes to the end."
            )
        else:
            note = "«Er» refers to a place that was mentioned before."
        yield Hit("er", (t.i,), note)


def detect_relative(s: Sentence) -> Iterable[Hit]:
    """A relative clause opened by die / dat / wat / waar + preposition."""
    for t in s.toks:
        verb = s.head_of(t)
        if verb is None or verb.dep != "acl:relcl" or t.i > verb.i:
            continue
        low = t.text.lower()
        antecedent = s.head_of(verb)
        if antecedent is None or antecedent.pos not in {"NOUN", "PRON", "PROPN"}:
            continue  # "dat" opening a complement clause is not a relative pronoun
        pron_type = _morph(t) & {"PronType=Rel", "PronType=Int"}
        simple = t.pos == "PRON" and t.dep != "mark" and low in {"die", "dat", "wat"} and pron_type
        r_pronoun = low.startswith("waar") and len(low) > 4 and t.pos in {"ADV", "PRON"}
        if not (simple or r_pronoun):
            continue
        yield Hit(
            "relative-pronouns",
            tuple(sorted((t.i, verb.i))),
            f"«{t.text}» introduces a relative clause; the verb «{verb.text}» stands at its end.",
        )


def detect_diminutive(s: Sentence) -> Iterable[Hit]:
    """Diminutives (-je, -tje, -pje, -etje): always het."""
    for t in s.toks:
        low = t.text.lower()
        if t.pos != "NOUN" or len(low) < 5 or low in NOT_DIMINUTIVES:
            continue
        if low.endswith(DIMINUTIVE_ENDINGS) and ("Gender=Neut" in _morph(t) or low != t.lemma):
            yield Hit(
                "diminutives",
                (t.i,),
                f"«{t.text}» is a diminutive (-je), so it is a het-word.",
            )


def detect_plural(s: Sentence) -> Iterable[Hit]:
    """Plural nouns with their lemma."""
    for t in s.toks:
        low = t.text.lower()
        if t.pos != "NOUN" or "Number=Plur" not in _morph(t) or low == t.lemma.lower():
            continue
        if low.endswith(DIMINUTIVE_ENDINGS):
            continue
        stem = t.lemma.lower()[: max(3, len(t.lemma) - 2)]
        if not low.startswith(stem) and t.lemma.lower() not in IRREGULAR_PLURALS:
            continue  # the lemmatiser guessed wrong
        if low.endswith(("'s", "’s")):
            kind = "-'s"
        elif low.endswith("s") and not low.endswith("ss"):
            kind = "-s"
        elif low.endswith("en"):
            kind = "-en"
        else:
            kind = "irregular"
        yield Hit(
            "plural-nouns",
            (t.i,),
            f"«{t.text}» is the plural of «{t.lemma}» ({kind}).",
        )


def detect_imperative(s: Sentence) -> Iterable[Hit]:
    """A command: the verb stands first and has no subject."""
    words = s.words
    if not words or s.is_question:
        return
    # Skip a leading "alsjeblieft" or a vocative-free politeness word.
    first = words[0]
    if first.lemma.lower() in {"alsjeblieft", "alstublieft", "even", "maar"} and len(words) > 1:
        first = words[1]
    if not _is_fin(first) or s.subjects(s.clause_head(first)):
        return
    if first.pos == "AUX" and first.lemma.lower() in {"hebben"} and first.dep == "aux":
        return
    if "Tense=Past" in _morph(first):
        return
    yield Hit(
        "imperative",
        (first.i,),
        f"«{first.text}» stands first without a subject: a command.",
    )


def detect_indirect_speech(s: Sentence) -> Iterable[Hit]:
    """``dat`` / ``of`` clause after a verb of saying or thinking."""
    for m in s.toks:
        if m.dep != "mark" or m.pos != "SCONJ" or m.text.lower() not in {"dat", "of"}:
            continue
        clause = s.head_of(m)
        main = s.head_of(clause) if clause is not None else None
        if clause is None or main is None or clause.dep not in {"ccomp", "xcomp"}:
            continue
        if main.lemma.lower() in SPEECH_VERBS and s.finite_of(clause) is not None:
            yield Hit(
                "indirect-speech",
                (main.i, m.i),
                f"Reported speech: «{main.text}» + «{m.text}»-clause, with the verb at the end.",
            )


def detect_conjunction(s: Sentence) -> Iterable[Hit]:
    """en / maar / want / of joining two main clauses (word order stays normal)."""
    for cc in s.toks:
        if cc.dep != "cc" or cc.text.lower() not in CONJUNCTIONS or cc.pos != "CCONJ":
            continue
        second = s.head_of(cc)
        if second is None or second.dep != "conj" or not s.subjects(second):
            continue
        first = s.head_of(second)
        if first is None or s.finite_of(second) is None:
            continue
        yield Hit(
            "conjunctions",
            (cc.i,),
            f"«{cc.text}» joins two main clauses; the word order stays the same.",
        )


# Verbs that take a bare infinitive and then use the infinitive instead of a participle in the
# perfect ("heeft moeten werken", "heb hem zien vallen").
IPP_VERBS = frozenset(
    {
        "kunnen",
        "mogen",
        "moeten",
        "willen",
        "laten",
        "zien",
        "horen",
        "helpen",
        "leren",
        "blijven",
        "gaan",
        "komen",
        "zitten",
        "staan",
        "liggen",
        "lopen",
        "durven",
        "hoeven",
    }
)


def detect_conditional(s: Sentence) -> Iterable[Hit]:
    """zou / zouden + infinitive (conditional), or + participle + hebben/zijn (conditional
    perfect)."""
    for f in s.toks:
        if not _is_fin(f) or f.lemma.lower() != "zullen" or "Tense=Past" not in _morph(f):
            continue
        head = s.head_of(f)
        if f.dep == "aux" and head is not None and "VerbForm=Part" in _morph(head):
            haux = [
                c
                for c in s.children(head, "aux")
                if c.lemma.lower() in {"hebben", "zijn"} and c.i != f.i
            ]
            if haux:
                yield Hit(
                    "conditional-perfect",
                    tuple(sorted((f.i, haux[0].i, head.i))),
                    f"«{f.text}» + «{haux[0].text}» + participle «{head.text}»: what would have "
                    "happened (but did not).",
                )
            continue
        infs = _complement_infinitives(s, f)
        if infs:
            yield Hit(
                "conditional",
                tuple(sorted((f.i, infs[0].i))),
                f"«{f.text}» + infinitive «{infs[0].text}»: would / should.",
            )


def _has_agent(s: Sentence, p: Token) -> bool:
    """A ``door`` phrase on the participle (the parser labels it obl:agent or obl)."""
    for c in s.children(p, "obl:agent", "obl"):
        if c.dep == "obl:agent" or any(x.lemma.lower() == "door" for x in s.children(c, "case")):
            return True
    return False


def detect_passive(s: Sentence) -> Iterable[Hit]:
    """worden + participle, or zijn + participle with a door-agent. Without any subject it is an
    impersonal passive (``Er wordt gedanst``)."""
    for p in s.toks:
        if p.pos != "VERB" or "VerbForm=Part" not in _morph(p):
            continue
        auxes = s.children(p, "aux:pass")
        worden = next((a for a in auxes if a.lemma.lower() == "worden"), None)
        zijn = next((a for a in auxes if a.lemma.lower() == "zijn"), None)
        if worden is not None:
            first = s.words[0] if s.words else None
            fronted_pp = (
                first is not None
                and first.pos == "ADP"
                and s.head_of(first) is not None
                and s.head_of(first).head == p.i  # type: ignore[union-attr]
            )
            has_er = any(c.lemma.lower() == "er" for c in s.children(p, "expl", "advmod"))
            # "Er moet nog meer gedaan worden": a quantity word is the hidden subject.
            hidden = any(
                c.dep == "obj" or c.lemma.lower() in QUANTITY_SUBJECTS for c in s.children(p)
            )
            has_er = has_er and not hidden
            fronted_pp = fronted_pp and not hidden
            if not s.subjects(p) and s.finite_of(p) is not None and (has_er or fronted_pp):
                yield Hit(
                    "impersonal-passive",
                    tuple(sorted((worden.i, p.i))),
                    f"«{worden.text}» + «{p.text}» without a subject: an activity, "
                    "nobody in particular does it.",
                )
            elif s.subjects(p):
                yield Hit(
                    "passive",
                    tuple(sorted((worden.i, p.i))),
                    f"Passive: «{worden.text}» + participle «{p.text}».",
                )
        elif zijn is not None and _has_agent(s, p) and s.subjects(p):
            yield Hit(
                "passive",
                tuple(sorted((zijn.i, p.i))),
                f"Passive with «{zijn.text}» + participle «{p.text}»: the action is finished.",
            )


def detect_ipp(s: Sentence) -> Iterable[Hit]:
    """Perfect of a modal-like verb with an infinitive instead of a participle:
    ``heeft moeten werken``, ``heb hem zien vallen``."""
    for aux in s.toks:
        if not _is_fin(aux) or aux.dep != "aux" or aux.lemma.lower() not in {"hebben", "zijn"}:
            continue
        head = s.head_of(aux)
        if head is None or "VerbForm=Inf" not in _morph(head):
            continue
        if any(c.lemma.lower() in {"te", "om"} for c in s.children(head, "mark")):
            continue
        inner = [
            c
            for c in s.children(head, "aux")
            if "VerbForm=Inf" in _morph(c) and c.lemma.lower() in IPP_VERBS and c.i > aux.i
        ]
        if inner:
            pair = (inner[0], head)
        else:
            more = [c for c in s.children(head, "xcomp") if "VerbForm=Inf" in _morph(c)]
            if head.lemma.lower() not in IPP_VERBS or not more or head.i < aux.i:
                continue
            pair = (head, more[0])
        yield Hit(
            "verb-clusters",
            tuple(sorted((aux.i, pair[0].i, pair[1].i))),
            f"«{aux.text} … {pair[0].text} {pair[1].text}»: with another infinitive, "
            f"«{pair[0].lemma}» keeps its infinitive instead of a participle.",
        )


def detect_progressive(s: Sentence) -> Iterable[Hit]:
    """zijn + aan het + infinitive: ``Wij zijn aan het eten``."""
    for aan in s.toks:
        if aan.text.lower() != "aan" or aan.pos != "ADP":
            continue
        verb = s.head_of(aan)
        nxt = s.by_index.get(aan.i + 1)
        if verb is None or nxt is None or "VerbForm=Inf" not in _morph(verb):
            continue
        if nxt.text.lower() != "het" or nxt.head not in {verb.i, aan.i} or verb.i <= nxt.i:
            continue
        zijn = [c for c in s.children(verb, "cop", "aux") if c.lemma.lower() == "zijn"]
        if not zijn and verb.pos == "VERB" and nxt.i + 1 == verb.i:
            # The parser sometimes hangs "aan het bouwen" on the object ("een kast"); accept a
            # finite zijn earlier in the sentence when "aan het" + infinitive are adjacent.
            zijn = [t for t in s.toks if t.i < aan.i and _is_fin(t) and t.lemma.lower() == "zijn"]
        if zijn:
            yield Hit(
                "progressive",
                (zijn[0].i, aan.i, nxt.i, verb.i),
                f"«{zijn[0].text} aan het {verb.text}»: busy doing it right now.",
            )


QUANTITY_SUBJECTS = frozenset(
    {"veel", "meer", "weinig", "minder", "iets", "niets", "alles", "iemand", "niemand", "wat"}
)

POSSESSIVES = frozenset(
    {"mijn", "m'n", "jouw", "je", "uw", "zijn", "z'n", "haar", "ons", "onze", "hun", "jullie"}
)


def detect_possessive(s: Sentence) -> Iterable[Hit]:
    """A possessive word before its noun: ``mijn fiets``, ``onze buren``."""
    for t in s.toks:
        if t.pos not in {"PRON", "DET"} or "Poss=Yes" not in _morph(t):
            continue
        if t.text.lower() not in POSSESSIVES or t.dep not in {"nmod:poss", "det"}:
            continue
        noun = s.head_of(t)
        if noun is None or noun.pos != "NOUN" or noun.i < t.i or noun.i - t.i > 3:
            continue
        yield Hit(
            "possessive-pronouns",
            (t.i, noun.i),
            f"«{t.text}» says whose «{noun.text}» it is.",
        )


def detect_conditional_inversion(s: Sentence) -> Iterable[Hit]:
    """An if-clause without ``als``: the verb first, then ``, dan …`` (``Had je gebeld, dan …``)."""
    words = s.words
    if s.is_question or len(words) < 5:
        return
    f, subj = words[0], words[1]
    if not _is_fin(f) or subj.dep not in {"nsubj", "nsubj:pass"} or subj.pos != "PRON":
        return
    for k, a in enumerate(s.toks):
        after = [b for b in s.toks[k + 1 : k + 4] if b.text.lower() == "dan"]
        if a.text == "," and after:
            b = after[0]
            yield Hit(
                "conditional-inversion",
                (f.i, b.i),
                f"The clause starts with the verb «{f.text}»: it means «if…», and «dan» "
                "opens the result.",
            )
            return


# ------------------------------------------------------------- reader detectors (2026-11)
# Precision-first detectors for B1/B2 phenomena the reader marks in the margin. Each one fires
# only on a curated word list plus a parse that agrees; see docs/grammar-coverage.md.

# Prepositions that combine with er/daar/hier/waar, by the form they take in the compound.
PRONOMINAL_PREPS = frozenset(
    {
        "aan",
        "achter",
        "bij",
        "boven",
        "door",
        "in",
        "langs",
        "mee",
        "naar",
        "naast",
        "om",
        "onder",
        "op",
        "over",
        "tegen",
        "toe",
        "tussen",
        "uit",
        "van",
        "voor",
        "zonder",
    }
)
PRONOMINAL_HEADS = ("daar", "hier", "waar", "er")
# Lexicalised compounds whose meaning is not "preposition + it/that" any more.
NOT_PRONOMINAL = frozenset(
    {"daarom", "waarom", "daarna", "hierna", "erna", "daarnaast", "daarvoor", "hiervoor", "ervoor"}
)
# Fixed expressions where the compound is not "preposition + it": "De bus komt eraan".
PRONOMINAL_IDIOMS = frozenset(
    {
        ("komen", "eraan"),
        ("aankomen", "eraan"),
        ("gaan", "eraan"),
        ("zien", "eruit"),
        ("uitzien", "eruit"),
    }
)
# Split forms: the stranded preposition shows its compound form (met -> mee, tot -> toe).
STRANDED_FORM = {"met": "mee", "tot": "toe"}


def _pronominal_parts(word: str) -> tuple[str, str] | None:
    """``("daar", "mee")`` for ``daarmee``; None for anything else."""
    low = word.lower()
    if low in NOT_PRONOMINAL:
        return None
    for head in PRONOMINAL_HEADS:
        rest = low[len(head) :]
        if low.startswith(head) and rest in PRONOMINAL_PREPS:
            return head, rest
    return None


def detect_pronominal_adverb(s: Sentence) -> Iterable[Hit]:
    """``daarmee``, ``erop``, ``waarover``, and split ``daar … mee`` / ``er … aan``."""
    used: set[int] = set()
    for t in s.toks:
        if t.pos not in {"ADV", "PRON", "ADP"}:
            continue
        parts = _pronominal_parts(t.text)
        if parts is not None:
            head = s.head_of(t)
            if head is not None and (head.lemma.lower(), t.text.lower()) in PRONOMINAL_IDIOMS:
                continue
            if t.particle_of is not None:
                continue  # "Je ziet eruit": part of the verb eruitzien
            yield Hit(
                "pronominal-adverbs",
                (t.i,),
                f"«{t.text}» = «{parts[1]}» + «{parts[0]}»: Dutch says «{parts[0]}{parts[1]}» "
                f"instead of a preposition + it/that/what for things.",
            )
            continue
        low = t.text.lower()
        if low not in PRONOMINAL_HEADS or t.pos not in {"ADV", "PRON"} or t.i in used:
            continue
        head = s.head_of(t)
        if head is None or head.pos not in {"VERB", "AUX", "ADJ", "ADV"}:
            continue
        # A bare preposition later in the clause, on the same verb, with nothing after it
        # (stranded): "Daar heb ik niet aan gedacht", "Waar denk je aan?".
        for p in s.toks:
            if p.i <= t.i + 1 or p.pos != "ADP" or p.particle_of is not None:
                continue
            if p.dep == "compound:prt" or s.children(p):
                continue
            # On the same verb, or hung on the adverb itself ("Daar ben ik het mee eens").
            if p.head != t.head and not (p.head == t.i and p.dep == "case"):
                continue
            form = STRANDED_FORM.get(p.text.lower(), p.text.lower())
            if form not in PRONOMINAL_PREPS:
                continue
            nxt = s.by_index.get(p.i + 1)
            if nxt is not None and nxt.pos in {"DET", "NOUN", "PROPN", "PRON", "NUM"}:
                continue  # the preposition still has its own object
            obj = s.by_index.get(p.head) if p.dep == "case" and p.head > p.i else None
            if p.dep == "mark" or (obj is not None and obj.pos not in {"VERB", "AUX"}):
                continue  # the preposition has its own object ("er … van" + a dat-clause is ok)
            if form == "uit" and head.lemma.lower() in {"zien", "uitzien"}:
                continue  # "Ze zien er gelukkig uit": er uitzien is a fixed verb
            used.add(t.i)
            yield Hit(
                "pronominal-adverbs",
                (t.i, p.i),
                f"«{t.text} … {p.text}» is one word split in two («{low}{form}»): "
                f"the preposition goes to the end of the middle field.",
            )
            break


POSITION_VERBS = {
    "staan": "upright",
    "liggen": "lying flat",
    "zitten": "inside, attached or sitting",
    "hangen": "hanging",
}
LOCATIVE_PREPS = frozenset(
    {"in", "op", "onder", "naast", "achter", "voor", "bij", "tussen", "boven", "tegen", "aan"}
)
# Idioms with a position verb that are not about position: "in brand staan", "aan de kant
# staan van", "op een club zitten".
NOT_PLACES = frozenset(
    {
        "vlam",
        "vlammen",
        "brand",
        "kant",
        "club",
        "baseballclub",
        "school",
        "universiteit",
        "schuld",
        "probleem",
    }
)
LOCATIVE_ADVS = frozenset(
    {"hier", "daar", "er", "binnen", "buiten", "thuis", "boven", "beneden", "ergens", "overal"}
)


def detect_position_verb(s: Sentence) -> Iterable[Hit]:
    """staan / liggen / zitten / hangen for where something is, or + ``te`` + infinitive."""
    for v in s.toks:
        lemma = v.lemma.lower()
        if lemma not in POSITION_VERBS or v.pos != "VERB":
            continue
        te_inf = [
            c
            for c in s.children(v, "xcomp")
            if "VerbForm=Inf" in _morph(c)
            and any(m.text.lower() == "te" for m in s.children(c, "mark"))
        ]
        if te_inf:
            inf = te_inf[0]
            te = next(m for m in s.children(inf, "mark") if m.text.lower() == "te")
            yield Hit(
                "position-verbs",
                (v.i, te.i, inf.i),
                f"«{v.text} te {inf.text}»: busy doing it while {lemma[:-2]}ing — "
                f"the position verb gives the posture ({POSITION_VERBS[lemma]}).",
            )
            continue
        place: Token | None = None
        for c in s.children(v, "obl", "advmod", "expl"):
            if c.dep in {"advmod", "expl"} and c.text.lower() in LOCATIVE_ADVS:
                # "Daar ligt het niet aan", "wie hier achter zit": a split er/daar + preposition.
                if any(
                    p.pos == "ADP" and p.head == v.i and not s.children(p) and p.i > c.i
                    for p in s.toks
                ):
                    break
                place = c
                break
            case = s.children(c, "case")
            if c.dep == "obl" and case and case[0].text.lower() in LOCATIVE_PREPS:
                # "Het ligt aan jou" (it depends on you) is not a position, nor "daar zit hij
                # achter" (he is behind it).
                if c.text.lower() in PRONOMINAL_HEADS:
                    continue  # "wie hier achter zit": a split pronominal adverb
                if c.pos == "PRON" and case[0].text.lower() in {"aan", "achter"}:
                    continue
                if c.lemma.lower() in NOT_PLACES:
                    continue
                place = case[0]
                break
        if place is None:
            continue
        yield Hit(
            "position-verbs",
            tuple(sorted((v.i, place.i))),
            f"«{v.text}» says where something is and how: {POSITION_VERBS[lemma]}.",
        )


def detect_laten(s: Sentence) -> Iterable[Hit]:
    """laten + infinitive (let / have something done) and ``laten we`` (let's)."""
    for v in s.toks:
        if v.lemma.lower() != "laten" or v.text.lower() in {"gelaten"}:
            continue
        words = s.words
        nxt = s.by_index.get(v.i + 1)
        if words and words[0].i == v.i and nxt is not None and nxt.text.lower() in {"we", "wij"}:
            yield Hit("laten", (v.i, nxt.i), "«Laten we …»: a suggestion, “let's …”.")
            continue
        infs = [c for c in s.children(v, "xcomp", "ccomp") if "VerbForm=Inf" in _morph(c)]
        if not infs and v.dep in {"aux", "xcomp"}:
            head = s.head_of(v)
            if head is not None and "VerbForm=Inf" in _morph(head) and head.i > v.i:
                infs = [head]
        infs = [x for x in infs if not any(m.text.lower() == "te" for m in s.children(x, "mark"))]
        if infs:
            inf = infs[0]
            yield Hit(
                "laten",
                tuple(sorted((v.i, inf.i))),
                f"«{v.text} … {inf.text}»: let something happen, or have it done by someone.",
            )


# Verb (or adjective) lemma -> the prepositions it takes as a fixed pair.
FIXED_PREPOSITIONS: dict[str, frozenset[str]] = {
    k: frozenset(v.split())
    for k, v in {
        "wachten": "op",
        "denken": "aan",
        "houden": "van",
        "zorgen": "voor",
        "kijken": "naar",
        "luisteren": "naar",
        "praten": "over",
        "zoeken": "naar",
        "geloven": "in",
        "hopen": "op",
        "rekenen": "op",
        "letten": "op",
        "lijken": "op",
        "stoppen": "met",
        "ophouden": "met",
        "deelnemen": "aan",
        "meedoen": "aan",
        "bestaan": "uit",
        "afhangen": "van",
        "genieten": "van",
        "dromen": "van",
        "schrikken": "van",
        "twijfelen": "aan",
        "verlangen": "naar",
        "ergeren": "aan",
        "interesseren": "voor",
        "verheugen": "op",
        "concentreren": "op",
        "voorbereiden": "op",
        "schamen": "voor",
        "reageren": "op",
        "antwoorden": "op",
        "omgaan": "met",
        "beschikken": "over",
        "klagen": "over",
        "nadenken": "over",
        "kiezen": "voor",
        "vragen": "om naar",
        "bang": "voor",
        "trots": "op",
        "gek": "op",
        "boos": "op",
        "jaloers": "op",
        "verliefd": "op",
        "geïnteresseerd": "in",
        "tevreden": "over met",
        "afhankelijk": "van",
        "verantwoordelijk": "voor",
        "zeker": "van",
        "benieuwd": "naar",
        "gewend": "aan",
    }.items()
}
# "wachten op het station": op + a place is where, not what you wait for.
PLACE_NOUNS = frozenset(
    {
        "station",
        "perron",
        "straat",
        "plein",
        "hoek",
        "school",
        "werk",
        "kantoor",
        "vliegveld",
        "halte",
        "stoep",
        "bank",
        "markt",
        "dak",
        "tafel",
        "bed",
        "stoel",
        "gang",
        "terras",
        "balkon",
        "trap",
        "strand",
    }
)


def detect_fixed_preposition(s: Sentence) -> Iterable[Hit]:
    """A verb or adjective with its fixed preposition: ``wachten op``, ``trots op``."""
    for v in s.toks:
        preps = FIXED_PREPOSITIONS.get(v.lemma.lower())
        if preps is None or v.pos not in {"VERB", "ADJ"}:
            continue
        for c in s.children(v, "obl", "obl:arg", "advmod", "nmod"):
            prep: Token | None = None
            case = s.children(c, "case")
            if case and case[0].text.lower() in preps:
                if c.lemma.lower() in PLACE_NOUNS:
                    continue
                prep = case[0]
            else:
                parts = _pronominal_parts(c.text)
                if parts is not None and parts[1] in preps:
                    prep = c
            if prep is not None:
                yield Hit(
                    "verbs-with-prepositions",
                    tuple(sorted((v.i, prep.i))),
                    f"«{v.lemma} {next(iter(sorted(preps)))}» is a fixed pair: "
                    "learn the preposition with the word.",
                )
                break
        else:
            # Split pronominal adverb: "Ik wacht er al lang op", "Daar denk ik niet aan".
            for p in s.toks:
                if p.pos != "ADP" or p.head != v.i or s.children(p) or p.i < v.i - 6:
                    continue
                if p.particle_of is not None or p.dep == "compound:prt":
                    continue
                form = STRANDED_FORM.get(p.text.lower(), p.text.lower())
                fixed = {STRANDED_FORM.get(x, x) for x in preps}
                adv = next(
                    (x for x in s.children(v) if x.text.lower() in PRONOMINAL_HEADS and x.i < p.i),
                    None,
                )
                if form in fixed and adv is not None:
                    yield Hit(
                        "verbs-with-prepositions",
                        tuple(sorted((v.i, adv.i, p.i))),
                        f"«{v.lemma} {p.text}» is a fixed pair; here the preposition "
                        f"is split off with «{adv.text}».",
                    )
                    break


def detect_niet_position(s: Sentence) -> Iterable[Hit]:
    """``niet`` where its place is clear: before a predicate adjective or a prepositional
    phrase, or at the end after a definite object."""
    words = s.words
    for n in s.toks:
        if n.text.lower() != "niet" or n.pos not in {"ADV", "PART"}:
            continue
        nxt = next((w for w in words if w.i > n.i), None)
        head = s.head_of(n)
        if head is None or nxt is None:
            continue
        if nxt.i == head.i and head.pos == "ADJ" and s.children(head, "cop"):
            yield Hit(
                "niet-position",
                (n.i, head.i),
                f"«niet» goes right before the adjective «{head.text}».",
            )
            continue
        if nxt.pos == "ADP" and nxt.dep == "case":
            pp = s.head_of(nxt)
            if pp is not None and pp.i > nxt.i and pp.head == n.head and pp.dep == "obl":
                yield Hit(
                    "niet-position",
                    (n.i, nxt.i, pp.i),
                    f"«niet» goes before the phrase with «{nxt.text}».",
                )
                continue
    # "Ik zie de man niet.": niet closes the clause after the definite object.
    last = words[-1] if words else None
    if last is not None and last.text.lower() == "niet" and last.pos in {"ADV", "PART"}:
        head = s.head_of(last)
        if head is not None and head.pos == "VERB" and _is_fin(head):
            objs = [
                o
                for o in s.children(head, "obj")
                if o.i < last.i
                and (
                    (o.pos == "PRON" and o.text.lower() not in {"iets", "niets", "wat", "alles"})
                    or any(
                        d.text.lower() in {"de", "het", "deze", "die", "dit", "dat"}
                        for d in s.children(o, "det")
                    )
                    or any("Poss=Yes" in _morph(d) for d in s.children(o, "nmod:poss"))
                )
            ]
            if objs:
                yield Hit(
                    "niet-position",
                    (objs[0].i, last.i),
                    f"«niet» comes at the end, after the definite object «{objs[0].text}».",
                )


INSEPARABLE_VERBS = frozenset(
    [
        "beantwoorden",
        "bedanken",
        "bedoelen",
        "beginnen",
        "begrijpen",
        "behalen",
        "behandelen",
        "behoren",
        "beloven",
        "bepalen",
        "bereiken",
        "beschermen",
        "beschrijven",
        "beslissen",
        "bespreken",
        "bestaan",
        "bestellen",
        "betalen",
        "betekenen",
        "bevallen",
        "bewegen",
        "beweren",
        "bewijzen",
        "bezitten",
        "bezoeken",
        "gebeuren",
        "gebruiken",
        "gehoorzamen",
        "genieten",
        "herhalen",
        "herinneren",
        "herkennen",
        "herstellen",
        "ontbijten",
        "ontdekken",
        "ontmoeten",
        "ontslaan",
        "ontstaan",
        "ontvangen",
        "ontwikkelen",
        "erkennen",
        "ervaren",
        "verbeteren",
        "verbieden",
        "verbinden",
        "verdedigen",
        "verdienen",
        "verdwijnen",
        "vergelijken",
        "vergeten",
        "verhuizen",
        "verkopen",
        "verklaren",
        "verlaten",
        "verliezen",
        "vermijden",
        "veranderen",
        "veroorzaken",
        "verrassen",
        "verschijnen",
        "verschillen",
        "verstaan",
        "versturen",
        "vertalen",
        "vertellen",
        "vertrekken",
        "vertrouwen",
        "verwachten",
        "verwijderen",
        "verzamelen",
        "verzorgen",
    ]
)
INSEPARABLE_PREFIXES = ("be", "ge", "her", "ont", "ver", "er")


def detect_inseparable(s: Sentence) -> Iterable[Hit]:
    """A common verb with an inseparable prefix (be-, ge-, her-, ont-, ver-, er-)."""
    for v in s.toks:
        lemma = v.lemma.lower()
        if lemma not in INSEPARABLE_VERBS or v.pos not in {"VERB", "AUX"}:
            continue
        if v.dep in {"aux", "aux:pass", "cop", "amod", "det"} or v.text.lower().endswith("end"):
            continue  # "bepaalde rechten": an adjective
        prefix = next(
            p for p in sorted(INSEPARABLE_PREFIXES, key=len, reverse=True) if lemma.startswith(p)
        )
        if "VerbForm=Part" in _morph(v) and v.text.lower().startswith(prefix):
            note = (
                f"«{v.text}»: no extra ge- in the participle, because «{prefix}-» is an "
                "inseparable prefix."
            )
        elif _is_fin(v):
            note = f"«{prefix}-» in «{lemma}» never splits off: «{v.text}» stays one word."
        else:
            continue
        yield Hit("inseparable-prefixes", (v.i,), note)


def _is_command(s: Sentence) -> bool:
    words = s.words
    if not words or s.is_question:
        return False
    first = words[0]
    if first.lemma.lower() in {"alsjeblieft", "alstublieft", "even", "maar", "toch"}:
        first = words[1] if len(words) > 1 else first
    return (
        _is_fin(first)
        and not s.subjects(s.clause_head(first))
        and "Tense=Past" not in _morph(first)
    )


def _has_modal(s: Sentence) -> bool:
    return any(_is_fin(t) and t.lemma.lower() in {"kunnen", "willen", "mogen"} for t in s.toks)


PARTICLE_NOTES = {
    "even": "«even» makes a request small and friendly: “just (for a moment)”.",
    "maar": "«maar» in a request softens or encourages: “go ahead and …”.",
    "eens": "«eens» makes a request or suggestion lighter: “(just) have a …”.",
    "toch": "«toch» appeals to what the listener already knows or should agree with.",
    "nou": "«nou» adds impatience or emphasis: “then / now”.",
    "hoor": "«hoor» at the end reassures or insists: “you know / really”.",
}


def detect_modal_particle(s: Sentence) -> Iterable[Hit]:
    """even / maar / eens / toch / nou / hoor used as a tone particle."""
    words = s.words
    command = _is_command(s)
    question = s.is_question
    exclaim = bool(s.toks) and s.toks[-1].text == "!"
    request = command or (question and _has_modal(s))
    for k, t in enumerate(words):
        low = t.text.lower()
        if low not in PARTICLE_NOTES or t.pos not in {"ADV", "PART", "INTJ"}:
            continue
        nxt = words[k + 1] if k + 1 < len(words) else None
        if low in {"even", "maar"}:
            # "even groot" (equally), "maar twee" (only): not particles.
            if nxt is not None and (
                nxt.pos in {"ADJ", "NUM"} or nxt.text.lower() in {"een", "één", "zo", "net"}
            ):
                continue
            ok = request
        elif low == "eens":
            prev = words[k - 1].text.lower() if k > 0 else ""
            ok = request and prev not in {"nog", "wel", "niet"}
        elif low == "toch":
            ok = question or exclaim or command
        elif low == "nou":
            ok = (question or command or exclaim) and k > 0
        else:  # hoor: last word, after a comma
            prev_tok = s.by_index.get(t.i - 1)
            ok = nxt is None and prev_tok is not None and prev_tok.text == ","
        if ok:
            yield Hit("modal-particles", (t.i,), PARTICLE_NOTES[low])


OBJECT_FORMS = frozenset(
    {"mij", "me", "jou", "je", "hem", "haar", "ons", "jullie", "hen", "hun", "ze"}
)


def detect_object_pronoun(s: Sentence) -> Iterable[Hit]:
    """Object forms of personal pronouns (after a verb or a preposition), not reflexive."""
    for t in s.toks:
        low = t.text.lower()
        if low not in OBJECT_FORMS or t.pos != "PRON" or "Poss=Yes" in _morph(t):
            continue
        if "Case=Nom" in _morph(t) or t.dep in {"expl:pv", "nsubj", "nsubj:pass", "nmod:poss"}:
            continue
        head = s.head_of(t)
        if head is None:
            continue
        prev = s.by_index.get(t.i - 1)
        nxt = s.by_index.get(t.i + 1)
        if (prev is not None and (prev.pos == "DET" or "Poss=Yes" in _morph(prev))) or (
            low in {"haar", "je", "ons"}
            and nxt is not None
            and nxt.pos in {"NOUN", "PROPN"}
            and nxt.head == t.head
        ):
            continue  # possessive or the noun "haar" (hair) misread as a pronoun
        after_prep = bool(s.children(t, "case"))
        if t.dep in {"obj", "iobj"} and head.pos in {"VERB", "AUX"}:
            subject = _subject_lemma(s, head)
            if subject is not None and (
                low in REFLEXIVE_FOR.get(subject, set()) or (subject, low) == ("ik", "mij")
            ):
                continue  # reflexive (ik … me), a different topic
            if low in {"je", "ze", "jullie"} and "Case=Acc" not in _morph(t):
                continue  # same form as the subject: only trust an explicit object case
            note = f"«{t.text}» is the object form: it receives the action of «{head.text}»."
        elif after_prep and t.dep in {"obl", "nmod", "obl:agent"}:
            prep = s.children(t, "case")[0]
            if low in {"je", "ze", "jullie"} and "Case=Acc" not in _morph(t):
                continue
            note = f"After «{prep.text}» Dutch uses the object form «{t.text}»."
        else:
            continue
        yield Hit("object-pronouns", (t.i,), note)


DETECTORS: tuple[Detector, ...] = (
    detect_inversion,
    detect_question,
    detect_subordinate,
    detect_separable,
    detect_perfect,
    detect_modal,
    detect_imperfect,
    detect_future,
    detect_reflexive,
    detect_om_te,
    detect_te_infinitive,
    detect_adjective,
    detect_comparison,
    detect_negation,
    detect_demonstrative,
    detect_er,
    detect_relative,
    detect_diminutive,
    detect_plural,
    detect_imperative,
    detect_indirect_speech,
    detect_conjunction,
    detect_past_perfect,
    detect_conditional,
    detect_passive,
    detect_ipp,
    detect_progressive,
    detect_possessive,
    detect_conditional_inversion,
    detect_pronominal_adverb,
    detect_position_verb,
    detect_laten,
    detect_fixed_preposition,
    detect_niet_position,
    detect_inseparable,
    detect_modal_particle,
    detect_object_pronoun,
)

TOPICS: frozenset[str] = frozenset(
    {
        "inversion",
        "questions",
        "subordinate-clauses",
        "separable-verbs",
        "perfect-tense",
        "modal-verbs",
        "imperfect-tense",
        "future",
        "reflexive-verbs",
        "om-te-infinitive",
        "te-infinitive",
        "adjective-inflection",
        "comparison",
        "negation",
        "demonstratives",
        "er",
        "relative-pronouns",
        "diminutives",
        "plural-nouns",
        "imperative",
        "indirect-speech",
        "conjunctions",
        "past-perfect",
        "conditional",
        "conditional-perfect",
        "passive",
        "impersonal-passive",
        "verb-clusters",
        "progressive",
        "possessive-pronouns",
        "conditional-inversion",
        "pronominal-adverbs",
        "position-verbs",
        "laten",
        "verbs-with-prepositions",
        "niet-position",
        "inseparable-prefixes",
        "modal-particles",
        "object-pronouns",
    }
)
"""Topic ids the detectors can produce (a subset of the topic pages)."""


# ------------------------------------------------------------------------------------ driver


def split_sentences(analysis: TextAnalysis) -> list[Sentence]:
    """Group the tokens of an analysis by sentence id."""
    by_index = {t.i: t for t in analysis.tokens}
    groups: dict[int, list[Token]] = defaultdict(list)
    for t in analysis.tokens:
        groups[t.sent].append(t)
    return [Sentence(toks, by_index) for _, toks in sorted(groups.items())]


def detect_sentence(s: Sentence, topics: frozenset[str] | None = None) -> list[Hit]:
    """All hits of one sentence (optionally only for ``topics``), in token order."""
    hits = [h for d in DETECTORS for h in d(s) if topics is None or h.topic in topics]
    return sorted(hits, key=lambda h: (min(h.tokens), h.topic))


def _slice_utf16(text: str, start: int, end: int) -> str:
    """``text[start:end]`` with UTF-16 code-unit offsets (the unit of ``Token.start``)."""
    raw = text.encode("utf-16-le")
    return raw[2 * start : 2 * end].decode("utf-16-le", errors="ignore")


def detect_grammar(text: str, analysis: TextAnalysis) -> list[GrammarHit]:
    """Run every detector over an analysed text.

    Returns hits in text order. ``start``/``end`` are the sentence's UTF-16 offsets in ``text``.
    """
    out: list[GrammarHit] = []
    for s in split_sentences(analysis):
        if not s.toks:
            continue
        start, end = s.toks[0].start, s.toks[-1].end
        sentence = _slice_utf16(text, start, end).strip()
        for h in detect_sentence(s):
            out.append(
                GrammarHit(
                    topic=h.topic,
                    tokens=list(h.tokens),
                    sent=s.toks[0].sent,
                    sentence=sentence,
                    start=start,
                    end=end,
                    note=h.note,
                )
            )
    return out
