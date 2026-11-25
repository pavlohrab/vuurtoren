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
