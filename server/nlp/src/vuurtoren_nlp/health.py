"""What ``GET /health`` reports besides "ok": versions, data presence and the data packs.

Self-hosters see this in Settings > Advanced > Server status and in ``scripts/doctor.sh``, so a
missing dictionary or model shows up as one clear line instead of failing requests later.
Only cheap checks: no model is loaded here.
"""

from __future__ import annotations

from vuurtoren_nlp import __version__, packs
from vuurtoren_nlp.analyzer import analyzer_version
from vuurtoren_nlp.dictionary import default_db_path as dictionary_path
from vuurtoren_nlp.grammar_examples import default_cache_path as grammar_examples_path
from vuurtoren_nlp.ocr import ocr_engine_name
from vuurtoren_nlp.sentences import default_db_path as sentences_path
from vuurtoren_nlp.speech import available as speech_available
from vuurtoren_nlp.translate import model_dir


def health_report() -> dict[str, object]:
    return {
        "status": "ok",
        "version": __version__,
        "analyzerVersion": analyzer_version(),
        "data": {
            "dictionary": dictionary_path().is_file(),
            "sentences": sentences_path().is_file(),
            "translation": model_dir().is_dir(),
            "grammarExamples": grammar_examples_path().is_file(),
            # A Dutch voice for words without a recording (Piper + the tts-nl pack).
            "speech": speech_available(),
        },
        "ocr": ocr_engine_name() is not None,
        "ocrEngine": ocr_engine_name(),
        "packs": {"mode": packs.mode(), "busy": packs.busy(), "items": packs.status()},
    }
