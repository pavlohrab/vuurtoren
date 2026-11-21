"""Add the side-by-side word pairs and the grammar hits to the bundled stories.

Usage (from server/nlp, with the translation model installed)::

    uv run python scripts/build_story_extras.py     # rewrite content/stories/stories.json

``check_stories.py --write`` runs this step itself; run it alone after a change to the pairing
code, the translation model or the grammar detectors. Each story's tokens are checked against a
fresh analysis first (the hits and pairs index them): a mismatch means the bundle is stale, run
``check_stories.py --write``. Layout and rules: :mod:`vuurtoren_nlp.story_extras`. The model is
the ``mt-nl-en`` pack (``scripts/fetch_mt_model.py``, or ``VUURTOREN_MT_DIR``).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT.parents[1] / "content" / "stories" / "stories.json"


def unpack_tokens(content: str, packed: list[list[Any]]) -> list[Any]:
    """The bundle's tokens as analyzer tokens (see ``check_stories.py`` for the layout)."""
    from vuurtoren_nlp.models import Token

    return [
        Token(
            i=i,
            text=content[start:end],
            lemma=lemma,
            alt_lemmas=alt,
            pos=pos,
            morph=morph,
            dep=dep,
            head=head,
            sent=sent,
            start=start,
            end=end,
            is_word=bool(flags & 1),
            is_propn=bool(flags & 2),
            is_num=bool(flags & 4),
            particle_of=particle_of,
            zipf=zipf,
        )
        for i, (lemma, alt, pos, morph, dep, head, sent, start, end, flags, particle_of, zipf) in (
            enumerate(packed)
        )
    ]


def add_extras(bundle: dict[str, Any], verify: bool = True) -> None:
    """Add ``pairs``/``grammar`` to every story of the bundle and the versions as ``extras``.

    Raises:
        SystemExit: when a story's tokens differ from a fresh analysis (``verify``).
        ServiceError: 503 when the translation model is not installed.
    """
    from vuurtoren_nlp.analyzer import analyzer_version
    from vuurtoren_nlp.pipeline import analyze_texts
    from vuurtoren_nlp.story_extras import extras_meta, story_extras

    stories = bundle["stories"]
    versions = {s["analyzerVersion"] for s in stories}
    if versions != {analyzer_version()}:
        raise SystemExit(
            f"the bundle was analysed with {sorted(versions)}, this analyzer is "
            f"{analyzer_version()}: run check_stories.py --write"
        )
    fresh = analyze_texts("nl", [s["content"] for s in stories]) if verify else None
    for k, story in enumerate(stories):
        tokens = unpack_tokens(story["content"], story["tokens"])
        if fresh is not None:
            now = [t.model_copy(update={"zipf": round(t.zipf, 2)}) for t in fresh[k].tokens]
            if now != tokens:
                raise SystemExit(f"{story['slug']}: the bundled analysis is stale: run --write")
        lines = [(int(a), int(b), str(en)) for a, b, en in story["sentences"]]
        for key in ("pairs", "pairsEnglish", "grammar"):
            story.pop(key, None)
        story.update(story_extras(story["content"], tokens, lines))
        print(f"{story['slug']}: {len(story['grammar'])} grammar hits")
    bundle["extras"] = extras_meta(analyzer_version())


def main() -> int:
    bundle = json.loads(BUNDLE.read_text(encoding="utf-8"))
    add_extras(bundle)
    write_bundle(bundle)
    print(f"wrote {BUNDLE.relative_to(ROOT.parents[1])}")
    return 0


def write_bundle(bundle: dict[str, Any]) -> None:
    BUNDLE.write_text(
        json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    sys.exit(main())
