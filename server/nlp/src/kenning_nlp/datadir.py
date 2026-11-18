"""Where the data packs live: ``$KENNING_DATA_DIR`` or ``server/nlp/data`` (development).

Each data file can still be pointed elsewhere with its own variable (``KENNING_DICT_PATH``,
``KENNING_SENTENCES_PATH``, ``KENNING_MT_DIR``, ``KENNING_GRAMMAR_CACHE_PATH``); see
:mod:`kenning_nlp.packs` for how the files get there.
"""

from __future__ import annotations

import os
from pathlib import Path


def data_dir() -> Path:
    env = os.environ.get("KENNING_DATA_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "data"


def data_path(env_var: str, name: str) -> Path:
    """``$env_var`` if set, else ``data_dir() / name``."""
    env = os.environ.get(env_var)
    return Path(env) if env else data_dir() / name
