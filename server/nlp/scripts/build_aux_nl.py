"""Build ``src/vuurtoren_nlp/aux-nl.tsv.gz``: heb or ben (hebben / zijn / both) per Dutch verb.

Source: the Dutch Wiktionary's conjugation tables (template ``-nlverb-``, usually on the page
``<verb>/vervoeging``), from a pinned dump. The English Wiktionary (Kaikki, our dictionary)
records the auxiliary for only a few hundred verbs; the Dutch one has it for thousands. Licence:
CC BY-SA 4.0, like Kaikki (DATA_LICENSES.md).

Usage (from server/nlp)::

    uv run python scripts/build_aux_nl.py              # download the pinned dump, write the list
    uv run python scripts/build_aux_nl.py --dump FILE  # use a dump already downloaded
"""

from __future__ import annotations

import argparse
import bz2
import gzip
import hashlib
import re
import sys
import tempfile
import urllib.request
from pathlib import Path
from xml.etree.ElementTree import iterparse

DUMP = "nlwiktionary-20261101-pages-articles.xml.bz2"
DUMP_URL = f"https://dumps.wikimedia.org/nlwiktionary/20261101/{DUMP}"
DUMP_SHA1 = "241d41c6f8fa8d8da367c4516bd65512d25503ce"
OUT = Path(__file__).resolve().parents[1] / "src" / "vuurtoren_nlp" / "aux-nl.tsv.gz"

_AUX = {"hebben": "hebben", "heeft": "hebben", "zijn": "zijn", "is": "zijn"}


def _params(body: str) -> list[str]:
    """Top-level ``|`` parameters of a template body (nested ``{{…}}`` and ``[[…]]`` kept whole)."""
    out, depth, cur = [], 0, []
    i = 0
    while i < len(body):
        two = body[i : i + 2]
        if two in ("{{", "[["):
            depth += 1
            cur.append(two)
            i += 2
            continue
        if two in ("}}", "]]"):
            depth -= 1
            cur.append(two)
            i += 2
            continue
        if body[i] == "|" and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(body[i])
        i += 1
    out.append("".join(cur))
    return out


def _clean(value: str) -> str:
    v = re.sub(r"<ref[^>]*>.*?</ref>|<ref[^>]*/>", "", value, flags=re.S)
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v)
    return v.strip().lower()


def aux_of(template: str) -> str | None:
    """hebben / zijn / both from one ``{{-nlverb-|…}}`` (its body, without the braces)."""
    for p in _params(template)[1:]:
        if "=" in p.split("{{", 1)[0]:
            continue  # a named parameter (prefix=aan)
        if p.strip().startswith("{{hebben-zijn") or p.strip().startswith("{{zijn-hebben"):
            return "both"
        words = [w for w in re.split(r"[/,]|\s+of\s+", _clean(p)) if w.strip()]
        found = {_AUX.get(w.strip()) for w in words}
        if words and None not in found:
            return "both" if len(found) == 2 else found.pop()
    return None


def _template_bodies(text: str) -> list[str]:
    """Bodies of every ``{{-nlverb-…}}`` in a page, braces matched."""
    out = []
    for m in re.finditer(r"\{\{-nlverb-", text):
        depth, i = 0, m.start()
        while i < len(text):
            if text.startswith("{{", i):
                depth += 1
                i += 2
            elif text.startswith("}}", i):
                depth -= 1
                i += 2
                if depth == 0:
                    out.append(text[m.start() + 2 : i - 2])
                    break
            else:
                i += 1
    return out


def read_dump(path: Path) -> dict[str, str]:
    """Verb → hebben / zijn / both, from every page with a ``-nlverb-`` table."""
    out: dict[str, str] = {}
    title = ""
    with bz2.open(path) as fh:
        for _, el in iterparse(fh):
            tag = el.tag.rsplit("}", 1)[-1]
            if tag == "title":
                title = el.text or ""
            elif tag == "text" and el.text and "{{-nlverb-" in el.text:
                verb = title.removesuffix("/vervoeging").strip()
                if verb and " " not in verb and ":" not in verb:
                    for body in _template_bodies(el.text):
                        aux = aux_of(body)
                        if aux:
                            # a page with two tables that disagree: both
                            out[verb] = aux if out.get(verb, aux) == aux else "both"
            if tag == "page":
                el.clear()
    return out


def _download(dest: Path) -> None:
    print(f"Downloading {DUMP_URL}", file=sys.stderr)
    req = urllib.request.Request(DUMP_URL, headers={"User-Agent": "vuurtoren-build"})
    with urllib.request.urlopen(req) as r, dest.open("wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--dump", type=Path, help="an nlwiktionary pages-articles dump (bz2)")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        dump = args.dump or Path(tmp) / DUMP
        if not args.dump:
            _download(dump)
        sha1 = hashlib.sha1(dump.read_bytes()).hexdigest()
        if sha1 != DUMP_SHA1:
            print(f"SHA-1 {sha1} is not the pinned {DUMP_SHA1}", file=sys.stderr)
            return 1
        verbs = read_dump(dump)
    lines = [f"# heb or ben per verb, from {DUMP} (SHA-1 {DUMP_SHA1}), CC BY-SA 4.0"]
    lines += [f"{v}\t{a}" for v, a in sorted(verbs.items())]
    # mtime=0: the same list gives the same bytes.
    with args.out.open("wb") as f, gzip.GzipFile(fileobj=f, mode="wb", mtime=0) as gz:
        gz.write(("\n".join(lines) + "\n").encode("utf-8"))
    counts = {a: sum(1 for x in verbs.values() if x == a) for a in ("hebben", "zijn", "both")}
    print(f"{len(verbs)} verbs: {counts} -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
