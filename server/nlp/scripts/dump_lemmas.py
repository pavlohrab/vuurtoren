"""Dump primary lemmas (and alternatives) per token for sentences, to diff before/after a change.

Usage::

    uv run python scripts/dump_lemmas.py sentences.txt > before.json
    # ... change the pipeline ...
    uv run python scripts/dump_lemmas.py sentences.txt > after.json
    uv run python scripts/dump_lemmas.py --diff before.json after.json

``sentences.txt`` has one sentence per line. Not part of the service.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def dump(path: Path) -> dict[str, list[list[object]]]:
    from vuurtoren_nlp.pipeline import analyze_texts

    sentences = [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    out: dict[str, list[list[object]]] = {}
    for s, a in zip(sentences, analyze_texts("nl", sentences), strict=True):
        out[s] = [[t.text, t.lemma, t.alt_lemmas] for t in a.tokens if t.is_word]
    return out


def diff(before: Path, after: Path) -> int:
    b, a = json.loads(before.read_text()), json.loads(after.read_text())
    n = 0
    for sent, toks in b.items():
        for old, new in zip(toks, a.get(sent, []), strict=False):
            if old[1] != new[1]:
                n += 1
                print(f"{sent!r}: {old[0]}: {old[1]} -> {new[1]}")
    print(f"{n} primary-lemma changes", file=sys.stderr)
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--diff":
        raise SystemExit(diff(Path(sys.argv[2]), Path(sys.argv[3])))
    json.dump(dump(Path(sys.argv[1])), sys.stdout, ensure_ascii=False, indent=1)
