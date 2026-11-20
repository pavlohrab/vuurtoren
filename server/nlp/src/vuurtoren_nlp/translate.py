"""Offline Dutch -> English machine translation (OPUS-MT ``opus-mt-nl-en`` on CTranslate2).

The model is a data pack (``mt-nl-en``, see :mod:`vuurtoren_nlp.packs`): downloaded or built by
``scripts/fetch_mt_model.py`` into ``$VUURTOREN_DATA_DIR/mt-nl-en/`` (or ``$VUURTOREN_MT_DIR``). It
is loaded lazily on the first request and cached for the process lifetime.
Only ``ctranslate2`` and ``sentencepiece`` are needed (no torch).

:func:`align_texts` also returns the decoder attention, from which :mod:`vuurtoren_nlp.align` reads
the English of single words (their meaning in that sentence). :func:`pair_texts` reads the
word-to-word pairs of whole sentences off the same attention (:mod:`vuurtoren_nlp.pairs`), for the
model's own translation or for a given one (forced decoding).
"""

from __future__ import annotations

import json
import os
import re
import threading
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from wordfreq import zipf_frequency

from vuurtoren_nlp.align import DISAGREE_FACTOR, AttentionResult, agrees, align_word
from vuurtoren_nlp.datadir import data_path
from vuurtoren_nlp.errors import ServiceError
from vuurtoren_nlp.pairs import pair_sentence

SUPPORTED_PAIRS = {("nl", "en")}
MODEL_FILES = ("model.bin", "shared_vocabulary.json", "source.spm", "target.spm")
MAX_INPUT_TOKENS = 1024
MAX_OUTPUT_TOKENS = 512
BEAM_SIZE = 4
FETCH_HINT = (
    "The offline translation model (data pack mt-nl-en) is not installed yet. The server "
    "installs it at startup when VUURTOREN_PACKS is on (see GET /health); in development run "
    "`uv run python scripts/fetch_mt_model.py` in server/nlp (about 85 MB)."
)


class Translator(Protocol):
    """Anything that translates a batch of sentences (the real engine or a test double)."""

    def translate(self, texts: list[str]) -> list[str]: ...

    def translate_attention(self, texts: list[str]) -> list[AttentionResult]: ...

    def force_attention(self, texts: list[str], targets: list[str]) -> list[AttentionResult]: ...


def model_dir() -> Path:
    """Model location: ``$VUURTOREN_MT_DIR`` or ``server/nlp/data/mt-nl-en``."""
    return data_path("VUURTOREN_MT_DIR", "mt-nl-en")


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
        # Models converted with the Marian converter add </s> themselves (config.json); the older
        # Transformers conversion did not, so it is appended by hand for those.
        try:
            config = json.loads((path / "config.json").read_text())
        except (OSError, ValueError):
            config = {}
        self._eos = [] if config.get("add_source_eos") else ["</s>"]
        self._model: Any = ctranslate2.Translator(
            str(path),
            device="cpu",
            compute_type="int8",  # the pack is int8 already; older float32 models quantise at load
            inter_threads=1,
            intra_threads=intra_threads or min(4, os.cpu_count() or 1),
        )
        self._lock = threading.Lock()

    def translate(self, texts: list[str]) -> list[str]:
        """Translate each text; blank texts map to ``""`` without touching the model."""
        return [r.translation for r in self.translate_attention(texts)]

    def translate_attention(self, texts: list[str]) -> list[AttentionResult]:
        """Translate each text and keep the subwords and decoder attention of the best
        hypothesis (the translation is the same as without attention)."""
        todo = [i for i, t in enumerate(texts) if t.strip()]
        out = [AttentionResult("", [], [], []) for _ in texts]
        if not todo:
            return out
        sources = [self._src.encode(texts[i].strip(), out_type=str) for i in todo]
        batch = [[*src, *self._eos] for src in sources]
        with self._lock:
            results = self._model.translate_batch(
                batch,
                beam_size=BEAM_SIZE,
                max_input_length=MAX_INPUT_TOKENS,
                max_decoding_length=MAX_OUTPUT_TOKENS,
                batch_type="tokens",
                max_batch_size=4096,
                return_attention=True,
            )
        for i, src, res in zip(todo, sources, results, strict=True):
            target = res.hypotheses[0]
            attention = res.attention[0] if res.attention else []
            out[i] = AttentionResult(self._tgt.decode(target).strip(), src, target, attention)
        return out

    def force_attention(self, texts: list[str], targets: list[str]) -> list[AttentionResult]:
        """The decoder attention of the given English ``targets`` (forced decoding: the target is
        the decoder's prefix, so the model reads it instead of choosing its own words). The
        translation of each result is its target as given."""
        todo = [
            i
            for i, (s, t) in enumerate(zip(texts, targets, strict=True))
            if s.strip() and t.strip()
        ]
        out = [AttentionResult("", [], [], []) for _ in texts]
        if not todo:
            return out
        sources = [self._src.encode(texts[i].strip(), out_type=str) for i in todo]
        prefixes = [
            self._tgt.encode(targets[i].strip(), out_type=str)[:MAX_OUTPUT_TOKENS] for i in todo
        ]
        with self._lock:
            results = self._model.translate_batch(
                [[*src, *self._eos] for src in sources],
                target_prefix=prefixes,
                beam_size=1,
                max_input_length=MAX_INPUT_TOKENS,
                max_decoding_length=max(len(p) for p in prefixes) + 1,
                return_attention=True,
            )
        for i, src, prefix, res in zip(todo, sources, prefixes, results, strict=True):
            attention = res.attention[0][: len(prefix)] if res.attention else []
            out[i] = AttentionResult(targets[i].strip(), src, prefix, attention)
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
    translations = [
        clean_output(t) for t in get_engine().translate([clean_source(t) for t in texts])
    ]
    return [
        {"text": t, "translation": tr if plausible(t, tr) else ""}
        for t, tr in zip(texts, translations, strict=True)
    ]


