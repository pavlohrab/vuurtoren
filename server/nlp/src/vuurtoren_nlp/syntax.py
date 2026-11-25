"""The sentence-structure parse (SX1): SyntaxDot on spaCy's own words and sentences.

SyntaxDot (nl-l6-h384, CPU) parses better than spaCy's model for the Sentence tab's clauses, so
each token gets ``syn``: SyntaxDot's part of speech, morphology, dependency and head, and the
lemma and split-verb particle the server's usual code finds on that parse. Everything else in the
token stays spaCy's.

Set ``VUURTOREN_SYNTAXDOT_DIR`` to a folder with ``bin/`` (the syntaxdot binary and its libtorch)
and ``nl/`` (the model with ``syntaxdot.conf``). Without it nothing changes. Each call starts the
binary (about a second to load, then ~0.75 s per 1,000 words on one core, ~0.5 GB while it runs).
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from spacy.tokens import Doc

from vuurtoren_nlp.models import SyntaxParse, TextAnalysis


def syntaxdot_dir() -> Path | None:
    """The SyntaxDot folder, or None when it isn't set up."""
    raw = os.environ.get("VUURTOREN_SYNTAXDOT_DIR", "").strip()
    if not raw:
        return None
    d = Path(raw).expanduser()
    return (
        d if (d / "bin" / "syntaxdot").exists() and (d / "nl" / "syntaxdot.conf").exists() else None
    )


def _conllu(docs: list[Doc]) -> tuple[str, list[tuple[int, list[int]]]]:
    """Every sentence's words (spaCy's, without whitespace tokens) as CoNLL-U for SyntaxDot."""
    lines: list[str] = []
    where: list[tuple[int, list[int]]] = []
    for di, doc in enumerate(docs):
        for s in doc.sents:
            idx = [t.i for t in s if t.text.strip()]
            if not idx:
                continue
            for n, i in enumerate(idx, 1):
                lines.append(f"{n}\t{doc[i].text}\t_\t_\t_\t_\t_\t_\t_\t_")
            lines.append("")
            where.append((di, idx))
    return "\n".join(lines) + "\n", where


def _run(folder: Path, conllu: str) -> list[list[list[str]]]:
    binary = folder / "bin"
    out = subprocess.run(
        [
            str(binary / "syntaxdot"),
            "annotate",
            "--annotation-threads",
            "1",
            str(folder / "nl" / "syntaxdot.conf"),
        ],
        input=conllu,
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, "LD_LIBRARY_PATH": str(binary)},
    ).stdout
    sents: list[list[list[str]]] = []
    cur: list[list[str]] = []
    for line in out.splitlines():
        if not line:
            if cur:
                sents.append(cur)
                cur = []
        elif not line.startswith("#"):
            c = line.split("\t")
            if "-" not in c[0] and "." not in c[0]:
                cur.append(c)
    if cur:
        sents.append(cur)
    return sents


def add_syntax(docs: list[Doc], analyses: list[TextAnalysis], originals: list[str]) -> None:
    """Give every token of ``analyses`` its ``syn`` from SyntaxDot, when it is set up."""
    from vuurtoren_nlp.pipeline import analyze_doc

    folder = syntaxdot_dir()
    if folder is None or not docs:
        return
    conllu, where = _conllu(docs)
    if not where:
        return
    sents = _run(folder, conllu)
    if len(sents) != len(where):
        return  # SyntaxDot split differently: keep spaCy's parse rather than guess
    parse = [[(t.pos_, str(t.morph), t.dep_, t.head.i) for t in doc] for doc in docs]
    for (di, idx), cols in zip(where, sents, strict=True):
        if len(cols) != len(idx):
            continue
        for k, c in enumerate(cols):
            h = int(c[6])
            i = idx[k]
            parse[di][i] = (
                c[3],
                "" if c[5] == "_" else c[5],
                "ROOT" if c[7] == "root" else c[7],
                i if h == 0 else idx[h - 1],
            )
    for doc, p, analysis, orig in zip(docs, parse, analyses, originals, strict=True):
        # The same words through the usual code, so lemma and particles follow the same rules.
        sd = Doc(
            doc.vocab,
            words=[t.text for t in doc],
            spaces=[bool(t.whitespace_) for t in doc],
            pos=[x[0] for x in p],
            morphs=[x[1] for x in p],
            deps=[x[2] for x in p],
            heads=[x[3] for x in p],
            lemmas=[t.lemma_ for t in doc],
        )
        for tok, s in zip(analysis.tokens, analyze_doc(sd, orig).tokens, strict=True):
            tok.syn = SyntaxParse(
                pos=s.pos,
                morph=s.morph,
                dep=s.dep,
                head=s.head,
                lemma=s.lemma,
                particle_of=s.particle_of,
            )
