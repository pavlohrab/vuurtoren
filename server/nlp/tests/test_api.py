from fastapi.testclient import TestClient

from kenning_nlp.app import app

client = TestClient(app)


def test_analyze_text_endpoint() -> None:
    r = client.post("/analyze/text", json={"lang": "nl", "texts": ["Ik bel je op."]})
    assert r.status_code == 200
    assert any(t["lemma"] == "opbellen" for t in r.json()[0]["tokens"])


def test_analyze_terms_endpoint() -> None:
    r = client.post("/analyze/terms", json={"lang": "nl", "texts": ["de fiets"]})
    assert r.json()[0]["key"] == "fiets"


def test_unsupported_language() -> None:
    r = client.post("/analyze/text", json={"lang": "xx", "texts": ["a"]})
    assert r.status_code == 422


def test_detect_endpoint() -> None:
    r = client.post("/detect", json={"texts": ["gezellig", "the house is big", ""]})
    langs = [d["lang"] for d in r.json()]
    assert langs == ["nl", "en", None]
