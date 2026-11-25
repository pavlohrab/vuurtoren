"""Build the starter word list ``content/starter/nl-5000.json``: the 5000 most common Dutch lemmas.

Usage (from server/nlp, with the dictionary and sentence packs installed)::

    uv run python scripts/build_starter.py                      # packs in VUURTOREN_DATA_DIR
    uv run python scripts/build_starter.py --data ~/.local/share/app.vuurtoren.desktop/nlp-data

Inputs, all pinned: the ``dictionary-nl`` and ``sentences-nl`` packs at the versions in
``src/vuurtoren_nlp/packs.json`` (their install markers are checked against its digests), the
``wordfreq`` data and the spaCy model locked in ``uv.lock``. The same inputs give the same file.

Steps (rules in :mod:`vuurtoren_nlp.starter`, documented in docs/dev/algorithms.md,
"Starter words"):

1. The ``--forms`` most frequent Dutch word forms of wordfreq.
2. How each form is read in context: every Tatoeba sentence of the sentence pack is analysed
   with the app's spaCy pipeline (lemma and part of speech per token, the dictionary's lemma
   choice included); a form never seen there is analysed on its own. A lemma without a
   dictionary entry is replaced by the lemma the dictionary's forms table gives for the form.
3. Forms merge into lemmas (frequency shared by the readings, summed), the filters drop names,
   numbers, letters, abbreviations, interjection noise and English, and the top ``--size`` stay.
4. Each lemma gets its part of speech, its article (nouns), the reader's short gloss and an
   example sentence with its English.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from importlib.metadata import version
from pathlib import Path

from vuurtoren_nlp.datadir import data_dir
from vuurtoren_nlp.starter import (
    CONTENT_POS,
    Entry,
    Sentence,
    drop_reason,
    gloss_for,
    inflection_target,
    merge_forms,
    order_by_pos,
    pick_sentence,
)

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
MANIFEST = ROOT / "src" / "vuurtoren_nlp" / "packs.json"
PARTICLES = REPO / "packages" / "core" / "src" / "reading" / "particle-glosses.json"
OUT = REPO / "content" / "starter" / "nl-5000.json"
PACKS = {"dictionary-nl": "dictionary-nl.sqlite", "sentences-nl": "sentences-nl.sqlite"}

# spaCy universal POS -> the part of speech written in the list.
POS_NAMES = {
    "NOUN": "noun",
    "VERB": "verb",
    "AUX": "verb",
    "ADJ": "adjective",
    "ADV": "adverb",
    "PRON": "pronoun",
    "DET": "determiner",
    "ADP": "preposition",
    "CCONJ": "conjunction",
    "SCONJ": "conjunction",
    "NUM": "numeral",
    "INTJ": "interjection",
}
ARTICLES = {"de", "het", "een"}
# Wiktionary part of speech -> spaCy universal POS (for a form read without context).
UD_OF = {
    "noun": "NOUN",
    "name": "PROPN",
    "verb": "VERB",
    "adj": "ADJ",
    "adv": "ADV",
    "pron": "PRON",
    "det": "DET",
    "article": "DET",
    "prep": "ADP",
    "postp": "ADP",
    "conj": "CCONJ",
    "num": "NUM",
    "intj": "INTJ",
}


def check_packs(data: Path, accept: bool) -> dict[str, str]:
    """The installed pack versions, checked against packs.json (exit unless ``accept``)."""
    manifest = json.loads(MANIFEST.read_text())["packs"]
    found: dict[str, str] = {}
    for name, file in PACKS.items():
        marker = data / f"{file}.pack.json"
        info = json.loads(marker.read_text()) if marker.is_file() else {}
        want = manifest[name]
        if info.get("sha256") != want["sha256"]:
            msg = f"{name}: installed {info.get('version', 'unversioned')}, want {want['version']}"
            if not accept:
                sys.exit(f"error: {msg} (install the pinned pack, or --accept-unpinned)")
            print(f"warning: {msg}", file=sys.stderr)
        found[name] = info.get("version", "unversioned")
    return found


def load_dictionary(path: Path) -> tuple[dict[str, list[Entry]], dict[str, list[str]]]:
    """Entries by lowercased headword (in id order) and the forms table (form -> lemmas)."""
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    entries: dict[str, list[Entry]] = defaultdict(list)
    for word, pos, article, glosses in con.execute(
        "SELECT word, pos, article, glosses FROM entries ORDER BY id"
    ):
        entries[word.lower()].append(Entry(pos, article, tuple(json.loads(glosses)), word))
    forms: dict[str, list[str]] = defaultdict(list)
    for form, lemma in con.execute("SELECT form, lemma FROM forms ORDER BY rowid"):
        if any(c.isdigit() for c in form + lemma):
            continue
        if lemma.lower() not in forms[form.lower()]:
            forms[form.lower()].append(lemma.lower())
    con.close()
    return entries, forms


def read_forms(
    forms: list[str], texts: list[str], processes: int
) -> dict[str, Counter[tuple[str, str]]]:
    """How each form is read in context: (lemma, POS) counts over the sentences, else alone.

    A form read alone has the POS ``?``: one word without context is no evidence of its part
    of speech (spaCy calls many of them names); :func:`to_dictionary_lemmas` takes the
    dictionary's instead."""
    from vuurtoren_nlp.pipeline import analyze_doc, get_nlp

    wanted = set(forms)
    readings: dict[str, Counter[tuple[str, str]]] = defaultdict(Counter)
    nlp = get_nlp("nl")
    t0 = time.perf_counter()
    for n, doc in enumerate(nlp.pipe(texts, batch_size=256, n_process=processes), 1):
        for t in analyze_doc(doc).tokens:
            form = t.text.lower()
            if form in wanted and t.is_word and t.particle_of is None:
                readings[form][(t.lemma.lower(), "PROPN" if t.is_propn else t.pos)] += 1
        if n % 20000 == 0:
            print(f"  {n} sentences, {time.perf_counter() - t0:.0f}s", flush=True)
    alone = [f for f in forms if f not in readings]
    for form, doc in zip(alone, nlp.pipe(alone, batch_size=256), strict=True):
        for t in analyze_doc(doc).tokens[:1]:
            readings[form][(t.lemma.lower(), "?")] += 1
    print(f"  {len(alone)} forms analysed on their own")
    return readings


