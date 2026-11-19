# How Kenning works (no AI needed)

This page explains the algorithms behind Kenning's reader, practice and Anki integration. None of them uses a language model. They are deterministic rules, a few statistics and two offline tools: spaCy for Dutch analysis and a small translation model. The numbers below are copied from the code, and each section names the files it describes, so you can check them.

Contents

1. [Anki → learner model](#1-anki--learner-model)
2. [Dutch analysis (NLP service)](#2-dutch-analysis-nlp-service)
3. [Reading](#3-reading)
4. [Practice](#4-practice)
5. [Grammar detectors](#5-grammar-detectors)
6. [What Kenning writes to Anki](#6-what-kenning-writes-to-anki)
7. [Worked example: "Ik bel je morgen op."](#7-worked-example-ik-bel-je-morgen-op)
8. [Where AI is optional](#8-where-ai-is-optional)

---

## 1. Anki → learner model

Kenning has no word list of its own. Your Anki collection is the record of which Dutch words you know. When you sync, Kenning reads your decks (read-only) and builds a **learner model**: for every word key, a state (`unknown`, `seen`, `learning`, `known`, `ignored`) and `pKnown`, the probability that you would recall it right now.

### 1.1 Finding your Dutch decks and fields

**What.** Kenning works out which decks hold Dutch vocabulary, and which field of each note type holds the word, the example sentence, the English meaning and the sentence translation. You do not have to configure this.

**How** (`packages/anki/src/snapshot.ts`, `packages/anki/src/detect.ts`):

1. Every deck with at least 10 notes is sampled: up to 30 random notes per deck. Smaller decks are skipped unless you named them, or unless it is Kenning's own target deck.
2. Field values are cleaned of HTML, `[sound:…]` tags, cloze markup and furigana (`packages/anki/src/clean.ts`).
3. Every cleaned value goes through language identification (`server/nlp/src/kenning_nlp/detect.py`): a small naive-Bayes classifier over the `wordfreq` "small" word lists of 10 languages (nl, en, de, fr, es, it, pt, pl; uk and ru after a Cyrillic-script check). Each word scores its log-frequency per language; a word missing from a list scores a floor plus a character-trigram estimate learnt from that list, so rare words still lean the right way. Only the first 400 characters are examined, and a result with confidence below 0.2 counts as "unknown language".
4. Per (deck, note type), each field gets statistics: the share of values detected as Dutch, the share detected as English, and the average number of words.
5. Fields are scored:

| Role                  | Must satisfy                                                                                                                            | Score                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Word field            | ≥ 30 % Dutch, average ≤ 4 words, present in at least half the sampled notes                                                             | Dutch share, +0.25 if the name looks like `word/woord/front/term/dutch/lemma/…`, −0.1 per average word above 3 |
| Sentence field        | ≥ 30 % Dutch, average ≥ 4 words, not the word field                                                                                     | Dutch share, +0.25 if the name contains `sentence/zin/example/voorbeeld/context`                               |
| Gloss (meaning) field | ≥ 30 % English, **or** a gloss-like name (`meaning/betekenis/translation/english/back/…`) with < 30 % Dutch and an average of ≤ 6 words | English share, +0.3 for a gloss-like name, −0.15 per average word above 4                                      |
| Sentence translation  | ≥ 50 % English, < 30 % Dutch, average ≥ 3 words, **and** the same number of sentences as the sentence field in ≥ 70 % of notes          | English share                                                                                                  |

6. A deck's **confidence** is the Dutch share of its word field, or the Dutch share of its sentence field when that is ≥ 0.8. (Single headwords are hard to identify; whole sentences are not.)
7. A deck is used when its confidence is ≥ 0.5, **or** when the same note type and word field reach ≥ 0.5 pooled over all decks that use it. Pooling rescues a themed deck full of loanwords like "de supermarkt".

**Limits.** This is sampling, so a deck with very few Dutch notes among many others can be missed. You can restrict or override the choice of decks. Headword fields longer than 200 characters are skipped (`snapshot.ts`).

### 1.2 From a card's headword to a key

**What.** The cleaned word field (e.g. `de fiets`, `zich richten (op)`, `zij, ze`) is turned into a lookup key.

**How** (`analyze_terms` in `server/nlp/src/kenning_nlp/pipeline.py`):

- Alternatives are split on `,` `;` `|` and on `/`. A slash between two function words (`en/of`, `dan/wel`) is kept whole.
- Bracketed parts are removed. `(zich)` marks the word as reflexive. Everything after `-` or `=` (a gloss pasted into the word field) is cut off.
- A leading article is removed and remembered: `de`/`het` becomes the word's article. Fixed expressions such as `de facto` keep it. `het of de cement` accepts both genders.
- A leading `zich` is removed and marks the word as reflexive.
- **The key is the headword itself, not a lemma.** A vocabulary deck already lists citation forms, and lemmatising an isolated word is unreliable (spaCy turns `vragen` into `vraag` and `geleden` into `lijden`). spaCy only supplies the part of speech.
- The other alternatives become **aliases**. They share the card's knowledge.

### 1.3 Key normalisation

One rule is used everywhere, in TypeScript (`normalizeKey` in `packages/core/src/match.ts`) and in Python (`normalize_key` in `pipeline.py`): Unicode NFKC, curly quotes and backtick → `'`, lowercase (not casefold, so `ß` stays `ß`), and trimmed whitespace.

### 1.4 How well do you know the card? (SM-2 decay vs FSRS stability)

**What.** Each note's cards are turned into one memory snapshot and then into a state plus `pKnown`.

**How** (`packages/anki/src/memory.ts`, `packages/core/src/memory.ts`):

- A note with several cards (forward and reverse) uses its **strongest card**: the one with the longest interval.
- New cards (never reviewed) are `unknown`, with `pKnown = 0`.
- Cards in (re)learning steps have an interval of minutes. They count as reviewed, with a tiny interval (at least 0.01 day).
- Recall probability `p` is computed in one of three ways, depending on what Anki provides:

| Data available                                                            | Formula                                                                                               |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| FSRS stability `S` and last review time (AnkiConnect v1 API with FSRS on) | FSRS forgetting curve: `R = (1 + F·t/S)^(−0.5)`, with `F = 0.9^(−1/0.5) − 1 = 19/81`, so `R(S) = 0.9` |
| SM-2 (no FSRS) with last review time                                      | `p = 0.9^(elapsed days / interval)`: an interval targets about 90 % recall on its due date            |
| No review time                                                            | `p = 0.9` if the interval is ≥ 21 days, else `min(0.9, interval / 21)`                                |

- The state follows from `p`:

| Constant                        | Value   | Meaning                                                                                                    |
| ------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `KNOWN_THRESHOLD_DAYS`          | 21 days | A card is _mature_ when its interval **or** its FSRS stability is ≥ 21 days (Anki's own definition)        |
| `KNOWN_MIN_RECALL`              | 0.6     | A mature card is `known` only while `p ≥ 0.6`                                                              |
| Anything else that was reviewed | —       | `learning`                                                                                                 |
| Mature **and suspended**        | —       | `known`, with `pKnown = max(p, 0.6)`: a suspended mature card usually means "I know this, stop showing it" |

So a mature card that you have not reviewed for a year decays back to `learning`.

**Limits.** The FSRS curve always uses decay 0.5 (FSRS-4.5/5). The code supports a per-preset FSRS-6 decay, but the Anki reader does not fetch it yet. The SM-2 estimate is an approximation, not Anki's own retrievability.

### 1.5 Merging decks

If the same key comes from several notes (two decks, a forward/reverse pair, or an alias), the **strongest evidence wins**, in the style of AnkiMorphs (`mergeKnowledge` in `packages/core/src/memory.ts`). States rank `ignored > known > learning > seen > unknown`. Between equal states, the higher `pKnown` wins. The first gloss, article and example sentence found for the key are kept. A sentence translation is only kept when the sentence and translation fields have the same number of sentences, so a half-translated field cannot mislead.

### 1.6 Manual marks and app-side states

What you do in the app is stored as events in Kenning's local database, never as edits to Anki's history. The effective state of a word is computed by `composeWord` in `packages/db/src/projections.ts`, in this order:

| Priority | Source                                                                      | State and `pKnown`                                                                                                     |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1        | Manual mark in the app (latest one wins, by clock)                          | known: `max(Anki pKnown, 0.95)` · learning: Anki's value if Anki also says learning, else 0.3 · ignored: 1 · seen: 0.1 |
| 2        | Anki snapshot                                                               | as computed above                                                                                                      |
| 3        | A note that Kenning added or moved forward, which Anki has not reviewed yet | learning, 0.2                                                                                                          |
| 4        | You only looked the word up in the reader                                   | seen, 0.1                                                                                                              |

"Use Anki's state" removes the manual mark (it is stored as an empty mark, so the latest-wins rule still works when events sync out of order).

Below the manual mark, **app evidence** (section 1.7) is laid over rows 2–4 and over words Kenning only knows from your answers.

### 1.7 Learning in Kenning (app evidence)

**What.** What you show inside Kenning teaches the same learner model the reader and the Words list use. Mastering a word in Practice, filling it into reader clozes or answering it in a book exercise raises it, even before Anki has seen it. Anki stays the record of known words: app evidence never makes a word `known` and never lowers what Anki says.

**Signals** (`packages/core/src/evidence.ts`, `packages/db/src/projections.ts`):

| Event                  | Where                                            | Counts as                                                                                                                                                        |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExerciseAnswered`     | every practice exercise                          | 1 correct or 1 wrong for the word's key                                                                                                                          |
| `ClozeAnswered`        | the first answer per reader blank and page visit | 1 correct (0.5 after a letter hint), or 1 wrong (also when the hints revealed the whole word)                                                                    |
| `BookExerciseAnswered` | a marked book item, with the word keys it tests  | 1 correct or 1 wrong per key (the bracketed lemma hint, else the answer's words that are unit or learner-model words; none for sentence building and open tasks) |

**How.** The projection `word_evidence` keeps, per (language, key), the weighted correct count `c`, the wrong count `w`, the time of the newest answer and whether it was correct (a tie goes to "wrong"). Sums and maxima do not depend on the order events arrive in, so replays and late arrivals give the same table. At read time, with the current clock:

```
pApp = 0.8 · c / (c + w + 1) · 0.5^(days since the newest answer / 30)     (× 0.5 if the newest answer was wrong)
```

| Base state (after the manual mark, Anki, pending note, lookups) | Effect of app evidence                                                                                                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| manual mark (any)                                               | none: your explicit choice wins                                                                                                                                                                                |
| `known`, `ignored`                                              | none: app evidence never demotes                                                                                                                                                                               |
| `learning`                                                      | `pKnown = max(base, pApp)`                                                                                                                                                                                     |
| `unknown`, `seen`, or nothing                                   | `pKnown = max(base, pApp)`; the state becomes **`learning`, shown as "Learning (in Kenning)"**, when `c ≥ 3`, the newest answer was correct and `pApp ≥ 0.5`. A word met only in exercises is otherwise `seen` |

| Constant                   | Value | Why                                                                                            |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| `APP_MAX_P`                | 0.8   | below "known" (mature Anki cards and manual marks reach 0.9+), inside the cloze range 0.6–0.99 |
| `APP_HALF_LIFE_DAYS`       | 30    | evidence fades if you stop answering; Anki's own schedule takes over                           |
| `APP_LEARNING_MIN_CORRECT` | 3     | one lucky answer is not learning; one pseudo-miss caps a single correct answer at 0.4          |
| hinted cloze weight        | 0.5   | same as the cloze credit (section 3.5)                                                         |

So three unaided correct answers today give `pKnown = 0.6`: the word counts as "Learning (in Kenning)", adds 0.6 to coverage and can become a cloze. Two months later, with no new answers, it is back to Anki's state with `pKnown ≈ 0.15`. Nothing is written to Anki: to make the word a card, use Add to Anki or Study first in Anki.

**Limits.** Exposure while reading (a word read without a lookup) is not evidence yet. Practice FSRS states are kept separately for scheduling exercises (section 4.1); only right/wrong feeds the learner model.

---

## 2. Dutch analysis (NLP service)

Kenning's Python service (`server/nlp`) analyses texts and Anki headwords with the **same** pipeline. It runs locally, for example in Docker, and sends nothing to third parties.

### 2.1 The spaCy pipeline

**What.** Each text is split into tokens. Each token gets a part of speech, morphology, a dependency relation, a sentence number, a lemma with alternatives, a word frequency and, for split separable verbs, a link from the particle to its verb (`particle_of`).

**How.** `nl_core_news_md` (spaCy's medium Dutch model) does tokenisation, tagging, parsing and a first lemma. Word frequency is the **Zipf** value from the `wordfreq` package, for the lemma, or for the surface form when the lemma is unknown (`server/nlp/src/kenning_nlp/freq.py`). About 7 is very common and 1 is rare. Punctuation, numbers and symbols are not words (`is_word = false`).

**Numbers.** Up to 200,000 characters per text (`models.py`). The web app sends long texts in chunks of at most 40,000 characters, cut at paragraph breaks (`chunkText` in `apps/web/src/services/live.ts`).

### 2.2 Choosing the lemma (precision rules)

spaCy knows context (`staat` → `staan` as a verb) but sometimes invents non-words (`betekenissen` → `betekeniss`) or leaves inflected forms alone (`ontdekten`). A dictionary has no context and mangles base forms (`kat` → `kater`). `choose_lemma` in `pipeline.py` combines the two:

1. If spaCy's lemma equals the surface form, is a real word, and the morphology says the token is **not inflected** (infinitive, plural present, singular noun), keep it.
2. Otherwise ask the dictionary. The dictionary is the Kaikki/Wiktionary _forms_ table when it is installed, which is POS-aware, otherwise `simplemma`. A dictionary lemma for a noun or adjective that is _longer_ than the surface form is rejected as noise.
3. The dictionary lemma replaces spaCy's when spaCy's lemma is not a real word, when spaCy left an inflected token unchanged, or when the token is inflected and Kaikki lists lemmas that exclude spaCy's or include a more frequent one (`regeert`: `regeren`, not `regeeren`).
4. Otherwise spaCy's lemma stays primary, and the dictionary lemma is kept as an **alternative lemma**.

Some extra alternatives are added for matching only, never as the primary lemma: `bepaalde` → `bepaald`, `katten` → `kat`, fused particles (`aangelopen` → `aanlopen`), and diminutives (`huisje` keeps `huisje` as an alternative to `huis`). Guessed alternatives survive only if they are real headwords.

A sentence-initial capital that spaCy tags as a proper noun ("Katten zijn …", "Bel me") is re-read. With the dictionary, a plural-noun reading wins, then a verb reading. A bare singular noun rarely starts a sentence.

### 2.3 Separable verbs and te-forms

Dutch splits verbs: _Ik **bel** je morgen **op**_ is a form of _opbellen_. The pipeline joins them (`_lemmas` in `pipeline.py`, with particle lists in `nl.py`):

- **(a) Parser-attached particles.** A token with dependency `compound:prt` is joined to its head verb: `op` + `bellen` → `opbellen`. The verb's lemma becomes `opbellen`, `bellen` becomes an alternative, and the particle is linked to the verb.
- **(a2) Noun-like particles** (`deel`, `plaats`, `kennis`, `waar`, `teleur`, `gade`) within three tokens after the verb: `nam deel` → `deelnemen`, but only if spaCy or the dictionary already proposed that verb.
- **(b) te-infinitives.** `in te stellen` → `instellen`, `waar te nemen` → `waarnemen`.
- **(c) Clause-final particles the parser missed.** `Trek een warme trui aan.` adds `aantrekken` as an alternative of the finite verb (not as the primary lemma).
- **Stranded prepositions are not particles.** If an R-pronoun (`er`, `daar`, `hier`, `waar`, or compounds like `waarop`) comes earlier in the sentence, the final preposition belongs to it: _Waar wacht je op?_ does not produce _opwachten_.
- spaCy sometimes invents a particle that is not in the text (`bel` → `terugbellen`). A particle that the surface form does not start with is removed.

There are 39 separable particles (`aan`, `af`, `bij`, `door`, `in`, `mee`, `op`, `uit`, `terug`, `weg`, …).

### 2.4 Words the dictionary does not have: derivations, compounds, the sentence

**What.** Dutch builds new words from old ones: with affixes (`woord` + `-loos` = `woordeloos`, "wordless") and by writing compounds as one word (`souvenirwinkel`). When a word has no dictionary entry, Kenning builds its meaning from its parts, and failing that takes the English it became in the translation of its sentence.

**Which meaning wins.** Dictionary entry (the word or a form of it), then a diminutive or plural of a known noun (`vriendinnetje` → `vriendin`), then a derivation, then the sentence when its alignment is confident, then a compound, then a less confident alignment (`Dictionary.lookup` in `dictionary.py`; the app adds the sentence). A confident alignment beats a compound guess because on the test set below it is right far more often (29 of 33 against 11 of 48 on the same words). A derivation loses to a compound only when the compound's parts are plain dictionary words and its head already contains the suffix: `berglandschap` is `berg` + `landschap`, not `bergland` + `-schap`; `brandgevaarlijk` is `brand` + `gevaarlijk`. When nothing at all resolves, a derivation of a compound is tried (`vastgoedmakelaar` + `-ster`).

**Derivations** (`server/nlp/src/kenning_nlp/derive.py`). Each affix knows which bases it takes and how to say the result in English:

| Affix                 | Base                       | Result     | English                                                       |
| --------------------- | -------------------------- | ---------- | ------------------------------------------------------------- |
| `-loos`               | noun                       | adjective  | `woord` → wordless                                            |
| `-baar`               | verb stem                  | adjective  | `werken` → workable                                           |
| `-lijk`               | noun, adjective, verb stem | adjective  | `bitter` → bitterly; verb: `-able`                            |
| `-ig`, `-erig`        | noun, adjective, verb      | adjective  | `poeder` → powdery                                            |
| `-achtig`             | noun, adjective            | adjective  | `spin` → spider-like                                          |
| `-vormig`             | noun                       | adjective  | `ster` → star-shaped                                          |
| `-isch`               | noun                       | adjective  | `symfonie` → symphonic                                        |
| `-heid`               | adjective, participle      | noun (de)  | `eerlijk` → honestness                                        |
| `-iteit`              | adjective                  | noun (de)  | `origineel` → originality                                     |
| `-ing`                | verb                       | noun (de)  | `boeken` → booking                                            |
| `-er`, `-aar`         | verb                       | noun (de)  | `stotteren` → stutterer                                       |
| `-ster`               | verb stem, agent noun      | noun (de)  | `ontwerpen` → female designer                                 |
| `-schap`              | noun                       | noun (het) | `eigenaar` → ownership                                        |
| `-dom`                | noun, adjective            | noun (het) | `paus` → popedom                                              |
| `on-`                 | adjective, participle      | adjective  | `beschermd` → unprotected                                     |
| `her-`                | verb, noun                 | same       | `schrijven` → rewrite                                         |
| number + noun + `-ig` | —                          | adjective  | `tweehandig` → two-handed, `dertienjarig` → thirteen-year-old |

`ver-`, `be-` and `ont-` change a verb in ways that cannot be guessed, so they are never split off: a base that starts with them must be a dictionary verb. Diminutives (`-je`, `-tje`, `-pje`, `-etje`, `-kje`) are resolved through the noun they come from, which may itself be a derivation or a compound.

A base is looked up with the spelling changes Dutch makes at a suffix: a linking `e`, `s`, `en` or `er` (`woord-e-loos`, `verkeer-s-loos`), an undoubled consonant (`rott-ig` → `rot`), a long vowel written single in an open syllable (`slap-e-loos` → `slaap`, `drie-tal-ig` → `taal`), and `v`/`z` for `f`/`s` (`slav-en-dom` → `slaaf`). Before a suffix that starts with a vowel a verb base is the infinitive minus `-en` (`lez-er` → `lezen`); before a consonant it is the present stem (`lees-baar` → `lezen`). Bases may be derived themselves, two levels deep (`on-` + `verdedigen` + `-baar` → undefendable).

Every reading that resolves is scored by the length of its base, minus 1 for an inflected base, 3 for a derived base, 6 for a compound base and 1 for a linker; the highest score wins. The base's English is its first one-word sense (`"without feeling; numb"` → numb), and English spelling rules form the result (`use` → usable, `happy` → happiness, `stop` → stopping, `translate` → translator). Suffixes are never compound heads, so `woordeloos` is no longer `woord` + `loos` (the plural of `loo`).

**Compounds** (`compound.py`). A dynamic-programming search tries every split into 2 or 3 dictionary parts, with optional linking elements `s`, `e`, `en`, `er` between them. Each split is scored as the sum of `len(part)²`, minus costs, so fewer and longer parts win. A head without an entry may be a derivation (`schoenen` + `poetser`).

| Rule                               | Value                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minimum word length                | 7 letters (3 parts: 10)                                                                                                                                          |
| Minimum part length                | 3 letters (an inflected head: 4)                                                                                                                                 |
| Penalty per extra part             | 25                                                                                                                                                               |
| Linker cost                        | none 0, `s` 2, `e` 3, `en` 3, `er` 4                                                                                                                             |
| Head (last part)                   | noun preferred (cost 0; inflected 2); adjective 10; verb infinitive 15; never a suffix (`loos`, `lijk`, `baar`, `heid`, `schap`, `achtig`, `isch`, `dom`, `aar`) |
| Modifiers                          | nouns, adjectives or verb _stems_; prefixes like `ver`, `be`, `ont`, `aan`, `voor` are never modifiers                                                           |
| Capitalised words (possible names) | only split if ≥ 9 letters, exactly 2 parts of ≥ 4 letters, and a noun head                                                                                       |
| Dictionary lookups per word        | at most 400                                                                                                                                                      |
| Diminutives (`-je`, `-tje`, …)     | never split; resolved through the noun they come from                                                                                                            |

The compound takes the article of its head (`de souvenirwinkel` because `de winkel`). Its meaning is the English of each part, e.g. **souvenir shop**. Each part's English is the first sense of at most 3 words; when no sense is that short, the Dutch lemma is used. A plural head is pluralised, and a female head comes first (`zwaardvechtster` → female sword fighter).

**Where a guess came from.** `/gloss` marks these entries with `origin` (`derivation` or `compound`) and `formed` (`woord + -loos`, `souvenir + winkel`). The word inspector shows the note after the meaning, small and muted: "wordless · from woord + -loos". In Gloss mode a guessed meaning is lighter and italic, with the note in its tooltip.

**The sentence** (`align.py`, `POST /translate/align`). OPUS-MT's decoder attends to the source subwords it is translating; CTranslate2 returns that attention for the best translation. A target word belongs to the Dutch word when one of its subwords attends most to one of the Dutch word's subwords. Neighbouring target words form runs; the run that gives the Dutch word the most attention wins, without articles, possessives, `to` and the like at its edges, and with at most 3 words. A word copied unchanged from the Dutch is no meaning. Attention alone hardly separates right from wrong, so the word is also translated on its own: the alignment is confident only when the two share an English word stem.

The app shows the meaning in the sentence marked "in this sentence". A confident one comes before a compound guess, which stays as the second meaning; after a derivation it is a second line when it differs ("speechless · in this sentence"). A less confident one is used only for a word with no other meaning. Words the dictionary knows are never aligned. The alignment request also returns the sentence translation, so the inspector needs no second request.

**Numbers.** A test set of 244 Dutch words without a dictionary entry (192 derivations, 51 compounds and derived compounds, 1 other), each in a Tatoeba sentence, with the English meanings that count as right (`server/nlp/tests/fixtures/meanings-nl.tsv`, `test_meanings.py`):

| Meaning from                                 | Right                                                      |
| -------------------------------------------- | ---------------------------------------------------------- |
| Compound splitting only (before derivations) | 8 / 244 (3 %)                                              |
| Derivations, then compounds                  | 156 / 244 (64 %): derivations 140 / 192, compounds 16 / 51 |
| All, in the order above                      | 194 / 244 (80 %)                                           |
| Sentence alignment, where confident          | used for 149 / 244 words, 132 right (89 %)                 |

The words were chosen because the dictionary misses them or the compound splitter glossed them badly, so the compound share is lower than on running text. Glosses for nouns + `-lijk` read oddly (`inzichtelijk` → insightly), and a base whose first dictionary sense is not the one used in the word gives the wrong meaning (`herverkiezen` → reprefer).

### 2.5 Dictionary glosses by part of speech, and de/het

**What.** English meanings come from the **Kaikki.org extract of English Wiktionary** (CC BY-SA), built into a local SQLite file by `scripts/build_dictionary.py`.

**How.**

- Each entry keeps at most 5 distinct glosses, each cut to 160 characters (`dictionary.py`).
- The app puts entries whose part of speech matches the token first. spaCy's `NOUN` matches Wiktionary `noun`, `VERB`/`AUX` match `verb`, `ADP` matches `prep`/`postp`, and so on (`KAIKKI_POS` in `apps/web/src/services/live.ts`). _Gang_ the noun and _gaan_ the verb get different meanings.
- Senses that only point at another word ("plural of …", "inflection of …") are dropped. In the word inspector, place-name senses ("a village in …") are dropped too.
- **Your Anki card's gloss always comes first.** The inspector shows up to 6 meanings. The inline reader gloss is one meaning: the Anki gloss, or else the first real dictionary sense for that part of speech.
- **de/het**: Wiktionary sense tags `neuter` → `het`, `masculine`/`feminine`/`common-gender` → `de`, both → `de/het`. The article from your Anki headword (`de fiets`) takes precedence over the dictionary.

**Limits.** Without the dictionary file, glosses fall back to your Anki glosses only, and lemma choice falls back to `simplemma`. Wiktionary coverage of rare and very new words varies.

### 2.6 Offline sentence translation (OPUS-MT)

**What.** A machine translation of the sentence a word appears in. It is shown in the word inspector and saved with a new Anki card as `SentenceTranslation`.

**How** (`server/nlp/src/kenning_nlp/translate.py`): the Helsinki-NLP `opus-mt-nl-en` model, run with CTranslate2 on the CPU, weights stored as int8 (converted from the original Marian release by `scripts/fetch_mt_model.py`), beam size 4. It is a small (about 85 MB, the `mt-nl-en` data pack) neural MT model that runs offline. It is not a chat model and never sees anything but the sentence. The same model gives the meaning of a word the dictionary does not know in its sentence (section 2.4).

**Numbers.** Input up to 1024 subword tokens, output up to 512. Per request: at most 64 texts, 2,000 characters each, 20,000 characters in total (`models.py`). Only Dutch → English. Without the model the feature is quietly unavailable.

### 2.7 Getting text in: OCR, PDF and URL cleanup

| Input            | How                                                                                                                                                                             | Numbers                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **URL**          | `trafilatura` extracts the main article (no comments, no tables, precision mode) (`extract_url.py`). Only public IP addresses are fetched.                                      | ≤ 5 redirects, 10 s timeout, ≤ 5 MB, needs ≥ 40 characters of text                             |
| **PDF**          | Text layer through PDFium (`pdf.py`), judged page by page. A page whose text layer is missing, nearly empty or not Dutch is read by OCR; the other pages keep their text layer. | ≤ 300 pages, ≤ 60 of them OCR'd; OCR when a page has < 40 letters/digits or < 70 % Dutch words |
| **Photo / scan** | Page clean-up, then RapidOCR, or Tesseract as fallback (`straighten.py`, `rapid.py`, `ocr.py`). See below.                                                                      | PDFs rendered at 300 DPI                                                                       |

**Text layer check.** A PDF page keeps its text layer when it has at least 40 letters and digits and at least 70 % of its words (the first 300 words of two or more letters) are Dutch words in the server's lexicon: wordfreq (Zipf ≥ 2), the dictionary, simplemma, or a two-part compound of known words. Pages with fewer than 12 words are not judged by that share. Real Dutch pages score 0.97 to 1.0; broken font encodings and poor scanner OCR layers score 0.1 to 0.45. Without an OCR engine only a whole-file scan (< 25 letters/digits per page) asks for OCR. Course import uses the same check.

**Page clean-up** (`straighten.py`, OpenCV). Geometry only: no binarisation and no contrast change, so a flat, straight scan comes out unchanged, pixel for pixel. Three steps, each skipped when it would change nothing:

1. **Page in a photo.** The largest bright or edge-bounded four-sided shape covering at least 20 % of the image is the page. It is cut out and warped to a rectangle, unless it is an upright rectangle filling more than 85 % of the image (a scan or tight crop).
2. **Deskew.** The rotation between −10° and +10° that makes the rows of dark pixels sharpest (horizontal projection profile, 0.5° then 0.1° steps) is applied when it is at least 0.5°.
3. **Dewarp.** Text lines are traced (dark pixels smeared sideways into line blobs, the centre of each blob per column), and one smooth polynomial surface is fitted to how far they bend. When the 90th-percentile line bends by at least a third of a line height, every column is shifted up or down to make the lines straight. This flattens the curl of a book page near the spine.

**Recognition.** RapidOCR runs the PaddleOCR PP-OCRv6 _small_ models on ONNX Runtime (CPU): a detection model finds the text lines, a text-direction model turns upside-down lines, and the multilingual recognition model reads each line, with Dutch diacritics (ë, é, ï) and a box and score per word. Pages are scaled to at most 2000 px on the long side. The models ship inside the `rapidocr` package (about 30 MB), so OCR works offline from the first start. RapidOCR reads Dutch, English, German, French, Spanish, Italian, Portuguese, Swedish, Danish and Polish; Tesseract reads Ukrainian, and every language when RapidOCR is not installed (grayscale, upscaling to a 2000 px long side, contrast stretch, page segmentation PSM 3). `KENNING_OCR_ENGINE` forces one engine.

**Reading order** (`rapid.py`). RapidOCR returns lines top to bottom across the page. A recursive XY cut puts them in order: a region is split at horizontal gaps of at least 0.9 line heights (paragraphs, boxes), else at vertical gutters of at least one line height (columns). Two columns are read one after the other; three or more columns, or a label column narrower than 20 % of the region, are a table and are read row by row.

**Lost spaces.** The recognition model sometimes drops a space. A token is split after sentence punctuation before a capital (`woning.De`), after `?` or `!` before a letter, after a digit before a capitalised word (`3Fietsen`), and around a short Dutch function word when the token is not a word itself and the rest is (`Komtu` → `Komt u`). There is no compound guess, so real compounds stay whole.

**Review flags** use each engine's own confidence: a known word is flagged when Tesseract's confidence is below 55 or RapidOCR's score below 70 (out of 100). RapidOCR's scores run higher and separate right from wrong words only weakly (at 70, about 1 % of correct words get a flag); most of its misreads are caught by the lexicon instead.

**Benchmark** (`server/nlp/scripts/ocr_bench.py`). Six pages of a scanned A2 textbook (reading text, word list, exercises, a menu table, a grammar table; 1,685 words transcribed by hand), each also as two synthetic phone photos: tilted with uneven light and blur, and the same with a page curl. Word error rate (WER), character error rate (CER), WER ignoring word order (bag), and seconds per scanned page on one CPU thread (the clean-up itself takes about 0.2 s):

| Variant                 | Scans WER / CER / bag | Photos WER / CER / bag | Curled WER / CER / bag | s/page |
| ----------------------- | --------------------- | ---------------------- | ---------------------- | ------ |
| Tesseract, raw image    | 24.7 / 21.0 / 3.7 %   | 37.9 / 30.0 / 16.3 %   | 48.8 / 36.5 / 20.0 %   | 1.4    |
| Tesseract, cleaned page | 24.7 / 21.0 / 3.7 %   | 28.4 / 24.4 / 17.9 %   | 35.5 / 31.4 / 21.4 %   | 1.4    |
| RapidOCR, cleaned page  | 4.8 / 2.5 / 1.7 %     | 5.4 / 2.6 / 2.1 %      | 8.1 / 5.2 / 2.4 %      | 6.7    |

Most of Tesseract's scan errors are reading order in tables and word lists; on photos it also loses whole boxes of text. The PP-OCRv5 Latin recognition model scored about the same as the bundled PP-OCRv6 model (4.4 / 2.9 / 1.2 % on scans) but missed one accent and needs a separate download.

After PDF and OCR extraction, `cleanup.py` repairs the text:

- It normalises Unicode, expands ligatures (`ﬁ` → `fi`, `ĳ` → `ij`), turns typographic quotes into ASCII, and removes soft hyphens and zero-width characters.
- **Headers and footers.** A line in the first or last 2 lines of a page is removed when it repeats (digits ignored) on at least half of the pages, and on at least 2 pages. Bare page numbers (`12`, `- 12 -`, `Pagina 3`, `iv`) are always removed.
- **De-hyphenation.** `woor-` + `den` → `woorden`. `Noord-` + `Amerika` stays hyphenated, because a capital follows. `land-` + `en tuinbouw` keeps the suspended hyphen.
- **Re-flow.** Hard-wrapped lines are joined into paragraphs. For OCR text without blank lines, a line that ends a sentence and is shorter than 60 % of the longest line (when that line is at least 40 characters) ends a paragraph. A paragraph that continues across a page break is merged.

### 2.8 Checking OCR text: which words get flagged

After a photo or scanned page is recognised, you can check the text before it is imported. Kenning underlines the words that may be misread (`ocr_review.py`). A word is flagged when:

- **Tesseract was unsure.** Its confidence for the word is below 55 %.
- **It is not a Dutch word.** It is not in the word-frequency list (Zipf ≥ 2), the dictionary or simplemma, and it does not split into two common words (`fietsenstalling`). A capitalised word in mid-sentence is treated as a name and stays quiet unless a fix is found or Tesseract was unsure. Numbers and short all-caps abbreviations are never flagged.
- **A hyphenation went wrong.** Two halves joined at a line end make no word, or a word stayed split (`groen-` … `ten`) when the halves together make one.
- **It is a rare short word that looks like a very common one.** For example `ln` next to `in`, or `dc` next to `de`.

**Suggestions** come from the mix-ups that print OCR typically makes: `rn` ↔ `m`, `cl` → `d`, `vv` → `w`, `l` / `I` / `1` / `i`, `0` → `o`, `ij` ↔ `y` / `ii`, `fi` ↔ `fl`, `c` ↔ `e`, accents (`e` → `é` / `ë`), a stray hyphen inside a word, and a lost space (`eenhuis` → `een huis`). Kenning applies up to two of these to the word and keeps only results that are real Dutch words. The commonest come first, and a candidate needing two changes ranks a little lower than one needing a single change. Suggestions that are far rarer than the best one are dropped. When the first letter itself was misread (`Iand`), the fix is capitalised only at the start of a sentence (`land`, or `Land` at the start of a sentence).

Each flag carries its position in the text and its box on the page, so the review screen can show the enlarged scan of the word next to the suggestions. Nothing is changed unless you accept a suggestion, type a fix, or press "Accept all suggestions".

---

## 3. Reading

### 3.1 Pages (segmentation)

**What.** A text is read page by page. A page is about 150 words and never cuts a sentence.

**How** (`packages/core/src/reading/segment.ts`). Sentences are added to the current page until one of these happens:

| Cut when …                                                                 | Threshold                           |
| -------------------------------------------------------------------------- | ----------------------------------- |
| the page is full                                                           | ≥ 150 words                         |
| the next sentence would overshoot, and the page is already half full       | > 1.33 × 150 words, and ≥ 0.5 × 150 |
| there is a paragraph break (a blank line), and the page is two-thirds full | ≥ 0.67 × 150 words                  |

A very long sentence stays whole, so a page can be longer than 150 words.

### 3.2 Word classification

**What.** Every token gets a label for the reader (`packages/core/src/reading/classify.ts`).

**How.**

1. Punctuation and other non-words → `nonword`.
2. The token is matched to a learner-model key (`matchToken` in `packages/core/src/match.ts`). The candidates are tried in this order: **contextual lemma** (`opbellen`), then **surface form** (`bel`, for decks that list inflected forms such as `kinderen`), then the **alternative lemmas** (`bellen`). The first key found in the model wins. Without a match, the key is the normalised lemma.
3. Proper nouns and numbers → `ignored` (`pKnown = 1`).
4. The key's state in the model gives the label: `known`, `learning`, `ignored`, or `new` (no entry, `unknown` or `seen`).
5. A **detached particle** (`op` in _bel … op_) copies its verb's label and key. It is not counted separately, so a separable verb counts once.

**Limits.** Multi-word deck entries (`op de hoogte`) are not recognised in the reader. The report tool `tools/anki-report` checks them, with a gap of up to 3 words. Words that are not in any deck, including function words like `ik` or `de`, are `new` with `pKnown = 0` until you mark them known or ignored.

### 3.3 Coverage

**Coverage** = sum of `pKnown` over the counted words ÷ the number of counted words. Non-words, ignored tokens and detached particles are not counted. A learning word with `pKnown = 0.4` contributes 0.4, not 1. Whole-text coverage is the word-weighted average over pages. The library labels texts by coverage (`bandOf` in `staircase.ts`):

| Coverage | Band        |
| -------- | ----------- |
| ≥ 0.98   | comfortable |
| ≥ 0.95   | stretch     |
| ≥ 0.90   | challenging |
| < 0.90   | weave       |

### 3.4 The graded-reading planner

**What.** For each page, the planner decides which unknown words to **introduce** (new words worth learning now), which to **gloss** (translate in passing and move on), and which familiar words to hide as **clozes** (fill-in blanks for active recall) (`packages/core/src/reading/plan.ts`).

**Introduce or gloss.**

1. Collect the page's unknown words: label `new` and `pKnown < 0.5`. Words that Anki already calls `learning` are not "new", even when overdue.
2. Rank them by `repeats on this page × Zipf frequency` (ties: more frequent, then alphabetical).
3. Work out the **frequency floor** for your level. Words within about the next 3000 frequency ranks after your vocabulary size are worth learning now:
   `zipfFloor = 7.6 − 0.9 · log10(vocabulary + 3000)`, clamped to [2.5, 5.0]. For example, vocabulary 1000 → 4.36 and vocabulary 8000 → 3.96.
   Your vocabulary estimate is the sum of `pKnown` over known and learning words, at least 200 (`estimateVocabulary` in `staircase.ts`).
4. Candidates are the words at or above the floor, then (to fill a larger budget) words between Zipf 3.0 and the floor. **Words below Zipf 3.0 (about rank 20,000 and beyond) are never introduced**, only glossed.
5. **Budget.** `B` new words per page of 150 words, scaled up for longer pages: `max(1, round(B × max(words, 150) / 150))` when there is at least one candidate. `B` defaults to 3. It comes from the **New words** setting (0 = none, a fixed number, or "auto", which follows the staircase in 3.6).
6. The top candidates within the budget are `introduce`. Every other unknown word is `gloss`. Introduced words are highlighted and listed in the end-of-text word review, where you can add them to Anki. Glossed words are only listed there if you ask for them.

**Clozes.**

| Rule                     | Value                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Max clozes per page      | ⌊number of sentences ÷ 2⌋                                                                                                    |
| Per sentence             | at most 1; never in the page's first sentence (you need context first)                                                       |
| Sentence length          | ≥ 6 words                                                                                                                    |
| Word state               | `known` or `learning` with `pKnown` in [0.6, 0.99]                                                                           |
| Excluded                 | function words (ADP, DET, PRON, CCONJ, SCONJ, AUX, PART, INTJ), names, numbers, detached particles, words of one letter      |
| Preference               | learning words first, then the shakiest recall: score = `(learning ? 1 : 0) + (1 − pKnown)`                                  |
| Must have a meaning hint | a cloze whose word has no gloss (Anki or dictionary) is turned back into a normal word (`dropUnhintableClozes` in `live.ts`) |

If a verb is blanked, its detached particle stays visible.

### 3.5 Translations dial, cloze hints and cloze credit

**Translations dial** (`packages/core/src/reading/help.ts`). In Gloss mode, a dial from 0 to 1 decides which words get an inline translation:

| Dial value | Translated                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| ≤ 0.05     | nothing                                                                                                               |
| ≤ 1/3      | words you have not studied (`new`, `gloss`, `introduce`); default 0.25                                                |
| > 1/3      | also known and learning words whose `pKnown` is below `(dial − 1/3) / (2/3) × 0.95`, which rises to 0.95 at full dial |

Clozes never get a translation from the dial; they show their meaning as a hint instead. Read mode shows no translations (click a word to see its meaning). Cloze mode shows only the clozes' meanings.

**Cloze hints and credit** (`packages/ui/src/Reader.tsx`, `apps/web/src/screens/ReaderPage.tsx`). Each blank has a help ladder: meaning (tooltip) → first letter and length → first half of the word → reveal. Answers are compared case-insensitively after Unicode normalisation. A missing accent (`een` for `één`) still counts, with a quiet note.

| Help used                       | Credit |
| ------------------------------- | ------ |
| none (the meaning hint is free) | 1      |
| first letter                    | 0.5    |
| half the word                   | 0.25   |
| revealed, or wrong              | 0      |

### 3.6 The staircase controller

**What it does** (`updateStaircase` in `packages/core/src/reading/staircase.ts`). When you finish a page, Kenning computes **cloze accuracy** (credit ÷ blanks shown) and **lookups per 100 words**, and nudges two values:

| Outcome                                                                  | Target coverage T        | New-word budget B |
| ------------------------------------------------------------------------ | ------------------------ | ----------------- |
| **Hard**: accuracy < 0.70 **or** > 6 lookups per 100 words               | +0.005                   | −1                |
| **Easy**: (accuracy ≥ 0.85 **or** no clozes) **and** < 2 lookups per 100 | −0.005                   | +1                |
| otherwise                                                                | unchanged                | unchanged         |
| Bounds                                                                   | [0.92, 0.99], start 0.98 | [1, 8], start 3   |

**What it drives today.**

- **B** is the new-word budget of the planner, when the New words setting is "auto".
- **T** is _not_ used by the non-AI planner. It is stored and is used only by the optional AI features: "Simplify this page" rewrites to T, and Converse aims at `max(0.9, T − 0.03)`.
- Neither value changes which texts you are offered. Text choice is up to you, guided by the coverage band.

---

## 4. Practice

Practice trains words you already study (Anki state `learning` or `known`) in context, and **never writes to Anki**. Results go to Kenning's own schedule, and every answer also counts as app evidence for the word (section 1.7).

### 4.1 Scheduling: FSRS per (word, skill)

**What.** Each (word, skill) pair has its own FSRS card. The skills are `recognition`, `recall`, `form`, `gender` and `listening`. Knowing _huis_ when you read it says little about typing it or knowing that it is _het huis_.

**How** (`packages/core/src/practice/schedule.ts`): the `ts-fsrs` library with its default parameters and **fuzz off**, so schedules are reproducible. A pair counts as "learned" once FSRS puts it in the Review state.

### 4.2 Grading an answer

`packages/core/src/practice/grade.ts` turns an attempt into an FSRS rating:

| Attempt                                                         | Rating |
| --------------------------------------------------------------- | ------ |
| wrong                                                           | Again  |
| correct, but letter hints gave away at least half the letters   | Again  |
| correct with some hints                                         | Hard   |
| correct multiple choice or word ordering (guessing is possible) | Good   |
| correct typed answer                                            | Good   |
| correct typed answer, no hints, in under 4 s                    | Easy   |

### 4.3 Checking answers (leniency)

`packages/core/src/practice/check.ts`:

- **Multiple choice**: exact match with the answer, after Unicode normalisation and trimming.
- **Typed words**: case-insensitive, whitespace collapsed, curly quotes normalised, punctuation at the edges ignored (`loopt.` = `loopt`). Any accepted variant counts (e.g. both auxiliaries for verbs that take `hebben` and `zijn`). A **missing accent is still correct**, with a note ("Mind the accents: één").
- **Word order and dictation**: as above, but all punctuation is ignored except apostrophes and hyphens inside words.

### 4.4 Exercise generators

`packages/core/src/practice/generate.ts`. Each generator returns an exercise, or nothing when the word lacks the needed data. In that case the session tries another kind.

| Exercise       | Skill       | Needs                                                           | How it is built                                                                                                         |
| -------------- | ----------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| meaning-choice | recognition | a gloss, ≥ 2 distractors                                        | Dutch word (with article for nouns) → 3–4 English meanings                                                              |
| word-choice    | recognition | a gloss, ≥ 2 distractors                                        | English meaning → 3–4 Dutch words; padded to 4 with vector neighbours (4.5)                                             |
| cloze-choice   | recognition | a sentence, ≥ 2 distractors                                     | sentence with `____` → choose the word; distractors are capitalised when the blank starts the sentence                  |
| cloze-typed    | recall      | a sentence                                                      | sentence with `____` and the English meaning as a hint → type the word as it appears in the sentence                    |
| gender         | gender      | a noun with `de` or `het`                                       | "de or het?", then a rule when one applies (`-je` → het; `-ment`/`-isme` → het; `-heid/-teit/-ing/-ie/-schap` → de)     |
| separable      | form        | a separable verb and a sentence where the particle stands apart | the real sentence among wrong builds: unsplit (_Ik opbel hem_), particle before the verb, particle right after the verb |
| perfect        | form        | participle and auxiliary                                        | `Ik ____ (lezen) — perfect tense` → `heb gelezen`, with subject `ik`, `hij` or `wij`                                    |
| verb-form      | form        | past or present forms                                           | "Put the verb in the past tense: lopen — wij ____" → `liepen`                                                           |
| adjective-e    | form        | an adjective whose inflected form differs                       | one of four templates: `een ____ huis` (no -e), `het ____ huis`, `een ____ man`, `de ____ man` (-e)                     |
| scramble       | form        | a sentence of 4–9 words                                         | shuffled words (first word lowercased so it does not give itself away) → put them in order                              |
| dictation      | listening   | none                                                            | text-to-speech of a sentence of ≤ 8 words containing the word, else the word itself → type what you hear                |

Word forms and the perfect-tense auxiliary come from Wiktionary (`server/nlp/src/kenning_nlp/wordforms.py`). Wiktionary records the auxiliary for only about 3 % of verbs. For the rest, Kenning uses how often the participle appears with `hebben` vs `zijn` in the Tatoeba corpus, then a curated list of `zijn` verbs, and defaults to `hebben`.

### 4.5 Choosing distractors

**Local pool** (`packages/core/src/practice/distractors.ts`). Wrong options come from the other words in the session:

- They must have the **same part of speech**, and must not be the word itself.
- **No synonyms.** A candidate is dropped if any of its glosses equals, contains or is contained in one of the answer's glosses, compared as whole words after removing parentheses, articles and "to" (`house` vs `house, home`). Otherwise there would be two right answers.
- They must have **similar frequency**: Zipf within ±1, widened step by step up to ±8 until there are enough.
- **Words you know come first**, so that the options are real words to you.

**Vector neighbours** (`server/nlp/src/kenning_nlp/similar.py`, `POST /similar`). When a word-choice exercise has fewer than 4 options, it is padded with related words from spaCy's word vectors:

| Rule                | Value                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vocabulary          | the 30,000 most frequent single-word dictionary headwords (nouns, verbs, adjectives, adverbs), Zipf ≥ 2.5                                                                                                       |
| Same part of speech | required                                                                                                                                                                                                        |
| Cosine similarity   | 0.3–0.7: related but not a near-synonym (wider pass: 0.2–0.8)                                                                                                                                                   |
| Frequency           | Zipf within ±1.0 (wider pass: ±1.5)                                                                                                                                                                             |
| Excluded            | words containing the query or contained in it (`huis` / `huisarts`); words sharing an English gloss with the query, after mapping a few English synonym groups (`house/home/dwelling`, `happy/glad/content`, …) |

The app checks the synonym rule again with its own dictionary before using a neighbour, and only uses neighbours whose meanings are known.

### 4.6 Example sentences

**Where they come from**, best first (`packages/core/src/practice/sentences.ts`, `apps/web/src/services/livePractice.ts`):

1. **Your Anki card's example sentence**, if the word can be found in it: as the lemma, a form from Wiktionary, or a regular ending (`-s/-en/-je` for nouns, `-e` for adjectives, `-t/-te/-ten/-de/-den` and `ge…d/t` for verbs). There is no prefix guessing: _Zij_ is not _zijn_, and _manier_ is not _man_.
2. **Your own texts**: up to 3 sentences of 4–16 words, from your 15 most recent analysed texts.
3. **Tatoeba** (CC BY 2.0 FR) through `POST /sentences`, for words that have fewer than 2 sentences so far: up to 2 sentences of at most 14 words.

**Ranking.** A sentence of 5–15 words always beats one outside that range (scramble uses 4–9, dictation 3–8). Ties go to Anki, then your texts, then Tatoeba. A cloze skips sentences where the word appears twice.

**How "easy" Tatoeba sentences are chosen** (`server/nlp/src/kenning_nlp/sentences.py`). Each stored sentence (3–25 words, ≤ 160 characters, no URLs or markup) gets a difficulty score: 0.5 per word, +2.0 per rare word (Zipf < 3), and +2.0 if it has fewer than 4 words. The lowest scores come first.

**Limits.** This approximates "i+1" (a sentence where only the target word is new) with **general word frequency, not your own learner model**. A Tatoeba sentence can still contain a common word that you have not learned.

### 4.7 Building a session

`packages/core/src/practice/session.ts`, `apps/web/src/services/livePractice.ts`:

| Step          | Rule                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Word pool     | due words, then never-practised learning words (shakiest first, in 0.1-wide recall bands, random within a band), then other learning words, then known words: up to `min(120, max(60, 3 × size))` words     |
| Size          | 20 exercises by default                                                                                                                                                                                     |
| 1. Due pairs  | most overdue first                                                                                                                                                                                          |
| 2. New pairs  | at most `max(⌈0.4 × size⌉, size − due)`. Ordered learning → known → seen → unknown, then lower `pKnown`, then more frequent. Round-robin: every word gets its first new skill before any word gets a second |
| 3. Filler     | if still short: pairs that are not yet due, soonest first                                                                                                                                                   |
| Exercise kind | per skill, the least-used kind so far that the word supports                                                                                                                                                |
| Order         | never the same word twice in a row; alternating skills where possible                                                                                                                                       |

---

## 5. Grammar detectors

**What.** `POST /grammar` finds grammar constructions in a text and underlines the tokens involved, with a one-line explanation (`server/nlp/src/kenning_nlp/grammar.py`). The grammar screens in the web app are being built; this section describes the server side only.

**How.** Each detector reads one analysed sentence: part of speech, morphology (e.g. `VerbForm=Part`, `Tense=Past`, `Degree=Cmp`), dependency relations (`nsubj`, `mark`, `aux`, `compound:prt`, …) and the separable-verb links from section 2.3. It never reads the raw text, so it also works on analyses that the app has already stored. Some examples:

- **Inversion**: a finite verb in the main clause comes before its subject because something else stands first. It does not fire for questions, exclamations, quotations, or when a subject already stands in front (that is parse noise).
- **Subordinate clause**: a subordinating conjunction (`omdat`, `dat`, `als`, `toen`, …) with a subject after it and the finite verb at the end, where only the rest of the verb cluster may follow the verb.
- **Perfect tense**: finite `hebben`/`zijn` plus a past participle. Passives (`aux:pass`) are excluded, and `zijn` + participle only counts for verbs of motion or change (_gaan, komen, vallen, …_), because _is gesloten_ is usually a state.

**Topics (22).** inversion · questions · subordinate clauses · separable verbs · perfect tense · modal verbs · imperfect (simple past) · future (`zullen`/`gaan` + infinitive) · reflexive verbs · `om … te` + infinitive · `te` + infinitive · adjective inflection (-e) · comparison · negation (`niet`/`geen`) · demonstratives · `er` (existential, quantitative, prepositional, place) · relative pronouns · de/het (diminutives are always `het`) · plural nouns · imperative · indirect speech · conjunctions (`en/maar/want/of`).

**Precision over recall.** A detector fires only when the parse and the word forms agree. A missed example costs nothing; a wrong underline teaches the wrong thing. One construction gives one hit, but a token may belong to hits of several topics.

**Example cache** (`grammar_examples.py`, `GET /grammar/examples`). The Tatoeba sentence database is indexed by word, not by construction. To find sentences "with an inversion", the detectors are run over sentences of 5–14 words, in a fixed pseudo-random order, so rare constructions turn up as early as common ones. Each request scans batches of 128 sentences until the topic has enough examples or a 4-second budget is spent. Up to 40 examples per topic are cached, and the best (lowest difficulty score) are returned, 10 by default. The cache is discarded whenever `grammar.py` changes (it stores a hash of the file).

### 5.1 Word-form explainer

**What.** "Why is this word like this?" for any word in the reader, not only the ones a detector marked. `explainWord(tokens, index, { hits, article })` in `packages/core/src/reading/explain.ts` returns short plain-English notes, each with the id of its grammar page, plus a word-order line when the word is a finite verb. It runs in the browser on the stored analysis (lemma, POS, morph, dependency tree of the clicked word's sentence), so it needs no server call. The inspector's "Grammar of this word" section (`apps/web/src/screens/reader/WordGrammar.tsx`) shows up to three notes and the order line, then the detector notes of topics the explainer did not cover; more lines and the topic rules sit under "More about this word".

**Rules** (spaCy features in brackets):

| Word                             | Notes                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finite verb, past (`Tense=Past`) | weak if the form is stem + -te/-de(n) and the ending agrees with 't kofschip (stems are compared after undoubling vowels/consonants and f→v, s→z: _woonde → wonen_, _leefde → leven_); otherwise irregular (strong). `zou` is explained by its role.                                                                                                                                      |
| Finite verb, present             | modals and _zijn/hebben_ get their forms; plural = infinitive; with the subject (`nsubj`, or the head's for aux/cop): _ik_ → stem; _jij/je_ after the verb → no -t; otherwise stem + -t, -dt when the stem ends in d, no extra t when it ends in t. No subject, first word, not a question → imperative. Every claim is checked against the form (a -t is only explained if it is there). |
| Separable verb                   | a particle (`compound:prt` or `particle_of`) gives "bel … op = opbellen"; the particle itself says which verb it belongs to.                                                                                                                                                                                                                                                              |
| Participle (`VerbForm=Part`)     | particle + ge + stem + -t/-d (weak, 't kofschip), -n (strong), irregular (-cht and others), no ge- after be-/ver-/ont-/her-/ge-; with its auxiliary: perfect (_hebben/zijn_, saying why: zijn for a change of place or state, hebben otherwise; movement verbs like _fietsen_ depend on a goal), past perfect, passive (`aux:pass`).                                                      |
| Infinitive                       | te / om … te (`mark`), modal + infinitive, zullen + infinitive (future), zou + infinitive (conditional), present gaan + bare infinitive (near future), laten + bare infinitive, zijn + aan het + infinitive (progressive, also on «aan» and «het»).                                                                                                                                       |
| Noun                             | diminutive (-je/-tje/-pje/-etje, always het), plural -en / -s / -'s / -eren, else de/het from the dictionary article or `Gender`.                                                                                                                                                                                                                                                         |
| Adjective                        | comparative (-er/-der), superlative (-st); before a noun: -e after a definite word or possessive, before a plural, before a de-word; no -e for a het-word with een/geen/no article or an -en adjective; after the verb or as an adverb: no ending.                                                                                                                                        |
| Pronoun                          | subject, object (after a preposition), possessive, reflexive (`Reflex=Yes`/`expl:pv`), relative, demonstrative, question word.                                                                                                                                                                                                                                                            |
| Others                           | er/daar/hier/waar + preposition (also split, from the detector hit), te/om, subordinating and coordinating conjunctions, articles, geen.                                                                                                                                                                                                                                                  |
| Word order (finite verb)         | subordinate (SCONJ `mark`) or relative clause (`acl:relcl`) → verb last; main clause: yes/no question, question word first, imperative, V2 (only subject words before the verb) or inversion (something else first, subject after the verb; a whole fronted clause is named as such). Coordinated or embedded clauses without a mark get no line.                                         |

**Precision first.** A rule fires only when the form agrees with the analysis; when it does not (a wrong lemma, a -t with _ik_, a lemma that is not an infinitive), the note is dropped and the word gets just "lemma: part of speech", with "words like this do not change form" for adverbs, prepositions and conjunctions. Known parser errors still leak through: spaCy reads _De kinderen spelen buiten_ as separable _buitenspelen_, and gives _nagedacht_ the lemma _nadachten_ (the explainer then calls it an irregular participle of that lemma).

**Tests.** `explain.test.ts` checks 87 word/sentence pairs against analyses captured from the NLP server (`fixtures/word-grammar.nl.json`, 69 sentences); a web test checks that every linked topic id has a page.

---

## 6. What Kenning writes to Anki

Kenning reads Anki freely but **writes only when you click** a button for one word (`packages/anki/src/actions.ts`, `packages/anki/src/note.ts`). Every write is tagged, so you can find and undo it in Anki's browser.

| Button                               | Shown when                          | What happens in Anki                                                                                                                                                                                    | Tag                |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Add to Anki**                      | the word is not in your decks       | A note of type **Kenning Word** (fields: Word, Gloss, Sentence with the word in bold, SentenceTranslation, Source) in the target deck, `Kenning::Nederlands` by default. No duplicate within that deck. | `kenning` (+ `nl`) |
| **Study first in Anki** (learn next) | the card is new (even if suspended) | The card is unsuspended and moved to the front of its deck's new queue. Other cards are not shifted, which would force a full sync. Needs AnkiConnect's v1 API.                                         | `kenning::reading` |
| **Mark known**                       | any state, or not in Anki           | (Adds the note first if needed.) Unsuspends the card and sets its interval to a random 21–35 days (`setDueDate "21-35!"`), so it reads back as mature, and therefore known.                             | `kenning::known`   |
| **Use Anki's state**                 | after a manual mark                 | Nothing in Anki. Only the app-side mark is removed.                                                                                                                                                     | —                  |

Kenning **never** answers cards, writes review history, changes FSRS parameters, or touches cards you study in any way other than through Mark known. Practice, cloze and book-exercise results stay in Kenning (they feed the learner model, section 1.7). All four buttons are one shared command layer (`packages/anki/src/profile.ts` `addWordToAnki`, `packages/anki/src/commands.ts`: `studyWordFirst`, `studyWordsFirst`, `markWordKnown`, `resetToAnkiState`, `setAppWordState`) with one key rule (`wordKey`). In the app, Learn next is labelled **Study first in Anki**. Until Anki has reviews for an added or moved card, the reader treats the word as `learning` with `pKnown = 0.2` (section 1.6).

---

## 7. Worked example: "Ik bel je morgen op."

This is the real output of the pipeline for this sentence (`analyze_texts`, with the dictionary installed; Zipf values from wordfreq 3.1.1):

| #   | Token  | Lemma        | Alternatives | POS   | Dependency           | Particle of | Zipf |
| --- | ------ | ------------ | ------------ | ----- | -------------------- | ----------- | ---- |
| 0   | Ik     | ik           |              | PRON  | nsubj                |             | 7.11 |
| 1   | bel    | **opbellen** | bellen       | VERB  | ROOT                 |             | 2.74 |
| 2   | je     | je           |              | PRON  | obj                  |             | 7.04 |
| 3   | morgen | morgen       |              | ADV   | advmod               |             | 5.31 |
| 4   | op     | op           |              | ADP   | **compound:prt** → 1 | **1**       | 7.12 |
| 5   | .      | .            |              | PUNCT | punct                |             | 0    |

spaCy attached `op` to `bel` as a particle, so rule 2.3(a) joined them into `opbellen`. The grammar detector reports _separable verbs_ on tokens 1 and 4: "«bel»…«op» is one verb: «opbellen», with the particle split off."

**Is it known?** The reader tries the keys `opbellen`, then `bel`, then `bellen`.

- **Your deck has `opbellen`.** Say it is an SM-2 card with a 30-day interval, last reviewed 10 days ago. Then `p = 0.9^(10/30) ≈ 0.965`. The card is mature (≥ 21 days) and `p ≥ 0.6`, so the word is **known**. With FSRS (stability 40 days) you get `R = (1 + (19/81)·10/40)^(−0.5) ≈ 0.972`, also known. If the same SM-2 card had not been reviewed for 400 days, `p ≈ 0.245` and the word would be back to **learning**.
- **Your deck only has `bellen`.** The alternative lemma matches, so _bel … op_ gets the state of `bellen`. This is a known limit: knowing the base verb is counted as knowing the separable verb.
- **Not in Anki.** The word is `new` with `pKnown = 0`. Its Zipf of 2.74 is below the absolute floor of 3.0, so the planner **glosses** it and never spends the new-word budget on it. In Gloss mode, with the dial above 0.05, the reader shows "to call (up) (to contact by telephone)" inline on _bel_, and the particle `op` gets no separate gloss.

**Coverage.** Four tokens are counted: _Ik, bel, je, morgen_. `op` is a detached particle, and `.` is not a word. If _ik, je, morgen_ are known with `pKnown ≈ 1` and _opbellen_ is not in Anki, the sentence's coverage is about 3/4 = 0.75.

**Clozes.** None here. The sentence has only 5 words (clozes need at least 6), and if it opens a page it gets none anyway.

---

## 8. Where AI is optional

Everything above (deck detection, the learner model, lemmatisation, separable verbs, derivation and compound glosses, meanings read off the sentence translation, the dictionary, offline sentence translation, OCR and cleanup, the reading planner, clozes, the staircase, practice scheduling and exercises, distractors, grammar detection, and Anki writes) runs **without any AI provider or API key**. The two models involved (spaCy and OPUS-MT) are small, local and deterministic for a given input. They never generate free text about you or for you.

AI features are opt-in extras, hidden until you configure a provider: Converse, Explain this sentence and Simplify this page. See [ai.md](ai.md) for what they do, which providers work and what is sent.
