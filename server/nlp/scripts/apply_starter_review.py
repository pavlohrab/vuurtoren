"""Apply content/starter/review.json to content/starter/nl-5000.json.

Run after build_starter.py. Entries marked "remove" or "not_useful" are dropped and the rest
renumbered; fixed fields replace the built ones. A sentence from the review is the project's own
(CC BY-SA, like the rest of content/), so its Tatoeba id is cleared.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LIST = ROOT / "content" / "starter" / "nl-5000.json"
REVIEW = ROOT / "content" / "starter" / "review.json"
DROP = {"remove", "not_useful"}


def mark_of(sentence: str, form: str | None, lemma: str) -> list[int] | None:
    """Where the word stands in the sentence: the reviewed form, else the lemma."""
    low = sentence.lower()
    for needle in (form, lemma):
        if needle:
            i = low.find(needle.lower())
            if i >= 0:
                return [i, i + len(needle)]
    return None


def apply(words: list[dict], review: dict[str, dict]) -> list[dict]:
    out = []
    for w in words:
        r = review.get(w["word"])
        if r and r["verdict"] in DROP:
            continue
        if r:
            fix = r["fix"]
            for key, field in (("gloss", "gloss"), ("translation", "translation"), ("pos", "pos")):
                if fix.get(key):
                    w[field] = fix[key]
            if "article" in fix:
                w["article"] = fix["article"] or None
            if fix.get("lemma"):
                w["word"] = fix["lemma"]
            if fix.get("sentence"):
                w["sentence"] = fix["sentence"]
                w["tatoeba"] = None
            if w.get("sentence") and (fix.get("sentence") or fix.get("word_in_sentence")):
                w["mark"] = mark_of(w["sentence"], fix.get("word_in_sentence"), w["word"])
        out.append(w)
    for i, w in enumerate(out, 1):
        w["rank"] = i
    return out


def main() -> None:
    data = json.loads(LIST.read_text())
    review = json.loads(REVIEW.read_text())["entries"]
    before = len(data["words"])
    data["words"] = apply(data["words"], review)
    data["reviewed"] = True
    LIST.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    print(f"{before} → {len(data['words'])} words; {len(review)} reviewed entries applied")


if __name__ == "__main__":
    main()
