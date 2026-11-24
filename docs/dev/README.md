# For developers

These pages are for anyone who wants to read or change the code. How the code is laid out is in
[architecture](architecture.md), and how every algorithm works is in [algorithms](algorithms.md).
The look and the UI rules are in the [design system](design-system.md), and the audio clips and
the audio pack are in [audio](audio.md).

## Run it

You need Node ≥ 22, pnpm, [uv](https://docs.astral.sh/uv/) and Python ≥ 3.12.

```sh
pnpm install && pnpm build
cd server/nlp && uv run python scripts/build_dictionary.py && uv run python scripts/fetch_mt_model.py && cd -
pnpm nlp     # language server on :8000
pnpm dev     # web app on http://localhost:5173 (add ?demo for demo data)
```

Issues and pull requests are welcome.

## The starter words

The starter words are the ready deck of about 5000 common words. To build the list again, run this
from `server/nlp`, with the `dictionary-nl` and `sentences-nl` data packs installed at the
versions in `src/vuurtoren_nlp/packs.json`:

```sh
uv run python scripts/build_starter.py --data <directory with the packs>
```

The inputs are pinned, so the same inputs give the same file. The two packs are pinned by their
digests, and wordfreq and the spaCy model by `uv.lock`. It takes about four minutes.

`nl-5000.json` in the repo is the reviewed list: a word-by-word review fixed 2,316 entries and
removed 70, so it holds 4,930 words. `build_starter.py` makes the list as it was before that
review, so don't overwrite the file with its output. Fix words directly in `nl-5000.json` instead.

## Stories

The stories are in `content/stories/<level>/<slug>.md`, and the level targets are in
[content/stories/README.md](../../content/stories/README.md). A target is the share of a story's
words that falls within the level's part of the starter list, `content/starter/nl-5000.json`. Names
and numbers do not count towards the share.

## A story file

Each story has one file, `<level>/<slug>.md`, and the slug is the file name. The front matter
comes first and then the story. Each Dutch sentence is on its own line, and its English follows on
a line that starts with `> `. A blank line starts a new paragraph.

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
- `credit` names the original work and its author, and a retelling needs one. Retell classics only
  from authors who died before 1955, and always in your own words.
- `names` lists names the analysis may not recognise, so they are not counted.
- `words` is filled in by the check (`--set-words`).
- `review` stays `needs-native-review` until a native speaker has read the story.

The English is a full, natural translation. Side by side shows it sentence by sentence instead of
machine translation, so keep exactly one `> ` line per Dutch sentence.

## Checking and bundling

From `server/nlp`:

```sh
uv run python scripts/check_stories.py               # check every story
uv run python scripts/check_stories.py klaas         # only stories whose slug contains "klaas"
uv run python scripts/check_stories.py --set-words   # also write each story's word count
uv run python scripts/check_stories.py --write       # check, then write stories.json
```

The check analyses each story with the app's spaCy pipeline. It reports the story's words, its
share of words within the level's part of the list, and the words outside it, which you rewrite.
It also reports sentences that are long for the level, and places where spaCy splits the text
differently from the lines. That matters because the reader pairs the English with spaCy's
sentences. A colon before a quote, or a name at the start of a sentence, can make spaCy split a
line, and then you rephrase the line. The check exits with 1 while a story misses a target.

`stories.json` is the bundle the app loads. It holds every story with its text, its English per
sentence, its analysis, the word pairs between each sentence and its English, and the grammar hits. Run
`--write` after any change to a story and commit both.

The pairs and hits are what the language server would answer (`/translate/pairs` with the
story's English given, and `/grammar`). They are worked out once at build time, so that side by
side, its structure view and the grammar marks work on a phone, and on the desktop before its
server is ready.
`--write` computes them itself (`scripts/build_story_extras.py`), so it needs the translation
model (`uv run python scripts/fetch_mt_model.py`, or point `VUURTOREN_MT_DIR` at an installed
`mt-nl-en` pack). After a change to the pairing code, the model or the grammar detectors, redo
only this step:

```sh
uv run python scripts/build_story_extras.py          # check the analysis, redo pairs and hits
```

It stops when a story's bundled analysis no longer matches a fresh one, and then you run
`--write`. The bundle records the versions it used under `extras`. The app ignores pairs and hits
made for another analysis and asks the server instead.
