"""Check the graded stories in ``content/stories`` and write the app's bundle.

Usage (from server/nlp)::

    uv run python scripts/check_stories.py              # check every story
    uv run python scripts/check_stories.py klaas-vaak   # only stories whose slug contains this
    uv run python scripts/check_stories.py --set-words  # also write each story's word count
    uv run python scripts/check_stories.py --write      # check, then write the app bundle

``--write`` also adds each sentence's word pairs and the grammar hits (``build_story_extras.py``),
so it needs the translation model.

Each story is analysed with the app's spaCy pipeline. The report gives per story: running
words (and whether they fit the level's length), coverage against the starter list within the
level's limit (names and numbers excepted), the lemmas outside it, the number of Dutch
sentences against English lines, where spaCy splits the text differently from the lines (the
reader's side by side pairs English with spaCy's sentences) and sentences that are long for the
level. The exit code is 1 when a story misses a target. Rules: :mod:`vuurtoren_nlp.stories`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from build_story_extras import add_extras, write_bundle

from vuurtoren_nlp.stories import (
    KINDS,
    LEVELS,
    Story,
    count_words,
    line_starts,
    parse_story,
    sentence_starts,
    sentence_words,
    story_content,
)

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
STORIES = REPO / "content" / "stories"
LIST = REPO / "content" / "starter" / "nl-5000.json"
OUT = STORIES / "stories.json"


def load_ranks() -> dict[str, int]:
    words = json.loads(LIST.read_text(encoding="utf-8"))["words"]
    ranks: dict[str, int] = {}
    for w in words:
        ranks.setdefault(w["word"].lower(), int(w["rank"]))
    return ranks


def story_files(match: str | None) -> list[Path]:
    files = sorted(STORIES.glob("*/*.md"))
    files = [f for f in files if f.parent.name in LEVELS]
    return [f for f in files if not match or match in f.stem]


def set_words(path: Path, words: int) -> None:
    """Write the counted words into the story's front matter."""
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"(?m)^words:.*$", f"words: {words}", text, count=1)
    path.write_text(text, encoding="utf-8")


