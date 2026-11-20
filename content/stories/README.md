# Stories

Graded Dutch stories that ship with Vuurtoren, from A1 to B2. Each level mixes Dutch legends and
folk tales, retold public-domain classics and new stories about life in the Netherlands. The
Library shows them on its Stories shelf, with how much of each story the learner already knows.

| Level | Length (words) | Words within the starter list | Longest sentence |
| ----- | -------------- | ----------------------------- | ---------------- |
| A1    | 150–250        | 95% within the first 1000     | 10 words         |
| A2    | 300–500        | 95% within the first 2000     | 14 words         |
| B1    | 600–900        | 95% within the first 3500     | 20 words         |
| B2    | 900–1400       | 95% within the whole list     | no limit         |

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

`stories.json` is the bundle the app loads: every story with its text, its English per sentence
and its analysis. Run `--write` after any change to a story and commit both.

## Licence

The stories are written for Vuurtoren and licensed under CC BY-SA 4.0, like the rest of
`content/` (see `content/LICENSE`).
