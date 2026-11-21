"""Apply content/starter/review.json to content/starter/nl-5000.json.

Run after build_starter.py. Entries marked "remove" or "not_useful" are dropped and the rest
renumbered; fixed fields replace the built ones. A sentence from the review is the project's own
(CC BY-SA, like the rest of content/), so its Tatoeba id is cleared.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LIST = ROOT / "content" / "starter" / "nl-5000.json"
REVIEW = ROOT / "content" / "starter" / "review.json"
DROP = {"remove", "not_useful"}


def mark_of(sentence: str, form: str | None, lemma: str) -> list[int] | None:
    """Where the word stands in the sentence, as a whole word: the reviewed form, else the
    lemma ("om" in "Ik kom om acht uur." is the second "om", not the one inside "kom")."""
    for needle in (form, lemma):
        if needle:
            m = re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", sentence, re.IGNORECASE)
            if m:
                return [m.start(), m.end()]
    return None


def repair_marks(words: list[dict]) -> int:
    """Move every mark that does not cover a whole word onto the word itself; count the moves."""
    moved = 0
    for w in words:
        s, m = w.get("sentence"), w.get("mark")
        if not s or not m:
            continue
        a, b = m
        whole = (a == 0 or not s[a - 1].isalnum()) and (b >= len(s) or not s[b].isalnum())
        if not whole:
            w["mark"] = (
                mark_of(s, s[a:b], w["word"]) if s[a:b].strip() else mark_of(s, None, w["word"])
            )
            moved += 1
    return moved


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
    moved = repair_marks(data["words"])
    data["reviewed"] = True
    LIST.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    words = len(data["words"])
    print(f"{before} → {words} words; {len(review)} reviews applied; {moved} marks moved")


if __name__ == "__main__":
    main()
