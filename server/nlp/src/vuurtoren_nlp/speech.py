"""A Dutch voice for words and sentences without a recording: Piper, offline.

Computers with a Dutch system voice (Windows, macOS with the voice installed) use their own; a
computer without one (most Linux desktops: the app's WebKitGTK has no speech engine) asks this
server instead. The voice model is the ``tts-nl`` pack (``nl_NL-mls-medium``, CC BY 4.0, from the
MLS corpus). It loads on first use (about 0.5 s) and says a word in about 60 ms.
"""

from __future__ import annotations

import io
import threading
import wave
from pathlib import Path

from vuurtoren_nlp.datadir import data_path
from vuurtoren_nlp.errors import ServiceError

MAX_CHARS = 600
"""Longer texts are cut: this is for a word or a sentence, not a page."""


def tts_dir() -> Path:
    """Voice location: ``$VUURTOREN_TTS_DIR`` or ``<data>/tts-nl``."""
    return data_path("VUURTOREN_TTS_DIR", "tts-nl")


def _model() -> Path | None:
    d = tts_dir()
    return next(iter(sorted(d.glob("*.onnx"))), None) if d.is_dir() else None


def available() -> bool:
    """Piper is installed and the voice is there."""
    try:
        import piper  # noqa: F401
    except ImportError:
        return False
    return _model() is not None


_voice = None
_lock = threading.Lock()


def _load():  # noqa: ANN202 (PiperVoice is optional at import time)
    global _voice
    if _voice is None:
        with _lock:
            if _voice is None:
                model = _model()
                if model is None:
                    raise ServiceError(503, "The Dutch voice (tts-nl) is not installed.")
                try:
                    from piper import PiperVoice
                except ImportError as e:
                    raise ServiceError(503, "Speech is not part of this server.") from e
                _voice = PiperVoice.load(str(model))
    return _voice


def synthesize(text: str, rate: float = 1.0) -> bytes:
    """``text`` said in Dutch, as a WAV file; ``rate`` 0.5-2 (1 is normal)."""
    text = " ".join(text.split())[:MAX_CHARS]
    if not text:
        raise ServiceError(422, "Nothing to say.")
    voice = _load()
    from piper import SynthesisConfig

    config = SynthesisConfig(length_scale=1 / max(0.5, min(2.0, rate)))
    buf = io.BytesIO()
    with _lock, wave.open(buf, "wb") as out:
        voice.synthesize_wav(text, out, syn_config=config)
    return buf.getvalue()
