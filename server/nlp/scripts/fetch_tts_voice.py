"""Fetch the Dutch Piper voice (nl_NL-alex-medium, trained on CC0 data): the tts-nl pack.

Usage (from server/nlp)::

    uv run python scripts/fetch_tts_voice.py --output data/tts-nl
"""

from __future__ import annotations

import argparse
import urllib.request
from pathlib import Path

BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/nl/nl_NL/alex/medium"
FILES = ("nl_NL-alex-medium.onnx", "nl_NL-alex-medium.onnx.json", "MODEL_CARD")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, required=True)
    out = p.parse_args().output
    out.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        req = urllib.request.Request(f"{BASE}/{name}", headers={"User-Agent": "vuurtoren"})
        with urllib.request.urlopen(req, timeout=120) as r:
            (out / name).write_bytes(r.read())
        print(f"{name}: {(out / name).stat().st_size} bytes")


if __name__ == "__main__":
    main()
