"""SyntaxDot's parse in ``syn`` (SX1); skipped where SyntaxDot isn't set up."""

from pathlib import Path

import pytest

from vuurtoren_nlp.pipeline import analyze_texts
from vuurtoren_nlp.syntax import syntaxdot_dir

LOCAL = Path("~/.local/share/vuurtoren/syntaxdot").expanduser()


def test_without_syntaxdot_no_syn(monkeypatch):
    monkeypatch.delenv("VUURTOREN_SYNTAXDOT_DIR", raising=False)
    [a] = analyze_texts("nl", ["Er komt mist van de zee."])
    assert all(t.syn is None for t in a.tokens)


@pytest.mark.skipif(not (LOCAL / "bin" / "syntaxdot").exists(), reason="SyntaxDot not installed")
def test_syntaxdot_parse_on_the_same_words(monkeypatch):
    monkeypatch.setenv("VUURTOREN_SYNTAXDOT_DIR", str(LOCAL))
    assert syntaxdot_dir() is not None
    [a] = analyze_texts("nl", ["Er komt mist van de zee. Hij doet de deur open."])
    words = {t.text: t for t in a.tokens}
    # spaCy reads "mist" as a verb; SyntaxDot as the noun it is.
    assert words["mist"].syn is not None and words["mist"].syn.pos == "NOUN"
    assert words["komt"].syn.dep == "ROOT"
    # the split verb's particle, found by the usual code on SyntaxDot's parse
    assert words["open"].syn.particle_of == words["doet"].i
    assert [t.text for t in a.tokens] == [
        "Er",
        "komt",
        "mist",
        "van",
        "de",
        "zee",
        ".",
        "Hij",
        "doet",
        "de",
        "deur",
        "open",
        ".",
    ]


def test_one_root_per_sentence():
    from vuurtoren_nlp.syntax import _one_root

    # "Ze begroet meneer": two roots from SyntaxDot; the verb stays the root
    cols = [
        ["1", "Ze", "ze", "PRON", "_", "_", "2", "obj"],
        ["2", "begroet", "begroeten", "VERB", "_", "VerbForm=Fin", "0", "root"],
        ["3", "meneer", "meneer", "NOUN", "_", "_", "0", "root"],
    ]
    _one_root(cols)
    assert [c[6] for c in cols] == ["2", "0", "2"]
    assert cols[2][7] == "dep"


# --- SX2: SyntaxDot's own lemma as one more candidate (needs the Kaikki dictionary DB) ---
from vuurtoren_nlp.lexicon import get_lexicon  # noqa: E402
from vuurtoren_nlp.pipeline import syntax_lemma  # noqa: E402

needs_db = pytest.mark.skipif(not get_lexicon().available, reason="Kaikki dictionary DB not built")


@needs_db
@pytest.mark.parametrize(
    ("surface", "pos", "ours", "theirs", "primary"),
    [
        # ours is no word of its own: theirs wins
        ("geheugen", "NOUN", "geheug", "geheugen", "geheugen"),
        ("schiep", "VERB", "schapen", "scheppen", "scheppen"),
        ("weeks", "NOUN", "weeks", "week", "week"),
        ("voorbijgaat", "ADP", "voorbijgaat", "voorbijgaan", "voorbijgaan"),
        # what we do on purpose stays
        ("doet", "VERB", "dichtdoen", "doen", "dichtdoen"),
        ("broertjes", "NOUN", "broertje", "broer", "broertje"),
        ("beetje", "NOUN", "beetje", "beet", "beetje"),
        ("volgende", "VERB", "volgend", "volgen", "volgend"),
        # theirs is only a form, or no word: ignored
        ("lachten", "VERB", "meelachen", "lachten", "meelachen"),
        ("Ziet", "VERB", "zien", "zietn", "zien"),
        # both are words of their own: ours stays
        ("jongen", "NOUN", "jongen", "jong", "jongen"),
        ("mij", "PRON", "mij", "me", "mij"),
    ],
)
def test_syntax_lemma(surface, pos, ours, theirs, primary):
    got, alts = syntax_lemma("nl", surface, pos, ours, [], theirs)
    assert got == primary
    if got != ours:
        assert ours in alts  # ours is still tried by the matcher


def test_syntax_lemma_without_a_parse_changes_nothing():
    assert syntax_lemma("nl", "kat", "NOUN", "kat", ["x"], None) == ("kat", ["x"])
