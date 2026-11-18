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
    r = client.post("/detect", json={"texts": ["gezellig", "the house is big", "", "17.31"]})
    langs = [d["lang"] for d in r.json()]
    assert langs == ["nl", "en", None, None]


def test_analyze_reports_analyzer_version() -> None:
    from kenning_nlp.analyzer import analyzer_version

    r = client.post("/analyze/text", json={"lang": "nl", "texts": ["De kat slaapt."]})
    assert r.json()[0]["analyzerVersion"] == analyzer_version()
    assert client.get("/health").json()["analyzerVersion"] == analyzer_version()


def test_detect_short_strings_and_scripts() -> None:
    texts = [
        "Ik heb geen tijd want ik moet werken.",
        "I don't have time because I have to work.",
        "fietsen",
        "Ich habe heute keine Zeit.",
        "Дякую, все добре.",
        "Спасибо, всё хорошо.",
        "woordeloos",
    ]
    langs = [d["lang"] for d in client.post("/detect", json={"texts": texts}).json()]
    assert langs == ["nl", "en", "nl", "de", "uk", "ru", "nl"]
