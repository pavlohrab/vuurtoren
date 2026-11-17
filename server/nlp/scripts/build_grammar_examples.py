"""Precompute the grammar-example cache (optional; ``GET /grammar/examples`` also fills it lazily).

Usage (from server/nlp)::

    uv run python scripts/build_grammar_examples.py            # scan until every topic is full
    uv run python scripts/build_grammar_examples.py --max 20000

Scans the Tatoeba sentence DB with the grammar detectors and keeps the best examples per topic
in ``data/grammar-examples-nl.sqlite`` (see ``kenning_nlp.grammar_examples``). Resumes where an
earlier run stopped; the cache is rebuilt automatically when the detectors change.
"""

from __future__ import annotations

import argparse
import sys
import time

from kenning_nlp.grammar import TOPICS
from kenning_nlp.grammar_examples import MAX_PER_TOPIC, GrammarExamples
from kenning_nlp.sentences import default_db_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max", type=int, default=40_000, help="most sentences to scan")
    args = parser.parse_args()
    path = default_db_path()
    if not path.is_file():
        print(f"No sentence database at {path}; run scripts/build_sentences.py first.")
        return 1
    scanner = GrammarExamples(path)
    start = time.monotonic()
    scanned = 0
    while scanned < args.max:
        # One request per topic with a tiny budget advances the shared scan.
        counts = {t: len(scanner.examples(t, MAX_PER_TOPIC, budget_s=0.5)) for t in sorted(TOPICS)}
        scanned += 128
        if all(n >= MAX_PER_TOPIC for n in counts.values()):
            break
        print(f"{time.monotonic() - start:6.0f}s  min {min(counts.values())}/{MAX_PER_TOPIC}")
    for topic, n in counts.items():
        print(f"{topic:22} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
