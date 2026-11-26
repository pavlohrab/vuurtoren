"""Speech to text for the speaking exercise: Whisper base (sherpa-onnx), offline.

The learner says a Dutch sentence, the app sends the recording here and gets back what was heard,
and the app compares it with the sentence. The model is the ``asr-nl`` pack (Whisper base, int8,
about 160 MB), in ``$VUURTOREN_ASR_DIR`` or ``<data>/asr-nl``. It loads on first use and hears a
short sentence in about 0.3 s. Whisper base still mishears some fast Dutch, so the app grades
leniently and the learner has the last word.
"""

from __future__ import annotations

import io
import threading
import wave
from pathlib import Path

from vuurtoren_nlp.datadir import data_path
from vuurtoren_nlp.errors import ServiceError

SILENCE = 0.02
"""Below this peak level (of 1.0) a recording counts as silence."""

MAX_SECONDS = 20
"""A sentence, not a speech: longer recordings are refused."""


def asr_dir() -> Path:
    """Model location: ``$VUURTOREN_ASR_DIR`` or ``<data>/asr-nl``."""
    return data_path("VUURTOREN_ASR_DIR", "asr-nl")


def _files() -> tuple[Path, Path, Path] | None:
    d = asr_dir()
    enc = next(iter(sorted(d.glob("*encoder.int8.onnx"))), None) if d.is_dir() else None
    dec = next(iter(sorted(d.glob("*decoder.int8.onnx"))), None) if d.is_dir() else None
    tok = next(iter(sorted(d.glob("*tokens.txt"))), None) if d.is_dir() else None
    return (enc, dec, tok) if enc and dec and tok else None


def available() -> bool:
    """sherpa-onnx is installed and the model is there."""
    try:
        import sherpa_onnx  # noqa: F401
    except ImportError:
        return False
    return _files() is not None


_rec = None
_lock = threading.Lock()


def _recognizer():  # noqa: ANN202 (sherpa_onnx is optional at import time)
    global _rec
    if _rec is None:
        with _lock:
            if _rec is None:
                files = _files()
                if files is None:
                    raise ServiceError(503, "Speech recognition (asr-nl) is not installed.")
                try:
                    import sherpa_onnx
                except ImportError as e:
                    raise ServiceError(503, "Speech recognition is not installed.") from e
                enc, dec, tok = files
                _rec = sherpa_onnx.OfflineRecognizer.from_whisper(
                    encoder=str(enc),
                    decoder=str(dec),
                    tokens=str(tok),
                    language="nl",
                    task="transcribe",
                    num_threads=2,
                )
    return _rec


def transcribe(wav: bytes) -> str:
    """What was said in a WAV recording (16-bit PCM, mono or stereo, any rate)."""
    import numpy as np

    try:
        with wave.open(io.BytesIO(wav)) as w:
            if w.getsampwidth() != 2:
                raise ServiceError(400, "Send 16-bit PCM WAV.")
            rate, channels, n = w.getframerate(), w.getnchannels(), w.getnframes()
            if n / max(rate, 1) > MAX_SECONDS:
                raise ServiceError(413, f"Say one sentence (at most {MAX_SECONDS} seconds).")
            frames = w.readframes(n)
    except (wave.Error, EOFError) as e:
        raise ServiceError(400, "That isn't a WAV recording.") from e
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    # Whisper makes words up from silence: nothing said, nothing heard.
    if audio.size == 0 or float(np.abs(audio).max()) < SILENCE:
        return ""
    rec = _recognizer()
    stream = rec.create_stream()
    # Whisper's default token limit cuts short sentences off.
    stream.set_option("max_tokens_per_second", "20")
    stream.accept_waveform(rate, audio)
    rec.decode_stream(stream)
    return stream.result.text.strip()
