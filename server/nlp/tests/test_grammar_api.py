"""``/grammar`` and ``/grammar/examples`` over the real pipeline on a tiny corpus."""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp import app as app_module
from vuurtoren_nlp.app import app
from vuurtoren_nlp.grammar_examples import GrammarExamples
from vuurtoren_nlp.pipeline import analyze_texts
from vuurtoren_nlp.sentences import build_sentence_db

client = TestClient(app)

PAIRS = [
    (1, "Morgen ga ik naar school.", "I am going to school tomorrow."),
    (2, "Gisteren kocht hij een nieuwe fiets.", "Yesterday he bought a new bike."),
    (3, "Ik blijf thuis omdat het regent.", "I stay home because it rains."),
    (4, "Ik ben moe.", "I am tired."),
    (5, "Zij heeft de brief gisteren gelezen.", "She read the letter yesterday."),
    (6, "Vandaag werkt hij thuis.", "Today he works at home."),
]


@pytest.fixture
def sentence_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "sentences.sqlite"
    build_sentence_db(PAIRS, lambda texts: analyze_texts("nl", texts), path)
    monkeypatch.setenv("VUURTOREN_SENTENCES_PATH", str(path))
    monkeypatch.setenv("VUURTOREN_GRAMMAR_CACHE_PATH", str(tmp_path / "cache.sqlite"))
    return path


def test_grammar_endpoint() -> None:
    texts = ["Morgen ga ik naar school. Ik ben moe.", "Hij heeft het boek gelezen.", ""]
    res = client.post("/grammar", json={"lang": "nl", "texts": texts})
    assert res.status_code == 200
    first, second, third = res.json()
    inversion = [h for h in first if h["topic"] == "inversion"]
    assert len(inversion) == 1
    assert inversion[0]["sentence"] == "Morgen ga ik naar school."
    assert (inversion[0]["start"], inversion[0]["end"]) == (0, 25)
    assert any(h["topic"] == "perfect-tense" for h in second)
    assert third == []


def test_grammar_tokens_index_the_analysis() -> None:
    text = "Gisteren heb ik de kinderen gezien."
    (analysis,) = analyze_texts("nl", [text])
    hits = client.post("/grammar", json={"lang": "nl", "texts": [text]}).json()[0]
    perfect = next(h for h in hits if h["topic"] == "perfect-tense")
    assert [analysis.tokens[i].text for i in perfect["tokens"]] == ["heb", "gezien"]


def test_grammar_validates_input() -> None:
    assert client.post("/grammar", json={"lang": "xx", "texts": []}).status_code == 422
    assert client.post("/grammar", json={"lang": "nl"}).status_code == 422


def test_examples_endpoint(sentence_db: Path) -> None:
    res = client.get("/grammar/examples", params={"topic": "inversion", "limit": 5})
    assert res.status_code == 200
    examples = res.json()
    texts = {e["text"] for e in examples}
    assert "Morgen ga ik naar school." in texts
    assert "Ik ben moe." not in texts
    first = next(e for e in examples if e["text"] == "Morgen ga ik naar school.")
    assert first["translation"] == "I am going to school tomorrow."
    assert [first["text"][a:b] for a, b in first["marks"]] == ["ga", "ik"]
    assert first["source"] == "tatoeba"


def test_examples_unknown_topic_and_bad_input(sentence_db: Path) -> None:
    assert client.get("/grammar/examples", params={"topic": "personal-pronouns"}).json() == []
    assert client.get("/grammar/examples", params={"topic": "Bad Topic"}).status_code == 422
    assert client.get("/grammar/examples", params={"topic": "er", "limit": 11}).status_code == 422


def test_examples_missing_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VUURTOREN_SENTENCES_PATH", str(tmp_path / "nope.sqlite"))
    res = client.get("/grammar/examples", params={"topic": "inversion"})
    assert res.status_code == 503
    assert "build_sentences" in res.json()["detail"]


def test_examples_scan_is_cached_and_incremental(sentence_db: Path, tmp_path: Path) -> None:
    cache = tmp_path / "scan.sqlite"
    ex = GrammarExamples(sentence_db, cache)
    assert ex.examples("perfect-tense", 1)
    con = sqlite3.connect(cache)
    scanned = int(con.execute("SELECT value FROM meta WHERE key='cursor'").fetchone()[0])
    assert scanned > 0
    con.close()
    # A second request is answered from the cache without scanning further.
    again = GrammarExamples(sentence_db, cache).examples("perfect-tense", 1)
    assert [e["text"] for e in again] == ["Zij heeft de brief gisteren gelezen."]
    con = sqlite3.connect(cache)
    assert int(con.execute("SELECT value FROM meta WHERE key='cursor'").fetchone()[0]) == scanned
    con.close()


def test_examples_cache_resets_when_detectors_change(
    sentence_db: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from vuurtoren_nlp import grammar_examples

    cache = tmp_path / "v.sqlite"
    GrammarExamples(sentence_db, cache).examples("inversion", 1)
    monkeypatch.setattr(grammar_examples, "detector_version", lambda: "changed")
    GrammarExamples(sentence_db, cache).examples("er", 1, budget_s=0)
    con = sqlite3.connect(cache)
    assert con.execute("SELECT value FROM meta WHERE key='version'").fetchone()[0] == "changed"
    assert con.execute("SELECT COUNT(*) FROM examples").fetchone()[0] == 0
    con.close()


def test_examples_read_only_cache(
    sentence_db: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A precomputed cache in a read-only directory (the Docker /data) is read, never written."""
    from vuurtoren_nlp import grammar_examples

    cache = tmp_path / "ro" / "cache.sqlite"
    cache.parent.mkdir()
    full = GrammarExamples(sentence_db, cache).examples("inversion", 5)
    assert full
    scanned = GrammarExamples(sentence_db, cache).progress()[0]
    monkeypatch.setattr(grammar_examples.os, "access", lambda *_a, **_k: False)
    ro = GrammarExamples(sentence_db, cache)
    assert not ro.writable()
    assert ro.examples("inversion", 5) == full
    # No scanning: a topic missing from the cache simply has fewer (or no) examples.
    ro.examples("perfect-tense", 5)
    assert ro.progress()[0] == scanned
    # A cache built by other detectors is not trusted.
    monkeypatch.setattr(grammar_examples, "detector_version", lambda: "changed")
    assert ro.examples("inversion", 5) == []
    # No cache at all: empty, no error.
    assert GrammarExamples(sentence_db, tmp_path / "none" / "c.sqlite").examples("er", 3) == []


def test_app_module_exposes_routes() -> None:
    paths = {r.path for r in app_module.app.routes}
    assert {"/grammar", "/grammar/examples"} <= paths
