"""Put SyntaxDot (the sentence structure's parser) where the server looks for it.

    uv run python scripts/get_syntaxdot.py [target]

Downloads the CPU binary (v0.5.0, with its libtorch) and the distilled Dutch model
(nl-l6-h384-20210728) into ``target`` (default: ``<data dir>/syntaxdot``, see
vuurtoren_nlp.syntax), as ``bin/`` and ``nl/``. About 850 MB unpacked; Linux x86_64 only.
Needs ``zstd`` on the PATH for the binary's archive.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from vuurtoren_nlp.syntax import syntaxdot_target  # noqa: E402

BINARY = (
    "https://github.com/tensordot/syntaxdot/releases/download/v0.5.0/"
    "syntaxdot-v0.5.0-cpu-x86_64-linux-gnu-gcc.tar.zst"
)
MODEL = (
    "https://github.com/tensordot/syntaxdot-models/releases/download/"
    "nl-l6-h384-20210728/nl-l6-h384-20210728.tar.gz"
)


def main() -> None:
    target = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else syntaxdot_target()
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        print("downloading the binary …")
        urllib.request.urlretrieve(BINARY, t / "bin.tar.zst")
        subprocess.run(["zstd", "-d", str(t / "bin.tar.zst"), "-o", str(t / "bin.tar")], check=True)
        with tarfile.open(t / "bin.tar") as tar:
            tar.extractall(t / "bin", filter="data")
        print("downloading the Dutch model …")
        urllib.request.urlretrieve(MODEL, t / "nl.tar.gz")
        with tarfile.open(t / "nl.tar.gz") as tar:
            tar.extractall(t / "nl", filter="data")
        for name in ("bin", "nl"):
            inner = [p for p in (t / name).iterdir() if p.is_dir()]
            src = inner[0] if len(inner) == 1 else t / name
            if (target / name).exists():
                shutil.rmtree(target / name)
            shutil.move(str(src), str(target / name))
    (target / "bin" / "syntaxdot").chmod(0o755)
    print("SyntaxDot is in", target)


if __name__ == "__main__":
    main()