def check(
    path: Path, ranks: dict[str, int], fix_words: bool = False
) -> tuple[bool, dict[str, object] | None]:
    from vuurtoren_nlp.analyzer import analyzer_version
    from vuurtoren_nlp.pipeline import analyze_texts

    story: Story = parse_story(path.read_text(encoding="utf-8"))
    rel = path.relative_to(REPO)
    problems = list(story.problems)
    level = LEVELS.get(story.meta.get("level", ""))
    if story.meta.get("level") != path.parent.name:
        problems.append(f"level {story.meta.get('level')!r} but the file is in {path.parent.name}/")
    if level is None:
        print(f"{rel}: FAIL\n  " + "\n  ".join(problems))
        return False, None
    content, spans = story_content(story)
    tokens = analyze_texts("nl", [content])[0].tokens
    counts = count_words(tokens, ranks, level.rank, story.names)

    if not level.min_words <= counts.words <= level.max_words:
        problems.append(
            f"{counts.words} words, the level wants {level.min_words}-{level.max_words}"
        )
    if fix_words and str(counts.words) != story.meta.get("words"):
        set_words(path, counts.words)
    elif str(counts.words) != story.meta.get("words"):
        problems.append(
            f"front matter says {story.meta.get('words')} words, the text has {counts.words}"
        )
    if counts.coverage < level.share:
        problems.append(
            f"coverage {counts.coverage:.1%} within {level.rank}, the level wants {level.share:.0%}"
        )

    # spaCy's sentences against the lines: side by side gives each line's English to the spaCy
    # sentence holding the line's first word, so every line must start a spaCy sentence and no
    # spaCy sentence may start inside a line (word-wise: a stray quote does not matter).
    first_words = sentence_starts(tokens)
    line_firsts = line_starts(tokens, spans)
    for (a, b), first in zip(spans, line_firsts, strict=True):
        inside = sorted(s for s in first_words if a < s < b and s != first)
        if inside:
            problems.append(f"spaCy splits {content[a:b]!r} at {content[inside[0] : b]!r}")
        if first is None:
            problems.append(f"{content[a:b]!r} has no words of its own")
        elif first not in first_words:
            problems.append(f"spaCy joins {content[a:b]!r} to the sentence before it")
    english = len(story.sentences)
    if len(first_words) != english:
        problems.append(f"{len(first_words)} spaCy sentences, {english} English lines")

    long_ones = []
    if level.max_sentence is not None:
        for (a, b), n in zip(spans, sentence_words(tokens, spans), strict=True):
            if n > level.max_sentence:
                long_ones.append(f"{n} words: {content[a:b]}")

    ok = not problems and not long_ones
    print(
        f"{rel}: {'ok' if ok else 'FAIL'} - {counts.words} words, "
        f"{counts.coverage:.1%} within {level.rank} ({counts.within}/{counts.counted}), "
        f"{english} sentences"
    )
    for p in problems:
        print(f"  {p}")
    for s in long_ones:
        print(f"  long ({level.max_sentence} max): {s}")
    if counts.outside:
        out = ", ".join(
            f"{w}" + (f" x{n}" if n > 1 else "") for w, n in counts.outside.most_common()
        )
        print(f"  outside {level.rank}: {out}")

    entry: dict[str, object] = {
        "slug": path.stem,
        **{k: story.meta[k] for k in ("title", "level", "summary", "kind", "licence", "review")},
        "words": counts.words,
        **({"credit": story.meta["credit"]} if story.meta.get("credit") else {}),
        "content": content,
        "sentences": [[a, b, s.en] for (a, b), s in zip(spans, story.sentences, strict=True)],
        "analyzerVersion": analyzer_version(),
        # One array per token, in AnalyzedToken order without i and text (index, content slice):
        # lemma, alt_lemmas, pos, morph, dep, head, sent, start, end, flags, particle_of, zipf,
        # syn; flags: 1 is_word, 2 is_propn, 4 is_num, 8 unlisted; syn: SyntaxDot's pos, morph,
        # dep, head, lemma, particle_of (left out without SyntaxDot).
        "tokens": [
            [
                t.lemma,
                t.alt_lemmas,
                t.pos,
                t.morph,
                t.dep,
                t.head,
                t.sent,
                t.start,
                t.end,
                int(t.is_word) | int(t.is_propn) << 1 | int(t.is_num) << 2 | int(t.unlisted) << 3,
                t.particle_of,
                round(t.zipf, 2),
                *(
                    [
                        [
                            t.syn.pos,
                            t.syn.morph,
                            t.syn.dep,
                            t.syn.head,
                            t.syn.lemma,
                            t.syn.particle_of,
                        ]
                    ]
                    if t.syn
                    else []
                ),
            ]
            for t in tokens
        ],
    }
    return ok, entry


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("match", nargs="?", help="only stories whose slug contains this")
    ap.add_argument("--write", action="store_true", help=f"write {OUT.relative_to(REPO)}")
    ap.add_argument("--set-words", action="store_true", help="write the word count into each story")
    args = ap.parse_args()
    ranks = load_ranks()
    files = story_files(args.match)
    if not files:
        print("no stories found", file=sys.stderr)
        return 1
    results = [check(f, ranks, args.set_words) for f in files]
    failed = sum(not ok for ok, _ in results)
    print(f"{len(files) - failed}/{len(files)} stories meet their targets")
    if args.write:
        if args.match:
            print("--write needs every story: leave out the slug", file=sys.stderr)
            return 1
        entries = [e for _, e in results if e is not None]
        order = {k: n for n, k in enumerate(KINDS)}
        entries.sort(key=lambda e: (str(e["level"]), order.get(str(e["kind"]), 9)))
        bundle = {
            "description": "Graded Dutch stories, by Vuurtoren (content/stories/README.md)",
            "licence": "CC BY-SA 4.0",
            "stories": entries,
        }
        add_extras(bundle, verify=False)  # just analysed
        write_bundle(bundle)
        print(f"wrote {OUT.relative_to(REPO)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
