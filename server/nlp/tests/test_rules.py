"""The Dutch word lists in rules/nl (RL0): each loads, has no doubles, and is used by the code."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from vuurtoren_nlp.rules import _DIR, pairs, words

PKG = Path(__file__).resolve().parents[1] / "src" / "vuurtoren_nlp"
FILES = sorted(p.name for p in _DIR.iterdir() if p.suffix in (".txt", ".tsv"))


@pytest.mark.parametrize("name", FILES)
def test_a_list_loads_without_doubles(name: str) -> None:
    if name.endswith(".tsv"):
        got = pairs(name)
        assert got, name
        assert all(k and v for k, v in got.items()), name
        keys = [
            r.split("\t", 1)[0]
            for r in (_DIR / name).read_text().splitlines()
            if r.split("#", 1)[0].strip()
        ]
        assert len(keys) == len(set(keys)), f"{name}: a key twice"
    else:
        got = words(name)
        assert got, name
        assert len(got) == len(set(got)), f"{name}: an entry twice"


def test_every_list_is_used_and_every_use_has_its_list() -> None:
    code = "\n".join(p.read_text() for p in PKG.glob("*.py"))
    named = set(re.findall(r'(?:words|pairs)\("([a-z_]+\.(?:txt|tsv))"\)', code))
    assert named == set(FILES)
