# For developers

How the code is laid out: [architecture](architecture.md). How every algorithm works:
[algorithms](algorithms.md). The look and the UI rules: [design system](design-system.md). Audio
clips and the audio pack: [audio](audio.md).

## Run it

Node ≥ 22, pnpm, [uv](https://docs.astral.sh/uv/), Python ≥ 3.12.

```sh
pnpm install && pnpm build
cd server/nlp && uv run python scripts/build_dictionary.py && uv run python scripts/fetch_mt_model.py && cd -
pnpm nlp     # language server on :8000
pnpm dev     # web app on http://localhost:5173 (add ?demo for demo data)
```

Issues and pull requests are welcome.

## The starter words

From `server/nlp`, with the `dictionary-nl` and `sentences-nl` data packs installed at the
versions in `src/vuurtoren_nlp/packs.json`:

```sh
uv run python scripts/build_starter.py --data <directory with the packs>
```

The inputs are pinned (the two packs by their digests, wordfreq and the spaCy model by
`uv.lock`), so the same inputs give the same file. It takes about four minutes.

`nl-5000.json` in the repo is the reviewed list: a word-by-word review fixed 2,316 entries and
removed 70, so it holds 4,930 words. `build_starter.py` makes the list before that review, so
don't overwrite the file with its output; fix words directly in `nl-5000.json`.

## Stories

The stories are in `content/stories/<level>/<slug>.md`; the level targets are in
[content/stories/README.md](../../content/stories/README.md).
Names and numbers do not count towards the share. The list is `content/starter/nl-5000.json`.

## A story file

One file per story, `<level>/<slug>.md`; the slug is the file name. Front matter first, then the
story: each Dutch sentence on its own line, followed by its English on a line that starts with
`> `. A blank line starts a new paragraph.

```text
---
title: Klaas Vaak
level: A1
words: 195
summary: One English sentence about the story.
kind: legend
credit: The Dutch folk figure Klaas Vaak, the sandman
licence: CC BY-SA 4.0
review: needs-native-review
names: Klaas, Vaak, Sam
---

Het is al laat.
> It is already late.
Sam ligt in bed, maar hij slaapt niet.
> Sam is lying in bed, but he is not asleep.
```

- `kind` is `legend` (a Dutch legend or folk tale), `classic` (a retold public-domain work) or
  `original`.
- `credit` names the original work and its author; a retelling needs one. Retell classics only
  from authors who died before 1955, and always in your own words.
- `names` lists words that are names the analysis may not recognise; they are not counted.
- `words` is filled in by the check (`--set-words`).
- `review` stays `needs-native-review` until a native speaker has read the story.

The English is a full, natural translation: side by side shows it instead of machine
translation, sentence by sentence, so keep exactly one `> ` line per Dutch sentence.

## Checking and bundling

From `server/nlp`:

```sh
uv run python scripts/check_stories.py               # check every story
uv run python scripts/check_stories.py klaas         # only stories whose slug contains "klaas"
uv run python scripts/check_stories.py --set-words   # also write each story's word count
uv run python scripts/check_stories.py --write       # check, then write stories.json
```

The check analyses each story with the app's spaCy pipeline and reports its words, its share of
words within the level's part of the list, the words outside it (to rewrite), sentences that are
long for the level, and where spaCy splits the text differently from the lines (the reader pairs
the English with spaCy's sentences). A colon before a quote or a name at the start of a sentence
can make spaCy split a line: rephrase the line. It exits with 1 while a story misses a target.

`stories.json` is the bundle the app loads: every story with its text, its English per sentence,
its analysis, the word pairs of each sentence with its English and the grammar hits. Run
`--write` after any change to a story and commit both.

The pairs and hits are what the language server would answer (`/translate/pairs` with the
story's English given, and `/grammar`), worked out once at build time so side by side, its
structure view and the grammar marks work on a phone and before the desktop's server is ready.
`--write` computes them itself (`scripts/build_story_extras.py`), so it needs the translation
model (`uv run python scripts/fetch_mt_model.py`, or point `VUURTOREN_MT_DIR` at an installed
`mt-nl-en` pack). After a change to the pairing code, the model or the grammar detectors, redo
only this step:

```sh
uv run python scripts/build_story_extras.py          # check the analysis, redo pairs and hits
```

It stops when a story's bundled analysis no longer matches a fresh one (run `--write`). The
bundle records the versions it used under `extras`; the app ignores pairs and hits made for
another analysis and asks the server instead.