_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?")


def plausible(source: str, translation: str) -> bool:
    """False for an output that is not a translation: Dutch again (the model sometimes
    "translates" an odd line into unrelated Dutch), or far longer than its source."""
    if not translation.strip():
        return False
    if len(translation) > 4 * len(source) + 40:
        return False
    sentences = [x.strip().lower() for x in re.split(r"(?<=[.!?])\s+", translation) if x.strip()]
    if len(sentences) > len(set(sentences)):
        return False
    src = {w.lower() for w in _WORD.findall(source)}
    new = [w.lower() for w in _WORD.findall(translation) if w.lower() not in src]
    if len(new) < 3:
        return True
    en = sum(zipf_frequency(w, "en") for w in new) / len(new)
    nl = sum(zipf_frequency(w, "nl") for w in new) / len(new)
    return nl <= en + 0.5


_LEADING_MARKS = re.compile(r"^[\s\-–—•·*]+")
_PAUSE_DASH = re.compile(r"(?<=\s)[–—](?=\s)")
_PADDING = re.compile(r"(?:\s+\.){3,}\s*$")


def clean_source(text: str) -> str:
    """What the model reads, with every character in place (alignment spans stay valid):
    leading dashes and bullets become spaces, and a dash used as a pause (" – ") a comma.
    A line that starts with a dash otherwise makes the model invent a sentence."""
    lead = _LEADING_MARKS.match(text)
    if lead:
        text = " " * lead.end() + text[lead.end() :]
    return _PAUSE_DASH.sub(",", text)


def clean_output(translation: str) -> str:
    """The model's output without the dot padding it sometimes adds (". . . . .")."""
    return _PADDING.sub(".", translation).strip()


_ALIGN_CACHE_SIZE = 256
_align_cache: OrderedDict[tuple[str, str | None], AttentionResult] = OrderedDict()
_align_lock = threading.Lock()


def _cached(
    keys: list[tuple[str, str | None]],
    compute: Callable[[list[tuple[str, str | None]]], list[AttentionResult]],
) -> list[AttentionResult]:
    """Attention results per ``(text, given English or None)``, from a small cache (the reader
    asks for the same sentences often)."""
    with _align_lock:
        found = {k: _align_cache[k] for k in keys if k in _align_cache}
    missing = [k for k in dict.fromkeys(keys) if k not in found]
    if missing:
        found.update(zip(missing, compute(missing), strict=True))
        with _align_lock:
            for k in missing:
                _align_cache[k] = found[k]
            while len(_align_cache) > _ALIGN_CACHE_SIZE:
                _align_cache.popitem(last=False)
    return [found[k] for k in keys]


