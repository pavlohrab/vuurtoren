# Starter words

`nl-5000.json` holds the 5000 most common Dutch words, most common first, each with its part of
speech, its article (nouns), a short English meaning and, for most words, an example sentence
with its English translation. Vuurtoren ships it inside the app and turns it into cards in native
mode, in levels of 500 words ("Vuurtoren · Woorden 1–500" …).

Each word is one line of the `words` array, like this:

```json
{
  "rank": 155,
  "word": "huis",
  "pos": "noun",
  "article": "het",
  "gloss": "a house, home",
  "sentence": "…",
  "translation": "…",
  "mark": [4, 8],
  "tatoeba": 1234
}
```

`mark` is where the word stands in the sentence (UTF-16 offsets), `tatoeba` the sentence's id on
tatoeba.org. How the list is made (ranking, filters, glosses, sentences) is in
[docs/algorithms.md](../../docs/algorithms.md), "Starter words".

## Building it

From `server/nlp`, with the `dictionary-nl` and `sentences-nl` data packs installed at the
versions in `src/vuurtoren_nlp/packs.json`:

```sh
uv run python scripts/build_starter.py --data <directory with the packs>
```

The inputs are pinned (the two packs by their digests, wordfreq and the spaCy model by
`uv.lock`), so the same inputs give the same file. It takes about four minutes.

## Licence and sources

The list is licensed under [CC BY-SA 4.0](../LICENSE), because the sources below are:

- **Word frequencies**: [wordfreq](https://github.com/rspeer/wordfreq) 3.1.1 by Robyn Speer
  (code Apache-2.0; its data CC BY-SA 4.0), Zenodo, https://doi.org/10.5281/zenodo.7199437. Its
  Dutch data include SUBTLEX-NL (Keuleers, Brysbaert & New, 2010; freely available data, credited
  as its authors ask), OpenSubtitles 2018 (via OPUS), Wikipedia, ParaCrawl, Google Books Ngrams,
  news, Reddit and Twitter.
- **Meanings, parts of speech and articles**: [Wiktionary](https://en.wiktionary.org), the free
  dictionary, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (and GFDL),
  extracted by [Wiktextract](https://github.com/tatuylonen/wiktextract) and distributed by
  [Kaikki.org](https://kaikki.org). Meanings are shortened. Per-entry authorship is in the
  Wiktionary page histories.
- **Example sentences and their translations**: [Tatoeba](https://tatoeba.org), under
  [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/) (some sentences CC0),
  unmodified. Each sentence's author is on `https://tatoeba.org/sentences/show/<tatoeba>`.
- **Lemmas and parts of speech in context**: spaCy `nl_core_news_md` 3.8.0.
