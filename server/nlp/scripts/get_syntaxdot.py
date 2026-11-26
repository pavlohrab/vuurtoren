"""Put SyntaxDot (the sentence structure's parser) where the server looks for it.

    uv run python scripts/get_syntaxdot.py [target]

Downloads the CPU binary (v0.5.0, with its libtorch) and the distilled Dutch model
(nl-l6-h384-20210728) into ``target`` (default: ``<data dir>/syntaxdot``, see
vuurtoren_nlp.syntax), as ``bin/`` and ``nl/``. About 250 MB to download, 620 MB unpacked. SyntaxDot is built for
Linux on x86_64 only (no Windows, macOS or ARM): elsewhere the server keeps spaCy's parse.
Needs ``zstd`` on the PATH for the binary's archive.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from vuurtoren_nlp.syntax import syntaxdot_target  # noqa: E402
from vuurtoren_nlp.syntaxdot_get import install  # noqa: E402


def main() -> None:
    target = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else syntaxdot_target()
    print("downloading SyntaxDot …")
    install(target)
    print("SyntaxDot is in", target)


if __name__ == "__main__":
    main()