def to_dictionary_lemmas(
    readings: dict[str, Counter[tuple[str, str]]],
    entries: dict[str, list[Entry]],
    forms_table: dict[str, list[str]],
) -> tuple[dict[str, Counter[tuple[str, str]]], Counter[str]]:
    """Readings whose lemma has no entry take a lemma the forms table gives for the form (or for
    the lemma): the one the form is read as most often, else the first with an entry. Otherwise
    they are kept, and the filter drops them. A form read alone (POS ``?``) takes the part of
    speech of the lemma's first dictionary entry. A word that is only an inflection of another
    ("Nederlanders") becomes that word. Also returns how often each lemma was read in context."""
    out: dict[str, Counter[tuple[str, str]]] = {}
    context: Counter[str] = Counter()
    for form, counts in readings.items():
        seen: Counter[str] = Counter()
        for (lemma, _), n in counts.items():
            seen[lemma] += n
        fixed: Counter[tuple[str, str]] = Counter()
        for (lemma, pos), n in sorted(counts.items()):
            if pos == "PROPN":
                lemma = form  # a name's lemma is the name ("twitter", not "twitteren")
            if lemma not in entries and not any(c.isdigit() for c in form + lemma):
                cands = [c for c in forms_table.get(form, []) + forms_table.get(lemma, [])]
                cands = [c for c in cands if c in entries]
                if cands:
                    lemma = max(cands, key=lambda c: (seen[c], -cands.index(c)))
            alone = pos == "?"
            if alone:
                first = next(iter(entries.get(lemma, [])), None)
                pos = UD_OF.get(first.pos, "X") if first else "X"
            target = inflection_target(entries.get(lemma, []))
            if (pos in CONTENT_POS or pos == "PROPN") and target in entries:
                lemma = target
            fixed[(lemma, pos)] += n
            if not alone:
                context[lemma] += n
        out[form] = fixed
    return out, context


def article_of(lemma: str, pos: str, entries: list[Entry]) -> str | None:
    if pos != "NOUN":
        return None
    return next((e.article for e in entries if e.pos == "noun" and e.article), None)