def _attention(texts: list[str]) -> list[AttentionResult]:
    """The model's own translation of each text, with its attention (cached)."""
    return _cached(
        [(t, None) for t in texts],
        lambda keys: get_engine().translate_attention([t for t, _ in keys]),
    )


def _forced(items: list[tuple[str, str]]) -> list[AttentionResult]:
    """The attention of each given English translation of a text (cached)."""
    return _cached(
        [(t, en) for t, en in items],
        lambda keys: get_engine().force_attention(
            [t for t, _ in keys], [en or "" for _, en in keys]
        ),
    )


def align_texts(
    source: str, target: str, items: list[tuple[str, list[tuple[int, int]]]]
) -> list[dict[str, Any]]:
    """Translate each ``(text, spans)`` and give each character span its English.

    Returns ``[{"text", "translation", "words": [{"start", "end", "text", "confidence"}]}]``;
    a word's ``text`` is None when its alignment is unclear. The confidence is lowered when the
    word translated on its own disagrees (see :mod:`vuurtoren_nlp.align`).

    Raises:
        ServiceError: 422 for an unsupported pair, 503 if the model is not installed.
    """
    if (source, target) not in SUPPORTED_PAIRS:
        raise ServiceError(422, f"Unsupported language pair {source}->{target} (only nl->en).")
    words = [text[a:b].strip() for text, spans in items for a, b in spans]
    results = _attention([clean_source(text) for text, _ in items] + words)
    alone = iter(r.translation for r in results[len(items) :])
    out: list[dict[str, Any]] = []
    for (text, spans), res in zip(items, results[: len(items)], strict=True):
        found_words = []
        translation = clean_output(res.translation)
        ok = plausible(text, translation)
        for start, end in spans:
            found = align_word(res, clean_source(text), start, end) if res.target and ok else None
            own = next(alone)
            confidence = 0.0
            if found:
                factor = 1.0 if agrees(found.text, own) else DISAGREE_FACTOR
                confidence = round(found.confidence * factor, 3)
            found_words.append(
                {
                    "start": start,
                    "end": end,
                    "text": found.text if found else None,
                    "confidence": confidence,
                }
            )
        out.append({"text": text, "translation": translation if ok else "", "words": found_words})
    return out


def pair_texts(
    source: str,
    target: str,
    items: list[tuple[str, list[tuple[int, int]], list[tuple[int, int]], str | None]],
) -> list[dict[str, Any]]:
    """Translate each ``(text, spans, joins, given English)`` and pair its words with the
    English words (see :mod:`vuurtoren_nlp.pairs`).

    Without a given English the model translates the sentence itself; with one, the pairs come
    from the model reading that English (forced decoding). A translation that fails
    :func:`plausible` is dropped: no English, no pairs.

    Raises:
        ServiceError: 422 for an unsupported pair, 503 if the model is not installed.
    """
    if (source, target) not in SUPPORTED_PAIRS:
        raise ServiceError(422, f"Unsupported language pair {source}->{target} (only nl->en).")
    own = [i for i, it in enumerate(items) if not (it[3] or "").strip()]
    given = [i for i, it in enumerate(items) if (it[3] or "").strip()]
    results: dict[int, AttentionResult] = {}
    results.update(zip(own, _attention([clean_source(items[i][0]) for i in own]), strict=True))
    forced = _forced([(clean_source(items[i][0]), (items[i][3] or "").strip()) for i in given])
    results.update(zip(given, forced, strict=True))
    out: list[dict[str, Any]] = []
    for k, (text, spans, joins, english) in enumerate(items):
        res = results[k]
        translation = clean_output(res.translation)
        ok = bool(res.target) and plausible(text, translation)
        paired = pair_sentence(res, clean_source(text), translation if ok else "", spans, joins)
        out.append(
            {
                "text": text,
                "translation": translation if ok else "",
                "source": "given" if (english or "").strip() else "mt",
                **paired,
            }
        )
    return out


def reset_engine() -> None:
    """Forget the loaded model (after a new ``mt-nl-en`` pack was installed)."""
    global _engine
    with _engine_lock:
        _engine = None
    with _align_lock:
        _align_cache.clear()
