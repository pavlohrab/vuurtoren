from fastapi.testclient import TestClient

from vuurtoren_nlp.app import app
from vuurtoren_nlp.freq import token_zipf, zipf

client = TestClient(app)


def test_zipf_common_vs_rare_vs_unknown() -> None:
    assert zipf("de") > 6
    assert 0 < zipf("fiets") < zipf("de")
    assert zipf("xqzvbnm") == 0


def test_token_zipf_fallback_and_nonword() -> None:
    assert token_zipf("xqzvbnm", "Fiets", True) == zipf("fiets")  # lemma 0 -> lowercased surface
    assert token_zipf("fiets", "fietsen", True) == zipf("fiets")
    assert token_zipf("de", ".", False) == 0.0


def test_analyze_text_tokens_have_zipf() -> None:
    r = client.post("/analyze/text", json={"lang": "nl", "texts": ["De fiets, 12."]})
    toks = {t["text"]: t for t in r.json()[0]["tokens"]}
    assert toks["De"]["zipf"] > 6
    assert 0 < toks["fiets"]["zipf"] < 6
    assert toks[","]["zipf"] == 0
    assert toks["12"]["zipf"] == 0
