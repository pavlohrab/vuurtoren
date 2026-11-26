"""Fetch Whisper base for sherpa-onnx (int8): the asr-nl pack, for the speaking exercise.

Usage (from server/nlp)::

    uv run python scripts/fetch_asr_model.py --output data/asr-nl
"""

from __future__ import annotations

import argparse
import io
import tarfile
import urllib.request
from pathlib import Path

URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2"
KEEP = ("base-encoder.int8.onnx", "base-decoder.int8.onnx", "base-tokens.txt")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, required=True)
    out = p.parse_args().output
    out.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": "vuurtoren"})
    with urllib.request.urlopen(req, timeout=600) as r:
        data = r.read()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:bz2") as tar:
        for m in tar.getmembers():
            name = Path(m.name).name
            if name in KEEP and m.isfile():
                f = tar.extractfile(m)
                assert f is not None
                (out / name).write_bytes(f.read())
                print(f"{name}: {(out / name).stat().st_size} bytes")


if __name__ == "__main__":
    main()
