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
        if aux.dep == "aux:pass":
            continue
        head = s.head_of(aux)
        parts = [head] if head is not None and aux.dep == "aux" else []
        parts += [c for c in s.children(aux) if c.dep in {"xcomp", "ccomp"}]
        for p in parts:
            if p.pos != "VERB" or "VerbForm=Part" not in _morph(p):
                continue
            if aux.lemma.lower() == "zijn" and not _is_zijn_verb(p.lemma):
                continue  # most "zijn + participle" is a passive or a state ("is gesloten")
            yield Hit(
                "perfect-tense",
                tuple(sorted((aux.i, p.i))),
                f"Perfect tense: «{aux.text}» + participle «{p.text}» ({p.lemma}).",
            )
            break


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
        if t.dep == "expl" or any(x.dep == "nsubj" and x.i > t.i for x in s.kids[verb.i]):
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
