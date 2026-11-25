"""The sentence-structure parse (SX1): SyntaxDot on spaCy's own words and sentences.

SyntaxDot (nl-l6-h384, CPU) parses better than spaCy's model for the Sentence tab's clauses, so
each token gets ``syn``: SyntaxDot's part of speech, morphology, dependency and head, and the
lemma and split-verb particle the server's usual code finds on that parse. Everything else in the
token stays spaCy's.

SyntaxDot is a required part of the server: ``<data dir>/syntaxdot`` (or
``VUURTOREN_SYNTAXDOT_DIR``) holds ``bin/`` (the syntaxdot binary and its libtorch) and
``nl/`` (the model with ``syntaxdot.conf``); ``scripts/get_syntaxdot.py`` puts them there.
While it is missing the server says so (log and /health) and the tokens have no ``syn``. Each
call starts the binary (about a second to load, then ~0.75 s per 1,000 words on one core,
~0.5 GB while it runs).
"""

from __future__ import annotations

import os
import platform
import subprocess
import sys
from pathlib import Path

from spacy.tokens import Doc

from vuurtoren_nlp.datadir import data_dir
from vuurtoren_nlp.models import SyntaxParse, TextAnalysis


def supported() -> bool:
    """SyntaxDot is built for Linux on x86_64 only; elsewhere spaCy's parse is used."""
    return sys.platform.startswith("linux") and platform.machine().lower() in ("x86_64", "amd64")


def syntaxdot_target() -> Path:
    """Where SyntaxDot belongs: ``$VUURTOREN_SYNTAXDOT_DIR``, else ``<data dir>/syntaxdot``."""
    raw = os.environ.get("VUURTOREN_SYNTAXDOT_DIR", "").strip()
    return Path(raw).expanduser() if raw else data_dir() / "syntaxdot"


def syntaxdot_dir() -> Path | None:
    """The SyntaxDot folder, or None when it isn't set up."""
    d = syntaxdot_target()
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


def _one_root(cols: list[list[str]]) -> None:
    """SyntaxDot sometimes gives a sentence two roots ("Ze begroet meneer …": begroet and
    meneer). Keep one: a conjugated verb, else a word a conjugated helper hangs on, else the
    first. The others hang on it, so no word falls out of the sentence."""
    roots = [k for k, c in enumerate(cols) if c[6] == "0"]
    if len(roots) < 2:
        return

    def finite(k: int) -> bool:
        return "VerbForm=Fin" in cols[k][5]

    def helped(k: int) -> bool:
        return any(
            c[6] == str(k + 1) and c[7] in ("aux", "cop") and finite(j) for j, c in enumerate(cols)
        )

    main = next((k for k in roots if finite(k)), None)
    if main is None:
        main = next((k for k in roots if helped(k)), roots[0])
    for k in roots:
        if k != main:
            cols[k][6] = str(main + 1)
            cols[k][7] = "dep"


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
        _one_root(cols)
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
