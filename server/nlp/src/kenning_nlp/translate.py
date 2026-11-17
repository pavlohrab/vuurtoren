"""Offline Dutch -> English machine translation (OPUS-MT ``opus-mt-nl-en`` on CTranslate2).

The model is not part of the repository: ``scripts/fetch_mt_model.py`` downloads it into
``data/mt-nl-en/`` (or ``$KENNING_MT_DIR``). It is loaded lazily on the first request and cached
for the process lifetime. Only ``ctranslate2`` and ``sentencepiece`` are needed (no torch).

TODO(weave reading): keeping marked Dutch spans verbatim needs word alignment (SimAlign or the
CT2 ``return_alignment`` attention output); plain MT cannot guarantee it. See
docs/research/06-weave-reading.md.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Protocol

from kenning_nlp.errors import ServiceError

SUPPORTED_PAIRS = {("nl", "en")}
MODEL_FILES = ("model.bin", "shared_vocabulary.json", "source.spm", "target.spm")
MAX_INPUT_TOKENS = 1024
MAX_OUTPUT_TOKENS = 512
BEAM_SIZE = 4
FETCH_HINT = (
    "The offline translation model is not installed. Run "
    "`uv run python scripts/fetch_mt_model.py` in server/nlp (about 160 MB), or set "
    "KENNING_MT_DIR to a CTranslate2 opus-mt-nl-en directory. The Docker image includes it."
)


class Translator(Protocol):
    """Anything that translates a batch of sentences (the real engine or a test double)."""

    def translate(self, texts: list[str]) -> list[str]: ...


def model_dir() -> Path:
    """Model location: ``$KENNING_MT_DIR`` or ``server/nlp/data/mt-nl-en``."""
    env = os.environ.get("KENNING_MT_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "data" / "mt-nl-en"


class MtEngine:
    """CTranslate2 + SentencePiece translator for one language pair.

    Thread-safe: a lock serialises batches so concurrent requests do not oversubscribe the CPU
    (CTranslate2 already parallelises one batch over ``intra_threads``).

    Raises:
        FileNotFoundError: from the constructor if model files are missing.
    """

    def __init__(self, path: Path, intra_threads: int | None = None) -> None:
        import ctranslate2
        import sentencepiece

        missing = [f for f in MODEL_FILES if not (path / f).is_file()]
        if missing:
            raise FileNotFoundError(f"missing model files in {path}: {', '.join(missing)}")
        self._src = sentencepiece.SentencePieceProcessor(model_file=str(path / "source.spm"))
        self._tgt = sentencepiece.SentencePieceProcessor(model_file=str(path / "target.spm"))
        self._model: Any = ctranslate2.Translator(
            str(path),
            device="cpu",
            compute_type="int8",  # quantise the float32 weights at load: ~2x faster, same quality
            inter_threads=1,
            intra_threads=intra_threads or min(4, os.cpu_count() or 1),
        )
        self._lock = threading.Lock()

    def translate(self, texts: list[str]) -> list[str]:
        """Translate each text; blank texts map to ``""`` without touching the model."""
        todo = [i for i, t in enumerate(texts) if t.strip()]
        out = [""] * len(texts)
        if not todo:
            return out
        # Marian expects an explicit </s> at the end of the source (not added by the config).
        batch = [[*self._src.encode(texts[i].strip(), out_type=str), "</s>"] for i in todo]
        with self._lock:
            results = self._model.translate_batch(
                batch,
                beam_size=BEAM_SIZE,
                max_input_length=MAX_INPUT_TOKENS,
                max_decoding_length=MAX_OUTPUT_TOKENS,
                batch_type="tokens",
                max_batch_size=4096,
            )
        for i, res in zip(todo, results, strict=True):
            out[i] = self._tgt.decode(res.hypotheses[0]).strip()
        return out


_engine: MtEngine | None = None
_engine_lock = threading.Lock()


def get_engine() -> Translator:
    """Return the cached engine, loading it on first use.

    Raises:
        ServiceError: 503 with fetch guidance if the model files are missing.
    """
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                try:
                    _engine = MtEngine(model_dir())
                except FileNotFoundError as e:
                    raise ServiceError(503, f"{FETCH_HINT} ({e})") from e
    return _engine


def translate_texts(source: str, target: str, texts: list[str]) -> list[dict[str, str]]:
    """Translate ``texts`` and return ``[{"text", "translation"}]`` in input order.

    Raises:
        ServiceError: 422 for an unsupported pair, 503 if the model is not installed.
    """
    if (source, target) not in SUPPORTED_PAIRS:
        raise ServiceError(422, f"Unsupported language pair {source}->{target} (only nl->en).")
    translations = get_engine().translate(texts)
    return [{"text": t, "translation": tr} for t, tr in zip(texts, translations, strict=True)]
