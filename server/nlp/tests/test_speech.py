"""The Dutch voice (Piper) behind /speech."""

import os
import wave
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp import speech
from vuurtoren_nlp.app import app

VOICE = os.environ.get("VUURTOREN_TEST_TTS_DIR", "/tmp/claude-1000/ttspack/tts-nl")


def test_without_the_voice_it_says_so(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VUURTOREN_TTS_DIR", str(tmp_path))
    monkeypatch.setattr(speech, "_voice", None)
    assert speech.available() is False
    r = TestClient(app).get("/speech", params={"text": "de fiets"})
    assert r.status_code == 503
    assert "tts-nl" in r.json()["detail"]


def test_empty_text_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    r = TestClient(app).get("/speech", params={"text": "   "})
    assert r.status_code == 422


@pytest.mark.skipif(not Path(VOICE).is_dir(), reason="the tts-nl voice is not downloaded")
def test_says_a_word_as_wav(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("piper")
    monkeypatch.setenv("VUURTOREN_TTS_DIR", VOICE)
    monkeypatch.setattr(speech, "_voice", None)
    assert speech.available() is True
    client = TestClient(app)
    r = client.get("/speech", params={"text": "de fiets", "rate": 1})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/wav"
    with wave.open(BytesIO(r.content)) as w:
        normal = w.getnframes()
        assert normal / w.getframerate() > 0.3

    # Piper varies a little between runs: compare a slow and a fast sentence, far apart.
    def frames(rate: float) -> int:
        text = "Ik fiets elke dag naar mijn werk."
        body = client.get("/speech", params={"text": text, "rate": rate}).content
        with wave.open(BytesIO(body)) as w:
            return w.getnframes()

    assert frames(0.5) > frames(1.5) * 1.5
