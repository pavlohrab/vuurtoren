"""What ``GET /health`` reports besides "ok": the version and which data files are present.

Self-hosters see this in Settings > Advanced > Server status and in ``scripts/doctor.sh``, so a
missing dictionary or model shows up as one clear line instead of failing requests later.
Only cheap existence checks: nothing is opened or loaded here.
"""

from __future__ import annotations

from kenning_nlp import __version__
from kenning_nlp.dictionary import default_db_path as dictionary_path
from kenning_nlp.grammar_examples import default_cache_path as grammar_examples_path
from kenning_nlp.sentences import default_db_path as sentences_path
from kenning_nlp.translate import model_dir


def health_report() -> dict[str, object]:
    return {
        "status": "ok",
        "version": __version__,
        "data": {
            "dictionary": dictionary_path().is_file(),
            "sentences": sentences_path().is_file(),
            "translation": model_dir().is_dir(),
            "grammarExamples": grammar_examples_path().is_file(),
        },
    }
