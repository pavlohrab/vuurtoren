"""Spoken starter words and sentences: the ``audio-nl`` data pack.

Clips are made by ``scripts/tts_elevenlabs.py``; a clip's id comes from its text
(``word-<sha1[:16]>`` or ``sentence-<sha1[:16]>``, see :func:`clip_id`), so the app finds a clip
without a lookup table. The pack holds ``audio-nl/{female,male}/<id>.mp3`` and is optional: when
it is not published or not installed, every clip is simply missing (HTTP 404) and the app falls
back to the system voice.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from vuurtoren_nlp.datadir import data_path

VOICES = ("female", "male")
CLIP_RE = re.compile(r"^(word|sentence)-[0-9a-f]{16}$")


def clip_id(kind: str, text: str) -> str:
    """The id of the clip of ``text`` (``kind`` = "word" or "sentence"); a name, not security."""
    return f"{kind}-{hashlib.sha1(text.encode()).hexdigest()[:16]}"  # noqa: S324


def audio_dir() -> Path:
    """``$VUURTOREN_AUDIO_DIR`` or ``<data dir>/audio-nl``."""
    return data_path("VUURTOREN_AUDIO_DIR", "audio-nl")


def clip_path(voice: str, clip: str) -> Path | None:
    """The file of a clip, or None when the voice or id is unknown or the file is missing."""
    if voice not in VOICES or not CLIP_RE.match(clip):
        return None
    path = audio_dir() / voice / f"{clip}.mp3"
    return path if path.is_file() else None
