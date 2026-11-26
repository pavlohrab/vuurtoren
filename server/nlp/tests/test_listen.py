"""Speech to text for the speaking exercise (asr-nl)."""

import io
import math
import os
import struct
import wave

import pytest
from fastapi.testclient import TestClient

from vuurtoren_nlp import listen
from vuurtoren_nlp.app import app
from vuurtoren_nlp.errors import ServiceError


def _wav(seconds: float = 0.5, rate: int = 16000, loud: bool = False) -> bytes:
    """Silence, or a 440 Hz tone when ``loud``."""
    n = int(seconds * rate)
    samples = (8000 * math.sin(2 * math.pi * 440 * i / rate) for i in range(n)) if loud else [0] * n
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{n}h", *(int(x) for x in samples)))
    return buf.getvalue()


def test_without_the_model_it_says_so(tmp_path, monkeypatch):
    monkeypatch.setenv("VUURTOREN_ASR_DIR", str(tmp_path))
    monkeypatch.setattr(listen, "_rec", None)
    assert listen.available() is False
    r = TestClient(app).post("/listen", content=_wav(loud=True))
    assert r.status_code == 503


def test_refuses_what_isnt_a_short_wav(tmp_path, monkeypatch):
    monkeypatch.setenv("VUURTOREN_ASR_DIR", str(tmp_path))
    with pytest.raises(ServiceError):
        listen.transcribe(b"not a wav")
    with pytest.raises(ServiceError):
        listen.transcribe(_wav(seconds=25))


@pytest.mark.skipif(
    not os.environ.get("VUURTOREN_ASR_DIR"), reason="needs the asr-nl model (VUURTOREN_ASR_DIR)"
)
def test_hears_silence_as_nothing():
    assert listen.transcribe(_wav()) == ""