def utf16(s: str, i: int) -> int:
    """UTF-16 offset of code point ``i`` (what JavaScript's String.slice uses)."""
    return len(s[:i].encode("utf-16-le")) // 2


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--data", type=Path, default=None, help="directory with the installed packs")
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--forms", type=int, default=12000, help="word forms to rank")
    ap.add_argument("--size", type=int, default=5000, help="lemmas to keep")
    ap.add_argument("--processes", type=int, default=4, help="spaCy worker processes")
    ap.add_argument("--accept-unpinned", action="store_true", help="build from other packs")
    ap.add_argument("--report", type=Path, help="write the dropped lemmas and reasons here")
    ap.add_argument("--cache", type=Path, help="keep the readings here (reused when present)")
    args = ap.parse_args()

    data = args.data or data_dir()
    packs = check_packs(data, args.accept_unpinned)
    import os

    os.environ["VUURTOREN_DICT_PATH"] = str(data / PACKS["dictionary-nl"])
    from wordfreq import top_n_list, word_frequency, zipf_frequency

    entries, forms_table = load_dictionary(data / PACKS["dictionary-nl"])
    particles: dict[str, str] = json.loads(PARTICLES.read_text())
    forms = [f for f in top_n_list("nl", args.forms) if f]
    freqs = [(f, word_frequency(f, "nl")) for f in forms]

    con = sqlite3.connect(f"file:{data / PACKS['sentences-nl']}?mode=ro", uri=True)
    rows = con.execute("SELECT id, text, translation, n_words, score FROM sentences ORDER BY id")
    sentences = {r[0]: r for r in rows}
    occ: dict[int, list[str]] = defaultdict(list)
    spans: dict[str, list[tuple[int, int, int]]] = defaultdict(list)
    for lemma, sid, start, end in con.execute(
        "SELECT lemma, sid, start, end FROM occurrences ORDER BY sid, start"
    ):
        occ[sid].append(lemma)
        spans[lemma].append((sid, start, end))
    con.close()

    print(f"Reading {len(forms)} forms in {len(sentences)} sentences")
    if args.cache and args.cache.is_file():
        cached = json.loads(args.cache.read_text())
        readings = {f: Counter({(lp[0], lp[1]): n for lp, n in c}) for f, c in cached.items() if f}
    else:
        readings = read_forms(forms, [s[1] for s in sentences.values()], args.processes)
        if args.cache:
            dump = {f: sorted([list(k), n] for k, n in c.items()) for f, c in readings.items()}
            args.cache.write_text(json.dumps(dump, ensure_ascii=False))
    readings, context = to_dictionary_lemmas(readings, entries, forms_table)
    ranked = merge_forms(freqs, readings)

    kept, dropped = [], []
    for item in ranked:
        e = entries.get(item.lemma, [])
        why = drop_reason(
            item,
            e,
            zipf_en=zipf_frequency(item.lemma, "en"),
            zipf_nl=zipf_frequency(item.lemma, "nl"),
            corpus_count=context[item.lemma],
        )
        gloss = "" if why else gloss_for(item.lemma, item.main_pos(), entries, particles)
        if not why and not gloss:
            why = "no gloss"
        if why:
            dropped.append((item.lemma, why, round(item.freq * 1e6, 2)))
            continue
        kept.append((item, gloss))
        if len(kept) >= args.size:
            break

    ranks = {item.lemma: n for n, (item, _) in enumerate(kept, 1)}
    words = []
    for n, (item, gloss) in enumerate(kept, 1):
        pos = item.main_pos()
        if pos == "PROPN":  # kept as an ordinary word ("september"): the dictionary's POS
            first = next((e for e in entries[item.lemma] if e.pos != "name"), None)
            pos = UD_OF.get(first.pos, "X") if first else "X"
        cands = []
        where: dict[int, tuple[int, int]] = {}
        for sid, start, end in spans.get(item.lemma, ()):
            s = sentences[sid]
            surface = s[1].encode("utf-16-le")[start * 2 : end * 2].decode("utf-16-le")
            exact = surface.lower() == item.lemma
            cands.append(Sentence(sid, s[1], s[2], s[3], s[4], tuple(occ[sid]), exact))
            where[sid] = (start, end)
        best = pick_sentence(item.lemma, n, cands, ranks)
        own = entries.get(item.lemma, [])
        # As the dictionary writes it, for its part of speech: "Engels" (adj), "september".
        cased = next(
            (e.word for e in order_by_pos(own, pos) if e.pos not in {"name", "character"}),
            item.lemma,
        )
        word: dict[str, object] = {"rank": n, "word": cased, "pos": POS_NAMES.get(pos, "other")}
        article = article_of(item.lemma, pos, entries.get(item.lemma, []))
        if article and item.lemma not in ARTICLES:
            word["article"] = article
        word["gloss"] = gloss
        if best:
            word["sentence"] = best.text
            word["translation"] = best.translation
            word["mark"] = list(where[best.id])
            word["tatoeba"] = best.id
        words.append(word)

    out = {
        "language": "nl",
        "description": f"The {len(words)} most common Dutch words, by Vuurtoren",
        "licence": "CC BY-SA 4.0",
        "sources": {
            "frequency": f"wordfreq {version('wordfreq')} (CC BY-SA 4.0 data)",
            "dictionary": f"Wiktionary via Kaikki (CC BY-SA 4.0), pack {packs['dictionary-nl']}",
            "sentences": f"Tatoeba (CC BY 2.0 FR), pack {packs['sentences-nl']}",
            "analysis": f"spaCy nl_core_news_md {version('nl_core_news_md')}",
        },
        "words": words,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # One word per line: small, and readable in a diff.
    lines = [json.dumps(w, ensure_ascii=False, separators=(",", ":")) for w in words]
    head = json.dumps({k: v for k, v in out.items() if k != "words"}, ensure_ascii=False, indent=1)
    args.out.write_text(head[:-2] + ',\n "words": [\n' + ",\n".join(lines) + "\n ]\n}\n")
    json.loads(args.out.read_text())  # still valid JSON
    print(f"Wrote {args.out}: {len(words)} words, {args.out.stat().st_size / 1e6:.2f} MB")
    if args.report:
        args.report.write_text("".join(f"{w}\t{why}\t{f}\n" for w, why, f in dropped))
    return 0


if __name__ == "__main__":
    sys.exit(main())
