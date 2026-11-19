"""Regressions: article pairs in headwords, curly-apostrophe clitics."""

import pytest

from kenning_nlp.pipeline import analyze_terms, analyze_texts


@pytest.mark.parametrize(
    ("raw", "key"),
    [
        ("de/het deel", "deel"),
        ("de, het deel", "deel"),
        ("het/de deel", "deel"),
        ("1) lopen", "lopen"),
    ],
)
def test_article_pairs_and_enumerators(raw: str, key: str) -> None:
    (t,) = analyze_terms("nl", [raw])
    assert t.key == key
    assert "de" not in t.aliases and "het" not in t.aliases


def test_curly_clitics_lemmatise_and_keep_surface() -> None:
    (a,) = analyze_texts("nl", ["Hij eet ’t brood en ’n appel."])
    by_text = {t.text: t.lemma for t in a.tokens}
    assert by_text["’t"] == "het"
    assert by_text["’n"] == "een"
