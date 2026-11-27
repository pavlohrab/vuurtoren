# How Vuurtoren works (no AI needed)

This page explains the algorithms behind Vuurtoren's reader, flashcards, practice and Anki support. None of them uses a language model. They are deterministic rules, a few statistics and two offline tools: spaCy for Dutch analysis and a small translation model. The numbers below are copied from the code, and each section names the files it describes, so you can check them.

## In plain words

Vuurtoren keeps a number for every Dutch word you meet, which says how likely you are to remember it right now. It gets this number from your cards, from Anki or from Vuurtoren itself, and from what you do in the app.

When you add a text, a language tool on your computer goes through it and finds the words and the grammar in every sentence. Then the text is split into pages of about 150 words, and every page is planned with your numbers in mind. A few new words that are worth learning stay in Dutch, the other words you don't know get a translation, and if you want, some words you already know turn into blanks so you can practise them.

While you read, Vuurtoren looks at how often you tap a word to look it up and how many blanks you get right. If it goes well, the next pages get a few more new words, and if not, fewer. None of this uses AI, and all of it runs on your computer.

Every section below starts with a short version like this one, and then goes into the rules and the numbers.

Contents

1. [Your words → learner model](#1-your-words--learner-model)
2. [Dutch analysis (NLP service)](#2-dutch-analysis-nlp-service)
3. [Reading](#3-reading)
4. [Practice](#4-practice)
5. [Grammar detectors](#5-grammar-detectors)
6. [What Vuurtoren writes to Anki](#6-what-vuurtoren-writes-to-anki)
7. [Worked example: "Ik bel je morgen op."](#7-worked-example-ik-bel-je-morgen-op)
8. [Where AI is optional](#8-where-ai-is-optional)
9. [Native mode: Vuurtoren's own cards](#9-native-mode-vuurtorens-own-cards)
10. [Sync](#10-sync)

---

## 1. Your words → learner model

**In short.** For every word Vuurtoren keeps one number, the chance that you remember it right now. It reads this from your cards, either your Anki decks or its own cards, and it can raise it a bit when you answer a word right in its exercises. Everything else in the app is decided from these numbers, like which words to teach you, which ones to translate and how hard a text will be for you.

Your cards are the record of which Dutch words you know. They are Vuurtoren's own cards in native mode (section 9), or your Anki decks in connected mode, and both are read with the same rules. This section describes the Anki side, and section 9.4 applies it to Vuurtoren's cards. Vuurtoren reads your decks (read-only) and builds a **learner model**. For every word key it holds a state (`unknown`, `seen`, `learning`, `known`, `ignored`) and `pKnown`, the probability that you would recall it right now.

### 1.1 Finding your Dutch decks and fields

**What.** Vuurtoren works out which decks hold Dutch vocabulary, and which field of each note type holds the word, the example sentence, the English meaning and the sentence translation. You do not have to configure this.

**How** (`packages/anki/src/snapshot.ts`, `packages/anki/src/detect.ts`):

1. Every deck with at least 10 notes is sampled: up to 30 random notes per deck. Smaller decks are skipped unless you named them, or unless it is Vuurtoren's own target deck.
2. Field values are cleaned of HTML, `[sound:…]` tags, cloze markup and furigana (`packages/anki/src/clean.ts`).
3. Every cleaned value goes through language identification (`server/nlp/src/vuurtoren_nlp/detect.py`). This is a small naive-Bayes classifier over the `wordfreq` "small" word lists of 10 languages (nl, en, de, fr, es, it, pt, pl, and uk and ru after a Cyrillic-script check). Each word scores its log-frequency per language. A word missing from a list scores a floor plus a character-trigram estimate learnt from that list, so rare words still lean the right way. Only the first 400 characters are examined, and a result with confidence below 0.2 counts as "unknown language".
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

**How** (`analyze_terms` in `server/nlp/src/vuurtoren_nlp/pipeline.py`):

- Alternatives are split on `,` `;` `|` and on `/`. A slash between two function words (`en/of`, `dan/wel`) is kept whole.
- Bracketed parts are removed. `(zich)` marks the word as reflexive. Everything after `-` or `=` (a gloss pasted into the word field) is cut off.
- A leading article is removed and remembered: `de`/`het` becomes the word's article. Fixed expressions such as `de facto` keep it. `het of de cement` accepts both genders.
- A leading `zich` is removed and marks the word as reflexive.
- **The key is the headword itself, not a lemma.** A vocabulary deck already lists citation forms, and lemmatising an isolated word is unreliable (spaCy turns `vragen` into `vraag` and `geleden` into `lijden`). spaCy only supplies the part of speech.
- The other alternatives become **aliases**. They share the card's knowledge.

### 1.3 Key normalisation

A key from a card and a key from a text must match, so they are normalised the same way. One rule is used everywhere, in TypeScript (`normalizeKey` in `packages/core/src/match.ts`) and in Python (`normalize_key` in `pipeline.py`). It applies Unicode NFKC, turns curly quotes and backtick into `'`, lowercases (not casefold, so `ß` stays `ß`), and trims whitespace.

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

**Limits.** The FSRS curve always uses decay 0.5 (FSRS-4.5/5). The code supports a per-preset FSRS-6 decay, but the Anki reader does not fetch it. The SM-2 estimate is an approximation, not Anki's own retrievability.

### 1.5 Merging decks

If the same key comes from several notes (two decks, a forward/reverse pair, or an alias), the **strongest evidence wins**, in the style of AnkiMorphs (`mergeKnowledge` in `packages/core/src/memory.ts`). States rank `ignored > known > learning > seen > unknown`. Between equal states, the higher `pKnown` wins. The first gloss, article and example sentence found for the key are kept. A sentence translation is only kept when the sentence and translation fields have the same number of sentences, so a half-translated field cannot mislead.

### 1.6 Manual marks and app-side states

What you do in the app is stored as events in Vuurtoren's local database, never as edits to Anki's history. So a word's state can come from several places, and `composeWord` in `packages/db/src/projections.ts` picks the effective one in this order:

| Priority | Source                                                                        | State and `pKnown`                                                                                                     |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1        | Manual mark in the app (latest one wins, by clock)                            | known: `max(Anki pKnown, 0.95)` · learning: Anki's value if Anki also says learning, else 0.3 · ignored: 1 · seen: 0.1 |
| 2        | Anki snapshot                                                                 | as computed above                                                                                                      |
| 3        | A note that Vuurtoren added or moved forward, which Anki has not reviewed yet | learning, 0.2                                                                                                          |
| 4        | You only looked the word up in the reader                                     | seen, 0.1                                                                                                              |

"Use Anki's state" removes the manual mark. It is stored as an empty mark, so the latest-wins rule still works when events sync out of order.

Below the manual mark, **app evidence** (section 1.7) is laid over rows 2–4 and over words Vuurtoren only knows from your answers.

### 1.7 Learning in Vuurtoren (app evidence)

**What.** What you show inside Vuurtoren teaches the same learner model the reader and the Words list use. Mastering a word in Practice, filling it into reader clozes or answering it in a book exercise raises it, even before Anki has seen it. Anki stays the record of known words: app evidence never makes a word `known` and never lowers what Anki says.

**Signals** (`packages/core/src/evidence.ts`, `packages/db/src/projections.ts`):

| Event                  | Where                                            | Counts as                                                                                                                                                        |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExerciseAnswered`     | every practice exercise                          | 1 correct or 1 wrong for the word's key                                                                                                                          |
| `ClozeAnswered`        | the first answer per reader blank and page visit | 1 correct (0.5 after a letter hint), or 1 wrong (also when the hints revealed the whole word)                                                                    |
| `BookExerciseAnswered` | a marked book item, with the word keys it tests  | 1 correct or 1 wrong per key (the bracketed lemma hint, else the answer's words that are unit or learner-model words; none for sentence building and open tasks) |

**How.** The projection `word_evidence` keeps four things per (language, key): the weighted correct count `c`, the wrong count `w`, the time of the newest answer, and whether it was correct (a tie goes to "wrong"). Sums and maxima do not depend on the order events arrive in, so replays and late arrivals give the same table. At read time, with the current clock:

```
pApp = 0.8 · c / (c + w + 1) · 0.5^(days since the newest answer / 30)     (× 0.5 if the newest answer was wrong)
```

| Base state (after the manual mark, Anki, pending note, lookups) | Effect of app evidence                                                                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| manual mark (any)                                               | none: your explicit choice wins                                                                                                                                                                                  |
| `known`, `ignored`                                              | none: app evidence never demotes                                                                                                                                                                                 |
| `learning`                                                      | `pKnown = max(base, pApp)`                                                                                                                                                                                       |
| `unknown`, `seen`, or nothing                                   | `pKnown = max(base, pApp)`; the state becomes **`learning`, shown as "Learning (in Vuurtoren)"**, when `c ≥ 3`, the newest answer was correct and `pApp ≥ 0.5`. A word met only in exercises is otherwise `seen` |

| Constant                   | Value | Why                                                                                            |
| -------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| `APP_MAX_P`                | 0.8   | below "known" (mature Anki cards and manual marks reach 0.9+), inside the cloze range 0.6–0.99 |
| `APP_HALF_LIFE_DAYS`       | 30    | evidence fades if you stop answering; Anki's own schedule takes over                           |
| `APP_LEARNING_MIN_CORRECT` | 3     | one lucky answer is not learning; one pseudo-miss caps a single correct answer at 0.4          |
| hinted cloze weight        | 0.5   | same as the cloze credit (section 3.5)                                                         |

So three unaided correct answers today give `pKnown = 0.6`. The word then counts as "Learning (in Vuurtoren)", adds 0.6 to coverage and can become a cloze. Two months later, with no new answers, it is back to Anki's state with `pKnown ≈ 0.15`. Nothing is written to Anki, so to make the word a card, use Add to Anki or Study first in Anki.

**Limits.** In connected mode, exposure while reading (a word read without a lookup) is not evidence. Practice FSRS states are kept separately for scheduling exercises (section 4.1), and only right/wrong feeds the learner model. In native mode reading, blanks and Practice also reach the word's card (section 9.5.1).

---

## 2. Dutch analysis (NLP service)

**In short.** Before you read a text, spaCy (a language tool that runs on your computer) splits it into sentences and words. It finds the dictionary form of every word and what kind of word it is, and it puts separable verbs back together, so _bel … op_ is read as _opbellen_. The meanings come from a dictionary built from open data, and a small translation model translates every sentence. Nothing leaves your computer.

Vuurtoren's Python service (`server/nlp`) analyses texts and Anki headwords with the **same** pipeline. It runs locally, for example in Docker, and sends nothing to third parties.

### 2.1 The spaCy pipeline

**What.** Each text is split into tokens. Each token gets a part of speech, morphology, a dependency relation, a sentence number, a lemma with alternatives, a word frequency and, for split separable verbs, a link from the particle to its verb (`particle_of`).

**How.** `nl_core_news_md` (spaCy's medium Dutch model) does tokenisation, tagging, parsing and a first lemma. Word frequency is the **Zipf** value from the `wordfreq` package, for the lemma, or for the surface form when the lemma is unknown (`server/nlp/src/vuurtoren_nlp/freq.py`). About 7 is very common and 1 is rare. Punctuation, numbers and symbols are not words (`is_word = false`).

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
- **Only real verbs are joined.** The parser often marks a word as a particle when it isn't one. In _Dat moet weg_ it would join _moet_ and _weg_ into _wegmoeten_, a verb that doesn't exist, and in _Eerst deed zijn vinger pijn_ it would make _pijndoen_. So a join is kept only when the joined verb is a real word: in the dictionary, or in the OpenTaal word list, the free Dutch spelling list (`_joinable` in `pipeline.py`). OpenTaal is there because English Wiktionary misses many common separable verbs, such as _meegeven_, _wegblijven_ and _instromen_; `scripts/build_compound_verbs.py` keeps the 58,000 verbs the check needs. Then _Dat moet weg_ stays _moeten_, and its dictionary meaning "must go" fits the sentence. Without any dictionary the parser decides, as before.
- **Circumpositions are not particles.** In _Ze ging naar hem toe_ the word _toe_ belongs to _naar_, not to the verb, so it is _gaan_ and not _toegaan_. The same holds for _om … heen_, _door … heen_, _op … af_, _van … af_, _van … uit_ and _achter … aan_, when the first word comes at most four words before and no verb sits in between (`_circumposition`).
- **One particle per verb.** In _Zijn moeder helpt hem met zijn broek uit en zijn pyjama aan_ the parser hangs both _uit_ and _aan_ on _helpt_, and the old rule made _aanhelpen_. But a verb has one particle. Two mean a verb was left out (_uit(doen)_, _aan(doen)_), so neither is joined and it stays _helpen_. A circumposition word doesn't count here.
- **A past tense read as present.** The parser sometimes calls a plural past tense a present (_Ze pleegden een overval_, _wierpen_). A plural present looks like the infinitive, so it keeps its own form as the lemma, and _pleegden_ stayed _pleegden_. Now a plural present must be a verb with meanings of its own in the dictionary (_lopen_, _weten_). When its only entry says "inflection of plegen", it's a past tense and gets _plegen_ (`_past_read_as_present` in `pipeline.py`).

There are 39 separable particles (`aan`, `af`, `bij`, `door`, `in`, `mee`, `op`, `uit`, `terug`, `weg`, …).

### 2.4 Words the dictionary does not have: derivations, compounds, the sentence

**What.** Dutch builds new words from old ones: with affixes (`woord` + `-loos` = `woordeloos`, "wordless") and by writing compounds as one word (`souvenirwinkel`). When a word has no dictionary entry, Vuurtoren builds its meaning from its parts, and failing that takes the English it became in the translation of its sentence.

**Which meaning wins.** Vuurtoren tries the sources in this order and takes the first that gives a meaning (`Dictionary.lookup` in `dictionary.py`, and the app adds the sentence):

1. a dictionary entry, for the word or a form of it;
2. a diminutive or plural of a known noun (`vriendinnetje` → `vriendin`);
3. a derivation;
4. the sentence, when its alignment is confident;
5. a compound;
6. a less confident alignment.

A confident alignment beats a compound guess because on the test set below it is right far more often (29 of 33, against 11 of 48 on the same words). A derivation loses to a compound only when the compound's parts are plain dictionary words and its head already contains the suffix. So `berglandschap` is `berg` + `landschap`, not `bergland` + `-schap`, and `brandgevaarlijk` is `brand` + `gevaarlijk`. When nothing at all resolves, a derivation of a compound is tried (`vastgoedmakelaar` + `-ster`).

**Derivations** (`server/nlp/src/vuurtoren_nlp/derive.py`). Each affix knows which bases it takes and how to say the result in English:

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

Dutch changes the spelling of a base when a suffix follows, so a base is looked up with those changes undone. They are a linking `e`, `s`, `en` or `er` (`woord-e-loos`, `verkeer-s-loos`), an undoubled consonant (`rott-ig` → `rot`), a long vowel written single in an open syllable (`slap-e-loos` → `slaap`, `drie-tal-ig` → `taal`), and `v`/`z` for `f`/`s` (`slav-en-dom` → `slaaf`). Before a suffix that starts with a vowel, a verb base is the infinitive minus `-en` (`lez-er` → `lezen`). Before a consonant it is the present stem (`lees-baar` → `lezen`). Bases may be derived themselves, two levels deep (`on-` + `verdedigen` + `-baar` → undefendable).

A word can often be read in more than one way. Every reading that resolves is scored by the length of its base, minus 1 for an inflected base, 3 for a derived base, 6 for a compound base and 1 for a linker, and the highest score wins. The base's English is its first one-word sense (`"without feeling; numb"` → numb), and English spelling rules form the result (`use` → usable, `happy` → happiness, `stop` → stopping, `translate` → translator). Suffixes are never compound heads, so `woordeloos` is not read as `woord` + `loos` (the plural of `loo`).

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

The compound takes the article of its head (`de souvenirwinkel` because `de winkel`). Its meaning is the English of each part, e.g. **souvenir shop**. Each part's English is its first sense of at most 3 words, and when no sense is that short, the Dutch lemma is used. A plural head is pluralised, and a female head comes first (`zwaardvechtster` → female sword fighter).

**Where a guess came from.** `/gloss` marks these entries with `origin` (`derivation` or `compound`) and `formed` (`woord + -loos`, `souvenir + winkel`). The word inspector shows the note after the meaning, small and muted: "wordless · from woord + -loos". In Gloss mode a guessed meaning is lighter and italic, with the note in its tooltip.

**The sentence** (`align.py`, `POST /translate/align`). When nothing else works, the translation of the sentence can say what the word means there. OPUS-MT's decoder attends to the source subwords it is translating, and CTranslate2 returns that attention for the best translation. A target word belongs to the Dutch word when one of its subwords attends most to one of the Dutch word's subwords. Neighbouring target words form runs. The run that gives the Dutch word the most attention wins, trimmed of articles, possessives, `to` and the like at its edges, and with at most 3 words. A word copied unchanged from the Dutch is not a meaning. Attention alone hardly separates right from wrong, so the word is also translated on its own, and the alignment is confident only when the two share an English word stem.

The app shows this meaning marked "in this sentence". A confident one comes before a compound guess, which then stays as the second meaning. After a derivation it is a second line, when it differs ("speechless · in this sentence"). A less confident one is used only for a word with no other meaning. Words the dictionary knows are never aligned. The alignment request also returns the sentence translation, so the inspector needs no second request.

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
- **Your Anki card's gloss always comes first.** The inspector shows up to 6 meanings. The gloss next to a word in the reader is one meaning, and the sentence picks it (`apps/web/src/services/contextGloss.ts`). The sentence is translated and aligned, and the meaning whose English shows up in that translation wins, from the Anki gloss and the dictionary senses, or the aligned English itself when it is confident and none of them fits. When a meaning fits, the page shows it the way the sentence says it: in _zegt de burgemeester_ the gloss is "says", not "to say, to tell". Without a fit it shows one meaning, the first, never a list; the word sheet still has them all. Possessives ("zijn hond" is "his dog") come from a small grammar table, and names and diminutives count as their own words. Without a translation, it is the Anki gloss, or else the first real dictionary sense for that part of speech.
- **de/het**: Wiktionary sense tags `neuter` → `het`, `masculine`/`feminine`/`common-gender` → `de`, both → `de/het`. The article from your Anki headword (`de fiets`) takes precedence over the dictionary.

**Limits.** Without the dictionary file, glosses fall back to your Anki glosses only, and lemma choice falls back to `simplemma`. Wiktionary coverage of rare and very new words varies.

### 2.6 Offline sentence translation (OPUS-MT)

**What.** A machine translation of the sentence a word appears in. It is shown in the word inspector, saved with a new Anki card as `SentenceTranslation`, and shown beside each sentence in Side by side (section 3.7).

**How** (`server/nlp/src/vuurtoren_nlp/translate.py`): the Helsinki-NLP `opus-mt-nl-en` model, run with CTranslate2 on the CPU, weights stored as int8 (converted from the original Marian release by `scripts/fetch_mt_model.py`), beam size 4. It is a small (about 85 MB, the `mt-nl-en` data pack) neural MT model that runs offline. It is not a chat model and never sees anything but the sentence. The same model gives the meaning of a word the dictionary does not know in its sentence (section 2.4).

**Numbers.** Input up to 1024 subword tokens, output up to 512. Per request: at most 64 texts, 2,000 characters each, 20,000 characters in total (`models.py`). Only Dutch → English. Without the model the feature is quietly unavailable.

### 2.7 Getting text in: OCR, PDF and URL cleanup

**What.** A text comes in from a web address, a PDF or a photo. Each kind has its own way in, described below, and after that one clean-up step repairs the text the same way for all of them.

| Input            | How                                                                                                                                                                             | Numbers                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **URL**          | `trafilatura` extracts the main article (no comments, no tables, precision mode) (`extract_url.py`). Only public IP addresses are fetched.                                      | ≤ 5 redirects, 10 s timeout, ≤ 5 MB, needs ≥ 40 characters of text                             |
| **PDF**          | Text layer through PDFium (`pdf.py`), judged page by page. A page whose text layer is missing, nearly empty or not Dutch is read by OCR; the other pages keep their text layer. | ≤ 300 pages, ≤ 60 of them OCR'd; OCR when a page has < 40 letters/digits or < 70 % Dutch words |
| **Photo / scan** | Page clean-up, then RapidOCR (`straighten.py`, `rapid.py`, `ocr.py`). See below.                                                                                                | PDFs rendered at 300 DPI                                                                       |

**Text layer check.** A PDF page keeps its text layer when it has at least 40 letters and digits and at least 70 % of its words (the first 300 words of two or more letters) are Dutch words in the server's lexicon: wordfreq (Zipf ≥ 2), the dictionary, simplemma, or a two-part compound of known words. Pages with fewer than 12 words are not judged by that share. Real Dutch pages score 0.97 to 1.0; broken font encodings and poor scanner OCR layers score 0.1 to 0.45. Without an OCR engine only a whole-file scan (< 25 letters/digits per page) asks for OCR. Course import uses the same check.

**Page clean-up** (`straighten.py`, OpenCV). The clean-up only changes the geometry of the page. It does no binarisation and no contrast change, so a flat, straight scan comes out unchanged, pixel for pixel. There are three steps, and each is skipped when it would change nothing:

1. **Page in a photo.** The largest bright or edge-bounded four-sided shape covering at least 20 % of the image is the page. It is cut out and warped to a rectangle, unless it is an upright rectangle filling more than 85 % of the image (a scan or tight crop).
2. **Deskew.** The rotation between −10° and +10° that makes the rows of dark pixels sharpest (horizontal projection profile, 0.5° then 0.1° steps) is applied when it is at least 0.5°.
3. **Dewarp.** Text lines are traced (dark pixels smeared sideways into line blobs, the centre of each blob per column), and one smooth polynomial surface is fitted to how far they bend. When the 90th-percentile line bends by at least a third of a line height, every column is shifted up or down to make the lines straight. This flattens the curl of a book page near the spine.

**Recognition.** RapidOCR runs the PaddleOCR PP-OCRv6 _small_ models on ONNX Runtime (CPU): a detection model finds the text lines, a text-direction model turns upside-down lines, and the multilingual recognition model reads each line, with Dutch diacritics (ë, é, ï) and a box and score per word. Pages are scaled to at most 2000 px on the long side. The models ship inside the `rapidocr` package (about 30 MB), so OCR works offline from the first start. OCR reads Dutch only. Without the `ocr` extra (the `-slim` image) the OCR endpoints answer 503 and `/health` reports `"ocr": false`.

**Reading order** (`rapid.py`). RapidOCR returns lines top to bottom across the page, so a recursive XY cut puts them in reading order. A region is split at horizontal gaps of at least 0.9 line heights (paragraphs, boxes), and otherwise at vertical gutters of at least one line height (columns). Two columns are read one after the other. Three or more columns, or a label column narrower than 20 % of the region, are taken as a table and read row by row.

**Lost spaces.** The recognition model sometimes drops a space. A token is split after sentence punctuation before a capital (`woning.De`), after `?` or `!` before a letter, after a digit before a capitalised word (`3Fietsen`), and around a short Dutch function word when the token is not a word itself and the rest is (`Komtu` → `Komt u`). There is no compound guess, so real compounds stay whole.

**Review flags** use RapidOCR's own score, and a known word is flagged when its score is below 70 (out of 100). The scores separate right from wrong words only weakly (at 70, about 1 % of correct words get a flag), so most misreads are caught by the lexicon instead (section 2.8).

**Benchmark** (`server/nlp/scripts/ocr_bench.py`). The test set is six pages of a scanned A2 textbook, with a reading text, a word list, exercises, a menu table and a grammar table, 1,685 words transcribed by hand. Each page is also made into two synthetic phone photos, one tilted with uneven light and blur, and the same with a page curl. The table gives the word error rate (WER), the character error rate (CER), the WER ignoring word order (bag), and seconds per scanned page on one CPU thread. The clean-up itself takes about 0.2 s.

| Variant                | Scans WER / CER / bag | Photos WER / CER / bag | Curled WER / CER / bag | s/page |
| ---------------------- | --------------------- | ---------------------- | ---------------------- | ------ |
| Tesseract 5, raw image | 24.7 / 21.0 / 3.7 %   | 37.9 / 30.0 / 16.3 %   | 48.8 / 36.5 / 20.0 %   | 1.4    |
| Tesseract 5, cleaned   | 24.7 / 21.0 / 3.7 %   | 28.4 / 24.4 / 17.9 %   | 35.5 / 31.4 / 21.4 %   | 1.4    |
| RapidOCR, cleaned page | 4.8 / 2.5 / 1.7 %     | 5.4 / 2.6 / 2.1 %      | 8.1 / 5.2 / 2.4 %      | 6.7    |

The Tesseract rows are for comparison only, because Vuurtoren does not use it. Most of its scan errors are reading order in tables and word lists, and on photos it loses whole boxes of text. The PP-OCRv5 Latin recognition model scored about the same as the bundled PP-OCRv6 model (4.4 / 2.9 / 1.2 % on scans) but missed one accent and needs a separate download.

After PDF and OCR extraction, `cleanup.py` repairs the text:

- It normalises Unicode, expands ligatures (`ﬁ` → `fi`, `ĳ` → `ij`), turns typographic quotes into ASCII, and removes soft hyphens and zero-width characters.
- **Headers and footers.** A line in the first or last 2 lines of a page is removed when it repeats (digits ignored) on at least half of the pages, and on at least 2 pages. Bare page numbers (`12`, `- 12 -`, `Pagina 3`, `iv`) are always removed.
- **De-hyphenation.** `woor-` + `den` → `woorden`. `Noord-` + `Amerika` stays hyphenated, because a capital follows. `land-` + `en tuinbouw` keeps the suspended hyphen.
- **Re-flow.** Hard-wrapped lines are joined into paragraphs. For OCR text without blank lines, a line that ends a sentence and is shorter than 60 % of the longest line (when that line is at least 40 characters) ends a paragraph. A paragraph that continues across a page break is merged.

### 2.8 Checking OCR text: which words get flagged

After a photo or scanned page is recognised, you can check the text before it is imported. Vuurtoren underlines the words that may be misread (`ocr_review.py`). A word is flagged when:

- **The OCR engine was unsure.** Its score for the word is below 70 %.
- **It is not a Dutch word.** It is not in the word-frequency list (Zipf ≥ 2), the dictionary or simplemma, and it does not split into two common words (`fietsenstalling`). A capitalised word in mid-sentence is treated as a name and stays quiet unless a fix is found or the engine was unsure. Numbers and short all-caps abbreviations are never flagged.
- **A hyphenation went wrong.** Two halves joined at a line end make no word, or a word stayed split (`groen-` … `ten`) when the halves together make one.
- **It is a rare short word that looks like a very common one.** For example `ln` next to `in`, or `dc` next to `de`.

**Suggestions** come from the mix-ups that print OCR typically makes: `rn` ↔ `m`, `cl` → `d`, `vv` → `w`, `l` / `I` / `1` / `i`, `0` → `o`, `ij` ↔ `y` / `ii`, `fi` ↔ `fl`, `c` ↔ `e`, accents (`e` → `é` / `ë`), a stray hyphen inside a word, and a lost space (`eenhuis` → `een huis`). Vuurtoren applies up to two of these to the word and keeps only results that are real Dutch words. The commonest come first, and a candidate needing two changes ranks a little lower than one needing a single change. Suggestions that are far rarer than the best one are dropped. When the first letter itself was misread (`Iand`), the fix is capitalised only at the start of a sentence (`land`, or `Land` at the start of a sentence).

Each flag carries its position in the text and its box on the page, so the review screen can show the enlarged scan of the word next to the suggestions. Nothing is changed unless you accept a suggestion, type a fix, or press "Accept all suggestions".

---

## 3. Reading

**In short.** A text is split into pages of about 150 words. For each page Vuurtoren checks every word against what you know and picks about three new words that are worth learning. Those are common words, and if possible ones that come back later in the text. They stay untranslated. In Gloss mode the other words you don't know get a translation above them, and in Cloze mode some words you already know become blanks. When you finish a page, Vuurtoren looks at how often you looked words up and how many blanks you got right, and the next pages get one new word more or one fewer, somewhere between 1 and 5.

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

Coverage says how much of a page or a text you know, as one number between 0 and 1.

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
2. Rank them by `(repeats on this page + ½ × repeats on the text's other pages) × Zipf frequency` (ties: more frequent, then alphabetical): a word that comes back later in the text is a better word to learn, since one meeting rarely teaches a word (Webb 2007).
3. Work out the **frequency floor** for your level. Words within about the next 3000 frequency ranks after your vocabulary size are worth learning now:
   `zipfFloor = 7.6 − 0.9 · log10(vocabulary + W)`, clamped to [2.5, 5.0], where the window `W` is 3000 up to a vocabulary of 3000 and narrows to 1500 by a vocabulary of 6000 (`learningWindow`; closer to the "next 1,000-word level" of Nation 2014). For example, vocabulary 1000 → 4.36 and vocabulary 8000 → 4.02.
   Your vocabulary estimate is the sum of `pKnown` over known and learning words, at least 200 (`estimateVocabulary` in `staircase.ts`).
4. Candidates are the words at or above the floor, then (to fill a larger budget) words between Zipf 3.0 and the floor. **Words below Zipf 3.0 (about rank 20,000 and beyond) are never introduced**, only glossed.
5. **Budget.** `B` new words per page of 150 words, scaled up for longer pages: `max(1, round(B × max(words, 150) / 150))` when there is at least one candidate. `B` defaults to 3. It comes from the **New words** setting (0 = none, a fixed number, or "auto", which follows the staircase in 3.6).
6. The top candidates within the budget are `introduce`. Every other unknown word is `gloss`, which means it may get a translation in Gloss mode (section 3.5). Introduced words are highlighted and listed in the end-of-text word review, where you can add them to Anki. Glossed words are only listed there if you ask for them.

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

**Assumed-familiar words (cloze for beginners).** A learner can start the starter words at a later level (`starterFrom` on the language profile, where start level 3 means ranks 1–1000 are skipped). That learner most likely knows the words below the start level, but has no evidence for them yet, so Cloze would have nothing to blank. These words therefore count as cloze candidates without evidence. The planner option `assumedFamiliar` holds their keys, and a `new` word among them is treated as `learning` with `pKnown` 0.6 for the cloze rules above. The other rules still apply. A word is left out when the learner ignored it or set it back to new in the app, or when the page introduces it.

Only cloze candidacy changes. The word keeps its label, is glossed or introduced as before, and counts towards coverage and the known count as before. Nothing is recorded because of the assumption, but answering the blank is evidence like any other cloze answer (3.5). Learners who start at level 1, or whose profile has no start level, get no assumed-familiar words (`apps/web/src/services/assumedFamiliar.ts`).

### 3.5 Translations dial, cloze hints and cloze credit

**Translations dial** (`packages/core/src/reading/help.ts`). In Gloss mode, a dial from 0 to 1 decides which words get an inline translation:

| Dial value | Translated                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| ≤ 0.05     | nothing                                                                                                               |
| ≤ 1/3      | words you have not studied (`new`, `gloss`, `introduce`); default 0.25                                                |
| > 1/3      | also known and learning words whose `pKnown` is below `(dial − 1/3) / (2/3) × 0.95`, which rises to 0.95 at full dial |

Clozes never get a translation from the dial, because they show their meaning as a hint instead. Read mode shows no translations (click a word to see its meaning). Cloze mode shows only the clozes' meanings.

**Cloze hints and credit** (`packages/ui/src/Reader.tsx`, `apps/web/src/screens/ReaderPage.tsx`). Each blank has a help ladder: meaning (tooltip) → first letter and length → first half of the word → reveal. Answers are compared case-insensitively after Unicode normalisation. A missing accent (`een` for `één`) still counts, with a quiet note.

| Help used                       | Credit |
| ------------------------------- | ------ |
| none (the meaning hint is free) | 1      |
| first letter                    | 0.5    |
| half the word                   | 0.25   |
| revealed, or wrong              | 0      |

### 3.6 The staircase controller

**What it does** (`updateStaircase` in `packages/core/src/reading/staircase.ts`). The staircase makes the reading a little harder when it goes well and a little easier when it doesn't. When you finish a page, Vuurtoren computes **cloze accuracy** (credit ÷ blanks shown) and **lookups per 100 words**, and nudges two values:

| Outcome                                                                  | Target coverage T        | New-word budget B |
| ------------------------------------------------------------------------ | ------------------------ | ----------------- |
| **Hard**: accuracy < 0.70 **or** > 6 lookups per 100 words               | +0.005                   | −1                |
| **Easy**: (accuracy ≥ 0.85 **or** no clozes) **and** < 2 lookups per 100 | −0.005                   | +1                |
| otherwise                                                                | unchanged                | unchanged         |
| Bounds                                                                   | [0.92, 0.99], start 0.98 | [1, 5], start 3   |

**What it drives.**

- **B** is the new-word budget of the planner, when the New words setting is "auto".
- **T** is _not_ used by the non-AI planner. It is stored and is used only by the optional AI features: "Simplify this page" rewrites to T, and Converse aims at `max(0.9, T − 0.03)`.
- Neither value changes which texts you are offered. Text choice is up to you, guided by the coverage band.

### 3.7 Side by side: word pairs

**What.** The Side by side mode shows each sentence of the page with its English. Each Dutch word is paired with the English words it became, so pointing at _bel_ lights up _call_, and pointing at _rained_ lights up _regende_.

**How** (`server/nlp/src/vuurtoren_nlp/pairs.py`, `POST /translate/pairs`). The app sends each sentence, the character spans of its words and the separable-verb links from section 2.3. The server translates the sentence with OPUS-MT (section 2.6) and keeps the decoder attention of the best translation. That attention says, for every English subword, how much it looked at each Dutch subword.

1. Dutch subwords are placed in the sentence by their characters and belong to the word they overlap. English subwords are placed in the translation the same way. English words are runs of letters and digits; a contraction is a word of its own (_I_ + _'ll_).
2. The two parts of a split separable verb form one group: _bel … op_ pairs with _call_ as one unit, and pointing at either part lights up both.
3. Each English subword points at the Dutch subword it attends to most. An English word belongs to the Dutch group most of its subwords point at. Punctuation is not paired.
4. A pair is one Dutch group with all the English words that belong to it. Its confidence is the mean attention those English subwords give to the group (0–1). Pairs below 0.4 are dropped.
5. A translation that fails the existing checks (`clean_source`, `clean_output`, `plausible` in `translate.py`: Dutch again, far too long, repeated sentences) is dropped: the sentence has no English and no pairs.

Results are cached per sentence on the server (256 sentences) and per page in the app.

**English from an AI provider.** With a provider set up and "English from AI" on (Aa menu), the provider translates the page's sentences, as one numbered list per request. The server then pairs that English instead of its own. The given English is the decoder's forced prefix (CTranslate2 `target_prefix`), so the attention is the model reading that exact English. When the provider fails, the offline English is used, and when the server is down, the AI English shows without pairs. The offline model stays the default and works without AI.

**Precomputed for the bundled stories.** A story ships with its own English, one line per Dutch sentence, and the build pairs it once, exactly as the server would. `server/nlp/scripts/build_story_extras.py` (run by `check_stories.py --write`) takes every sentence of the story's bundled analysis, with its word spans, its separable-verb joins and the story's English. It sends them through the same `pair_texts` with forced decoding, and writes the pairs into `content/stories/stories.json` (per sentence `[Dutch word indices, English token indices, confidence]`, confidence to 2 decimals). It also writes the story's grammar hits from the same detectors (section 5).

The app (`storyPairs`/`storyGrammar` in `apps/web/src/services/stories.ts`) uses these first, without a request, as long as the text is the story's and its analysis is the bundled one. It maps the word indices to tokens with the same code as the server's answer (`livePairs.ts`), and only a sentence the bundle has nothing for goes to the server. So on a phone, or before the desktop's server is ready, a story's Side by side lights up partners, the structure view colours its pairs and notes the word order, and the reader shows its grammar marks.

The bundle records the analyzer version (which covers the detectors), the model pack (`mt-nl-en 2026.11.1`) and a hash of the pairing code (`extras`). The app ignores pairs and hits made for another analysis. The build is deterministic (beam 1, one batch per story).

**Which sentences show their English.** There are three choices. Always, or only hard sentences (the default), or Tap to show, which puts a "Show English" button on each sentence. A hard sentence is one whose coverage is below 0.85, as in section 3.3, over the sentence's counted words.

**Structure view.** Every pair gets its own colour on both sides. The sentence also gets one note on its word order, when the grammar detectors (section 5) found something in it (`wordOrderNote` in `packages/core/src/reading/grammar.ts`). The note is picked in this order of preference: verb at the end after a subordinator, verb at the end of a relative clause, a split separable verb, a participle at the end (perfect tense), and verb second (inversion).

**Limits.** Attention is a soft signal, not a dictionary. Small function words (_the_, _to_, _will_) often attend to a neighbour and join its pair, and an English particle may land on the wrong word (_ring **up** my mother_: _up_ goes with _mijn_). A Dutch word that no English word attends to stays unpaired (_er_, the _ge-_ participle when the model translated _heb gelezen_ as one verb). Idioms pair word by word, which can look odd. With AI English, the pairs are as good as the offline model's reading of a translation it did not write. On hand-checked sentences the pairs above 0.4 are mostly right, but there is no measured accuracy yet.

---

### 3.8 The Sentence tab: how a sentence is built

The Sentence tab shows each clause of the sentence on its own row: the first place, the verb that
changes with the person, the middle, the verb end and what comes after it, or, for a clause inside
another, the word that opens it, the middle and its verbs. The code is `sentenceClauses` in
`apps/web/src/screens/reader/sentenceFrame.ts`. It works from the parse of the sentence, so it is only
as good as the parser.

On a server the parse comes from SyntaxDot (`server/nlp/src/vuurtoren_nlp/syntax.py`; de Kok et al.
2020, [sticker2](https://hdl.handle.net/10900/119167), and de Kok &
Pütz 2020, "Self-distillation for German and Dutch dependency parsing", CLIN Journal 10, 91–107),
because it makes fewer mistakes than spaCy. SyntaxDot only runs on Linux with an Intel or AMD
processor. The desktop app on Linux can download it; on Windows, macOS and ARM servers the parse
comes from spaCy. Settings › Server status says which one is in
use.

How well it works, measured on sentences the rules were not written for:

- 62 random sentences from Tatoeba and the stories, checked by hand: SyntaxDot got 59 right (95%).
  With spaCy, rounds like this came out between 87% and 94%.
- 793 harder sentences, made with another AI to cover the difficult cases (split verbs, quotes,
  te-infinitives, comparisons and so on), with their answers. SyntaxDot matched 77% of them and
  spaCy 72.6%. A third of SyntaxDot's misses turned out to be mistakes in the answers, so on this
  set SyntaxDot is right about 85% of the time.

Most of what is still wrong comes back in the same few shapes: "aan het" + infinitive split in two,
a quote that isn't linked to "zegt hij" or to the colon before it, a word with a comma before the
clause ("Gelukkig, …"), "te" split from its verbs, circumpositions like "onder de tafel door", and
comparisons like "langer dan verwacht".

When the parse shows signs of being wrong, the tab says "This is a low-confidence sentence
structure" under the rows (`structureDoubtful`). It looks for a phrase without a verb next to a main
clause, and for a main word that is a participle or a noun while a conjugated verb sits somewhere else.
On the 793 sentences it showed 9 times with spaCy, and all 9 were wrong, but it misses most of the
wrong ones. With SyntaxDot it didn't show at all.

SyntaxDot also gives a lemma, and the server uses it as one more candidate (`syntax_lemma` in
`pipeline.py`). It replaces ours only when ours has no dictionary entry of its own (geheug, not a
word, becomes geheugen; schiep becomes scheppen, not schapen), or for a verb when ours is not a verb
at all. Otherwise it is an alternative the matcher also tries. Things we do on purpose stay: a split
verb joined to its particle (dichtdoen), a diminutive (broertjes), a participle used as a word
(volgende). On the stories and the 793 sentences, 27,866 words, it changed 33 lemmas (0.12%). I read
all 33 and they were right or at least fine. It needs the dictionary and SyntaxDot, so only the
server does it.

### 3.9 Book mode: screens, spreads and time left

Code: `apps/web/src/screens/reader/BookPages.tsx`, `bookMath.ts`, `BookScrub.tsx`.

One reader page flows into CSS columns. On a phone a screen is one column as wide as the text
area; on a computer, or a phone or tablet sideways when two pages of a readable width fit
(`fitsSpread`), it's two columns with a fold between them. The text area shows exactly one screen,
so a turn moves the text sideways by one step, the screen width plus the gap. Widths are whole
pixels, so columns don't drift after many turns.

- **One flow.** The whole text goes into the book, its segments (3.1) one after another, so the
  reader never sees a seam or a page number. Each segment still has its own new words,
  blanks and help (3.4, 3.5), and the one the reader is in stays frozen as before. The segment the reader is
  in is the one holding the first word on the screen. When that moves into a later segment, the
  ones before it are recorded as read with their own stats, as Next does in the scroll reader, so
  the staircase (3.6), the resume point and the reading speed work the same. Going back only
  moves the place. Turning past the last screen finishes the text. Gloss fetches the help for
  the next segment ahead.
- **The turn.** The default is Paper: the page folds along the line halfway between its corner
  and the finger, at right angles to them, and the part past the line lands mirrored as the back
  of the paper (`paperFold.ts`). Past the middle, or with a flick, it turns; otherwise it falls
  back. Slide, Fade and None are the other choices.
- **How many screens.** A marker after the last word: its x divided by the step, rounded up, at
  least one (`screenCount`). It's measured again when the text size, spacing, margins, the
  translations or the window change.
- **Which screen a word is on.** Its x before any turn, divided by the step (`screenAt`). After a
  re-measure the reader lands on the screen with the first word they were on, so changing the
  text size doesn't lose the place.
- **The place to the word.** The first word on the screen is saved as a character offset in the
  page (`ReadingPlace` event, `reading_place` table, the newest per text wins). Another device
  opens on the screen holding that character (`itemAtChar`). Apps without book mode skip the
  event.
- **Turning.** A tap on the left or right third, a swipe, the arrow keys, or the volume keys on
  Android (`volumeKeys.ts`, a bridge in MainActivity that only takes the keys while the reader
  asks for them). Past the last screen it goes to the next page; at the very end the page bumps
  back a little. Swipes that start within 20 px of the screen edge are left to Android's back
  gesture. With reduced motion every turn is instant.
- **Where you are.** One line: the share of the text before the first word on the screen, and the
  minutes for the words after it at the reader's speed ("51% · 1 min left").
- **Time left.** Reading speed in words a minute, starting at 100, a slow learner's pace. After
  each finished page: `wpm = 0.7·wpm + 0.3·sample`, where the sample is that page's words over
  its time. A page under 15 words or 5 s, or read faster than 450 or slower than 25 words a
  minute (skimmed, or put down), is left out. Minutes are rounded, at least one while anything is
  left (`minutesFor`).
- **The word card.** On a phone the card covers the bottom; the text lifts so the tapped word sits
  above it, and drops back when the card closes.

## 4. Practice

**In short.** Practice is for the words you are already learning. It gives you short exercises made from sentences, for example choosing the meaning, filling in a blank, de or het, putting words in the right order or writing down what you hear. Every word has its own schedule for every kind of exercise (FSRS), so an exercise comes back just before you would forget it. Practice never touches your Anki cards.

Practice trains words you already study (Anki state `learning` or `known`) in context, and **never writes to Anki**. Results go to Vuurtoren's own schedule, and every answer also counts as app evidence for the word (section 1.7).

### 4.1 Scheduling: FSRS per (word, skill)

**What.** Each (word, skill) pair has its own FSRS card. The skills are `recognition`, `recall`, `form`, `gender` and `listening`. Knowing _huis_ when you read it says little about typing it or knowing that it is _het huis_.

**How** (`packages/core/src/practice/schedule.ts`): the `ts-fsrs` library with its default parameters and **fuzz off**, so schedules are reproducible. A pair counts as "learned" once FSRS puts it in the Review state.

### 4.2 Grading an answer

Every answer becomes one of the four FSRS ratings, so an answer that needed help brings the exercise back sooner than a quick one. `packages/core/src/practice/grade.ts` does this:

| Attempt                                                         | Rating |
| --------------------------------------------------------------- | ------ |
| wrong                                                           | Again  |
| correct, but letter hints gave away at least half the letters   | Again  |
| correct with some hints                                         | Hard   |
| correct multiple choice or word ordering (guessing is possible) | Good   |
| correct typed answer                                            | Good   |
| correct typed answer, no hints, in under 4 s                    | Easy   |

### 4.3 Checking answers (leniency)

An answer is checked leniently, so small slips like capitals or a full stop don't make it wrong (`packages/core/src/practice/check.ts`):

- **Multiple choice**: exact match with the answer, after Unicode normalisation and trimming.
- **Typed words**: case-insensitive, whitespace collapsed, curly quotes normalised, punctuation at the edges ignored (`loopt.` = `loopt`). Any accepted variant counts (e.g. both auxiliaries for verbs that take `hebben` and `zijn`). A **missing accent is still correct**, with a note ("Mind the accents: één").
- **Word order and dictation**: as above, but all punctuation is ignored except apostrophes and hyphens inside words.

### 4.4 Exercise generators

Each kind of exercise has its own generator in `packages/core/src/practice/generate.ts`. A generator returns an exercise, or nothing when the word lacks the data it needs, and then the session tries another kind.

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

Word forms and the perfect-tense auxiliary come from Wiktionary (`server/nlp/src/vuurtoren_nlp/wordforms.py`). Wiktionary records the auxiliary for only about 3 % of verbs. For the rest, Vuurtoren uses how often the participle appears with `hebben` vs `zijn` in the Tatoeba corpus, then a curated list of `zijn` verbs, and defaults to `hebben`.

### 4.5 Choosing distractors

The wrong options in a choice exercise should be real words to you, and clearly wrong. They come from two places.

**Local pool** (`packages/core/src/practice/distractors.ts`). Wrong options come from the other words in the session:

- They must have the **same part of speech**, and must not be the word itself.
- **No synonyms.** A candidate is dropped if any of its glosses equals, contains or is contained in one of the answer's glosses, compared as whole words after removing parentheses, articles and "to" (`house` vs `house, home`). Otherwise there would be two right answers.
- They must have **similar frequency**: Zipf within ±1, widened step by step up to ±8 until there are enough.
- **Words you know come first**, so that the options are real words to you.

**Vector neighbours** (`server/nlp/src/vuurtoren_nlp/similar.py`, `POST /similar`). When a word-choice exercise has fewer than 4 options, it is padded with related words from spaCy's word vectors:

| Rule                | Value                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vocabulary          | the 30,000 most frequent single-word dictionary headwords (nouns, verbs, adjectives, adverbs), Zipf ≥ 2.5                                                                                                       |
| Same part of speech | required                                                                                                                                                                                                        |
| Cosine similarity   | 0.3–0.7: related but not a near-synonym (wider pass: 0.2–0.8)                                                                                                                                                   |
| Frequency           | Zipf within ±1.0 (wider pass: ±1.5)                                                                                                                                                                             |
| Excluded            | words containing the query or contained in it (`huis` / `huisarts`); words sharing an English gloss with the query, after mapping a few English synonym groups (`house/home/dwelling`, `happy/glad/content`, …) |

The app checks the synonym rule again with its own dictionary before using a neighbour, and only uses neighbours whose meanings are known.

### 4.6 Example sentences

Most exercises need a sentence with the word in it, so Vuurtoren looks for good example sentences.

**Where they come from**, best first (`packages/core/src/practice/sentences.ts`, `apps/web/src/services/livePractice.ts`):

1. **Your Anki card's example sentence**, if the word can be found in it: as the lemma, a form from Wiktionary, or a regular ending (`-s/-en/-je` for nouns, `-e` for adjectives, `-t/-te/-ten/-de/-den` and `ge…d/t` for verbs). There is no prefix guessing: _Zij_ is not _zijn_, and _manier_ is not _man_.
2. **Your own texts**: up to 3 sentences of 4–16 words, from your 15 most recent analysed texts.
3. **Tatoeba** (CC BY 2.0 FR) through `POST /sentences`, for words that have fewer than 2 sentences so far: up to 2 sentences of at most 14 words.

**Ranking.** A sentence of 5–15 words always beats one outside that range (scramble uses 4–9, dictation 3–8). Ties go to Anki, then your texts, then Tatoeba. A cloze skips sentences where the word appears twice.

**How "easy" Tatoeba sentences are chosen** (`server/nlp/src/vuurtoren_nlp/sentences.py`). Each stored sentence (3–25 words, ≤ 160 characters, no URLs or markup) gets a difficulty score: 0.5 per word, +2.0 per rare word (Zipf < 3), and +2.0 if it has fewer than 4 words. The lowest scores come first.

**Limits.** This approximates "i+1" (a sentence where only the target word is new) with **general word frequency, not your own learner model**. A Tatoeba sentence can still contain a common word that you have not learned.

### 4.7 Lessons

Practice is short lessons: about 10 words, 4 to 6 minutes. The code is in
`packages/core/src/practice/` (`select.ts`, `elo.ts`, `choose.ts`, `lesson.ts`, `known.ts`) and in
`apps/web/src/services/livePractice.ts` with `lessonSignals.ts`. If you pick fewer skills under
Options, the older session builder in 4.8 is used instead. The studies behind each choice are
listed in 4.9.

Your cards (Anki, or the app's own) already bring back each word's meaning on time, so Practice
doesn't do that again. It trains what a card doesn't, on the same words: the word in a real
sentence, a different one each time; saying it in Dutch; de or het, forms and word order; and the
sound. Each word gets the exercise you would get right about 8 times in 10.

Words you reviewed on a card today wait until tomorrow. With Anki that is as fresh as the last
sync, because the app learns Anki's review dates when it syncs.

#### 4.7.1 What the app knows about each word

| What                                                           | Where it comes from                    |
| -------------------------------------------------------------- | -------------------------------------- |
| Card state, FSRS stability, last review, recall now (`pKnown`) | the learner model (1.4–1.7)            |
| Taps on the word, when, and in which text                      | `WordLookedUp` events, `word_lookups`  |
| Reader blanks right or wrong, with or without a hint           | `ClozeAnswered`, `word_evidence`       |
| Every practice answer: word, kind, right or wrong              | `ExerciseAnswered`, `practice_answers` |
| The words on the page you read and on the next pages           | the text's analysed tokens             |
| Frequency (Zipf), part of speech, gender, forms                | dictionary and language server         |
| Ignored and dismissed words                                    | word states, `WordSuggestionDismissed` |
| Your reading level                                             | the staircase (3.6)                    |

#### 4.7.2 Which words go into a lesson

Practice items that are due (FSRS, 4.1) come first. The rest of the places go to the words with
the highest **need × use**.

- **Need** is high when you recall the word only partly (about 0.3 to 0.85), when you tapped it
  twice or more, or in the last few days, when you got it wrong lately, or when its card slipped.
  A word should come back soon after you met it and then more spread out (Karpicke & Roediger
  2008; Cepeda et al. 2006).
- **Use** is high for common words, for words on the page you just read, and for words on the next
  pages, because learning words before a text helps you understand it (Webb 2009).
- **Left out:** ignored and dismissed words, words you reviewed on their own card today (the app's
  cards, or Anki as of the last sync), and words that are safe in every way, except now and then
  as a check.

When you start a lesson from a list (this text, mistakes), only those words are in the pool.

#### 4.7.3 Which exercise: a small Elo model

Each answer counts as a match between how well you hold a word (θ) and how hard a kind of exercise
is for you (d), like the Elo rating in chess. Learning apps use it this way (Pelánek 2016). We
chose it over bigger models because with one person's answers they don't predict better (Pelánek
2017; Khajah, Lindsey & Mozer 2016).

- **θ at the start** is `logit(pKnown)` (kept between 0.05 and 0.95), minus 0.3 for each tap in the
  last 14 days, plus 0.3 for each reader blank you got right more than wrong.
- **d at the start** goes from easy to hard: meaning-choice −2.0, word-choice −1.6, cloze-choice
  −1.2, gender −1.0, adjective-e −0.8, separable −0.6, scramble −0.4, say −0.2, listen-build 0.1,
  perfect 0.4, cloze-typed 0.6, dictation 0.7, verb-form 0.8. These change with your answers.
- **The chance you get it right** is `p = g + (1 − g) · σ(θ − d)`. Here `g` is 1 divided by the
  number of choices for multiple choice, because a guess can be right, and 0 otherwise.
- **The pick** is the kind your word can do whose `p` is closest to 0.85 (Wilson et al. 2019).
- **The guard rail:** never more than one step above the hardest kind you got right for this word,
  so you type only after you have built the sentence. A word you marked known starts at building.
  A hard exercise only helps when you can still get it right (Bjork & Bjork 2011).
- **After an answer** θ and d move toward what happened: `θ += K(n)(r − p)` and
  `d −= ½ K(n)(r − p)`, where `r` is 1 or 0 and `K(n) = 0.8 / (1 + 0.1 n)` gets smaller as a word
  or kind collects answers. A peek or a hint counts as half (`r` = 0.5), like a hinted blank.
- **Nothing extra is stored.** θ and d are worked out again from `practice_answers` in time order,
  so every device gets the same numbers.

FSRS decides when a word comes back, and Elo decides how hard the exercise is. Elo doesn't model
forgetting; FSRS does, and θ starts from what FSRS says you remember now.

Misses are also counted per grammar point (gender, the -e ending, the perfect, separable verbs,
verb forms, word order). A point you often miss gets a bit more room in the next lessons.

#### 4.7.4 Which sentence

Sentences come from the places in 4.6. Before an exercise uses a sentence, it has to pass this:

| Exercise         | Length         | The other words                                                                    |
| ---------------- | -------------- | ---------------------------------------------------------------------------------- |
| build, hear, say | 4 to 7 words   | all known to you (recall 0.8 or more) or very common small words                   |
| fill the gap     | up to 12 words | at most one you don't know, and only if that stays within your reading level (3.6) |

The aim is about 98% known words, as in Hu & Nation (2000).

- A sentence always comes with its English. Sentences from your texts are translated offline
  (2.6), and one without English isn't used for building or hearing. Beginners learn better with
  the translation than with a Dutch explanation (Nakata 2011).
- The first time you practise a word, the sentence from your own reading comes first. After that
  it's a different sentence each time, because meeting a word in different sentences helps (Chen,
  Miller & Ke 2026, to check in the full paper).
- When the exercise used a simpler sentence than the one you met the word in, that one shows after
  the answer as "Where you met it".
- No sentence passes: other texts, then Tatoeba, then (with AI on) new sentences made only of your
  known words, checked by the language server. Still none: only exercises that need no sentence.
- Building has one tile too many: the other article, or another form of a word in the sentence.
- Tap a tile to hear it, hold it to see what it means, or press Hint for the next tile.

#### 4.7.5 Words you know, and your cards

- **I know it** gives the card a mature schedule, so the word counts as known. It comes up rarely,
  as a check, and starts at building. A miss lowers θ but never touches the card.
- **A word with a card never gets "pick the meaning"**, because that's the card's job. Practice
  trains the word in sentences, saying it, its forms and its sound instead (Webb 2005; Shintani,
  Li & Ellis 2013).
- **With the app's own cards**, a practice answer also counts as a review of the word's due card,
  but only for building and typing, not for the choice exercises.

#### 4.7.6 Saying a sentence

"Say this sentence" shows a short sentence with its English and a speaker, so you can hear it
first. You tap the mic (or press M), say it, and tap again.

- **On a computer** it is switched off for now; it comes after the release. The parts are built:
  the recording is turned into a 16 kHz WAV in the browser and the language server listens to it
  with Whisper base (Radford et al. 2023), offline, in sherpa-onnx (`listen.py`), from the
  `asr-nl` pack (94 MB, fetched only on request). Settings shows "Turn on speaking" greyed out.
- **On a phone** Android's own Dutch speech recognition listens, so no server hears anything.

It's at the same step as building, because both make you produce the sentence (Webb 2005).
Whisper base mishears some fast Dutch, so the check is easy-going: the sentence's words are lined
up with what was heard, a word of four letters or more may be one letter off, and 70% of the
words is enough. Below that, the strip shows what was heard with the missing words underlined,
and "I said it right" counts it as right. Silence counts as nothing heard, because Whisper makes
up words from silence. "I can't talk now" (S) skips speaking for the rest of the lesson. The
exercise only comes up when something can listen.

#### 4.7.7 Where a lesson starts, and what's around it

Practice opens on a list of lessons:

- the text you read last, with the words you tapped in it (Enter starts it on a computer);
- your new words, the usual lesson;
- the words you got wrong this week;
- the grammar point you missed most this week, which opens that topic's practice.

A ring shows the lessons you finished today on this device. The goal is one. On a computer a side
column shows the words back tomorrow, the options and the keys.

A reader page where you tapped two or more words ends with those words and "Practise these N
words". A word without a card that you never practised is shown first as a "new word" card (its
sound, meaning and sentence). When three or more such words start at the first step, a short
match-pairs round comes before the exercises. Neither of these is graded. "Hear it, build it"
plays a short sentence once by itself (again with the play button, slowly with the snail) and you
build it from tiles. Recordings from the audio pack play when there is one, else the voice.

At the end you see how many words, the share you got right and the time, which words come back
tomorrow, and a link to the grammar point you missed twice or more.

#### 4.7.8 The lesson

About 10 words (Short 5, Normal 10, Long 15), each once, because recalling a word three times in a
row is no better than once (Karpicke & Bauernschmidt 2011). A miss shows the right answer with one
line on why and a link to the grammar page, because explaining mistakes and teaching grammar
outright both work (Li 2010; Norris & Ortega 2000; Spada & Tomita 2010). The word then comes back
once at the end, one step easier. On a computer Check and the result sit in one band at the bottom
of the window. The goal is one lesson a day, and there are no streaks.

### 4.8 Building a session (when you limit the skills)

A session first picks the words, then the (word, skill) pairs that are due or new, and then an exercise kind for each (`packages/core/src/practice/session.ts`, `apps/web/src/services/livePractice.ts`):

| Step          | Rule                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Word pool     | due words, then never-practised learning words (shakiest first, in 0.1-wide recall bands, random within a band), then other learning words, then known words: up to `min(120, max(60, 3 × size))` words     |
| Size          | 20 exercises by default                                                                                                                                                                                     |
| 1. Due pairs  | most overdue first                                                                                                                                                                                          |
| 2. New pairs  | at most `max(⌈0.4 × size⌉, size − due)`. Ordered learning → known → seen → unknown, then lower `pKnown`, then more frequent. Round-robin: every word gets its first new skill before any word gets a second |
| 3. Filler     | if still short: pairs that are not yet due, soonest first                                                                                                                                                   |
| Exercise kind | per skill, the least-used kind so far that the word supports                                                                                                                                                |
| Order         | never the same word twice in a row; alternating skills where possible                                                                                                                                       |

### 4.9 Research behind the lesson design

| Decision                                         | Evidence                                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recall, not re-showing                           | Karpicke & Roediger 2008, _Science_ 319: after a week ~80% recalled when every pair kept being tested, 36% and 33% when learned pairs were only studied again                                 |
| Spread repetitions; once per lesson is enough    | Cepeda et al. 2006, _Psychological Bulletin_ 132 (839 comparisons); Karpicke & Bauernschmidt 2011, _JEP:LMC_ 37: long gaps +200%, three recalls in a row no better than one (26% vs 25%)      |
| Hard enough, but you must succeed                | Bjork & Bjork 2011 (desirable difficulties); Wilson et al. 2019, _Nature Communications_ (~85% right as the best training accuracy, for simple tasks)                                         |
| Elo for picking exercises                        | Pelánek 2016, _Computers & Education_; Pelánek 2017, _UMUAI_; Khajah, Lindsey & Mozer 2016 (classic models match deep knowledge tracing)                                                      |
| English for beginners; meaning before production | Nakata 2011, _CALL_ 24; Webb 2005, _SSLA_ 27                                                                                                                                                  |
| Producing the word (build, type)                 | Webb 2005; Shintani, Li & Ellis 2013, _Language Learning_ 63                                                                                                                                  |
| Explain mistakes, link grammar                   | Norris & Ortega 2000; Spada & Tomita 2010; Li 2010 (all _Language Learning_)                                                                                                                  |
| Sentences of known words                         | Hu & Nation 2000 (98% coverage; partly replicated, Kremmel et al. 2023)                                                                                                                       |
| Different sentences each time                    | contextual diversity: Chen, Miller & Ke 2026, _Applied Psycholinguistics_ (meta-analysis)                                                                                                     |
| Words before the next page                       | Webb 2009, _Canadian Modern Language Review_ 65                                                                                                                                               |
| Reading as the core, Practice as one part        | Nation 2007 (the four strands); Webb, Uchihara & Yanagisawa 2023; Yanagisawa, Webb & Uchihara 2020 (glossing)                                                                                 |
| Listening to what you say                        | Radford et al. 2023, _ICML_ (Whisper)                                                                                                                                                         |
| Synthetic voices are fine                        | Bione & Cardoso 2020, _Language Learning & Technology_                                                                                                                                        |
| What Duolingo does                               | Settles & Meeder 2016, _ACL_ (half-life regression: error 0.128 vs 0.235 for Leitner); Duolingo report DRR-21-03 (reading and listening like 5 semesters, median 203 hours, no control group) |

---

## 5. Grammar detectors

**In short.** Vuurtoren looks for grammar in your texts, things like inversion or the perfect tense, and underlines it with a short explanation and a link to the grammar topic. It only marks something when it is sure about it. Missing an example is not a big deal, but marking a wrong one would teach you the wrong thing.

**What.** `POST /grammar` finds grammar constructions in a text and underlines the tokens involved, with a one-line explanation (`server/nlp/src/vuurtoren_nlp/grammar.py`). In the app the marks show up in the reader, and under each word in the word panel, and every mark links to its topic in Grammar (63 topics, from A1 to C1). This section is about how the marks are found.

**How.** Each detector reads one analysed sentence: part of speech, morphology (e.g. `VerbForm=Part`, `Tense=Past`, `Degree=Cmp`), dependency relations (`nsubj`, `mark`, `aux`, `compound:prt`, …) and the separable-verb links from section 2.3. It never reads the raw text, so it also works on analyses that the app has already stored. Some examples:

- **Inversion**: a finite verb in the main clause comes before its subject because something else stands first. It does not fire for questions, exclamations, quotations, or when a subject already stands in front (that is parse noise).
- **Subordinate clause**: a subordinating conjunction (`omdat`, `dat`, `als`, `toen`, …) with a subject after it and the finite verb at the end, where only the rest of the verb cluster may follow the verb.
- **Perfect tense**: finite `hebben`/`zijn` plus a past participle. Passives (`aux:pass`) are excluded, and `zijn` + participle only counts for verbs of motion or change (_gaan, komen, vallen, …_), because _is gesloten_ is usually a state.

**Topics (22).** inversion · questions · subordinate clauses · separable verbs · perfect tense · modal verbs · imperfect (simple past) · future (`zullen`/`gaan` + infinitive) · reflexive verbs · `om … te` + infinitive · `te` + infinitive · adjective inflection (-e) · comparison · negation (`niet`/`geen`) · demonstratives · `er` (existential, quantitative, prepositional, place) · relative pronouns · de/het (diminutives are always `het`) · plural nouns · imperative · indirect speech · conjunctions (`en/maar/want/of`).

**Topic pages.** The grammar topics a hit links to (`packages/content/grammar/nl/*.md`) follow the e-ANS (Algemene Nederlandse Spraakkunst) and Taaladvies, simplified for learners. Each topic lists its sources in a `sources` front-matter field, which is shown at the end of the topic page.

**Precision over recall.** A detector fires only when the parse and the word forms agree. A missed example costs nothing, but a wrong underline teaches the wrong thing. One construction gives one hit, but a token may belong to hits of several topics.

**Example cache** (`grammar_examples.py`, `GET /grammar/examples`). The Tatoeba sentence database is indexed by word, not by construction. So to find sentences "with an inversion", the detectors are run over sentences of 5–14 words, in a fixed pseudo-random order, and rare constructions turn up as early as common ones. Each request scans batches of 128 sentences until the topic has enough examples or a 4-second budget is spent. Up to 40 examples per topic are cached, and the best (lowest difficulty score) are returned, 10 by default. The cache is discarded whenever `grammar.py` changes (it stores a hash of the file).

### 5.1 Word-form explainer

**What.** The explainer answers "Why is this word like this?" for any word in the reader, not only the ones a detector marked. `explainWord(tokens, index, { hits, article })` in `packages/core/src/reading/explain.ts` returns short plain-English notes, each with the id of its grammar page. When the word is a finite verb, it adds a word-order line. It runs in the browser on the stored analysis (lemma, POS, morph, and the dependency tree of the clicked word's sentence), so it needs no server call.

The inspector's "Grammar of this word" section (`apps/web/src/screens/reader/WordGrammar.tsx`) shows up to three notes and the order line. After them come the detector notes of topics the explainer did not cover. More lines and the topic rules sit under "More about this word".

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

**Precision first.** A rule fires only when the form agrees with the analysis. When it does not (a wrong lemma, a -t with _ik_, a lemma that is not an infinitive), the note is dropped, and the word gets just "lemma: part of speech". Adverbs, prepositions and conjunctions also get "words like this do not change form". Known parser errors still leak through: spaCy reads _De kinderen spelen buiten_ as separable _buitenspelen_, and gives _nagedacht_ the lemma _nadachten_ (the explainer then calls it an irregular participle of that lemma).

**Tests.** `explain.test.ts` checks 87 word/sentence pairs against analyses captured from the NLP server (`fixtures/word-grammar.nl.json`, 69 sentences). A web test checks that every linked topic id has a page.

---

## 6. What Vuurtoren writes to Anki

**In short.** Vuurtoren reads your Anki decks, but it only writes to Anki when you press a button for a word. Every note it writes gets a tag, so you can always find it.

This section is about connected mode. In native mode Vuurtoren writes nothing to Anki, and the same buttons act on its own cards instead (section 9.5).

Vuurtoren reads Anki freely but **writes only when you click** a button for one word (`packages/anki/src/actions.ts`, `packages/anki/src/note.ts`). Every write is tagged, so you can find and undo it in Anki's browser.

| Button                               | Shown when                          | What happens in Anki                                                                                                                                                                                        | Tag                  |
| ------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Add to Anki**                      | the word is not in your decks       | A note of type **Vuurtoren Word** (fields: Word, Gloss, Sentence with the word in bold, SentenceTranslation, Source) in the target deck, `Vuurtoren::Nederlands` by default. No duplicate within that deck. | `vuurtoren` (+ `nl`) |
| **Study first in Anki** (learn next) | the card is new (even if suspended) | The card is unsuspended and moved to the front of its deck's new queue. Other cards are not shifted, which would force a full sync. Needs AnkiConnect's v1 API.                                             | `vuurtoren::reading` |
| **Mark known**                       | any state, or not in Anki           | (Adds the note first if needed.) Unsuspends the card and sets its interval to a random 21–35 days (`setDueDate "21-35!"`), so it reads back as mature, and therefore known.                                 | `vuurtoren::known`   |
| **Use Anki's state**                 | after a manual mark                 | Nothing in Anki. Only the app-side mark is removed.                                                                                                                                                         | —                    |

Vuurtoren **never** answers cards, writes review history or changes FSRS parameters, and it touches cards you study only through Mark known. Practice, cloze and book-exercise results stay in Vuurtoren, where they feed the learner model (section 1.7).

All four buttons go through one shared command layer with one key rule (`wordKey`). The layer is `addWordToAnki` in `packages/anki/src/profile.ts`, and `studyWordFirst`, `studyWordsFirst`, `markWordKnown`, `resetToAnkiState` and `setAppWordState` in `packages/anki/src/commands.ts`. In the app, Learn next is labelled **Study first in Anki**. Until Anki has reviews for an added or moved card, the reader treats the word as `learning` with `pKnown = 0.2` (section 1.6).

---

## 7. Worked example: "Ik bel je morgen op."

**In short.** Here one sentence goes through all the steps above.

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

**In short.** Nothing above uses AI. The AI features only show up when you add your own key.

Everything in the sections above runs **without any AI provider or API key**. That is deck detection, the learner model, lemmatisation, separable verbs, derivation and compound glosses, meanings read off the sentence translation, the dictionary, offline sentence translation, OCR and cleanup, the reading planner, clozes, the staircase, practice scheduling and exercises, distractors, grammar detection, Anki writes, and native reviews with their tuning. The two models involved (spaCy and OPUS-MT) are small, local and deterministic for a given input. They never generate free text about you or for you.

AI features are opt-in extras, hidden until you configure a provider: Converse, Explain this sentence, Simplify this page and the English of Side by side (its word pairs still come from the offline model, section 3.7). See [ai.md](../ai.md) for what they do, which providers work and what is sent.

**How generated text is checked.** The AI writes, and Vuurtoren's own algorithms check what it wrote, so the AI never grades anything (`packages/ai/src`).

- **Talk and stories** (`conversation.ts`, `story.ts`). The language server analyses the text, and Vuurtoren works out how much of it you know. If that is more than 3 points below your target (and never below 90%), it asks for one rewrite and names the words that were too hard. For a story, the new words you asked for don't count against it. The rewrite is only kept if it's better, and words you still don't know get a translation.
- **Example sentences** (`examples.ts`), up to 8 words per Practice session and 5 sentences each. A sentence is only kept if the word is really in it, you know at least 90% of it with at most one unknown word, no other target word slips in, and it has 4 to 14 words. For a grammar topic, the grammar detector must also find the rule. Failed tries are saved too, so a hard word isn't tried again every session.
- **Unit exercises** (`unitExercises.ts`: gap fills, sentence building, a text with questions) are checked the same way, and then graded by the book's own checkers.

**The key.** The provider key is stored on the device only. With a passphrase it is encrypted with AES-GCM, with a key from PBKDF2 (SHA-256, 250,000 iterations) (`keystore.ts`).

---

## 9. Native mode: Vuurtoren's own cards

**In short.** If you don't use Anki, Vuurtoren keeps the cards itself. It plans the reviews with FSRS and tunes it to your own answers over time. Reading counts here too. A word you read without looking it up waits a bit longer for its next review, and a word you had to look up comes back today.

In native mode Vuurtoren holds the cards and runs the reviews. The learner model, the reader, Words, Practice and courses read these cards exactly as they read Anki cards in connected mode.

### 9.1 Where cards come from

Cards come in three ways: a word you add while reading, an Anki package file, or a move from Anki through AnkiConnect.

| Source                          | What comes in                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add to my words**             | a note of Vuurtoren's own type (Word, Gloss, Sentence, SentenceTranslation, Source) with one card, in the deck the language profile chooses                                                                    |
| **.apkg / .colpkg file**        | the chosen decks' notes, note types (fields, card templates, styling), cards, deck options, the full review log, and the images and sounds the notes use                                                       |
| **Move from Anki to Vuurtoren** | the same, read through AnkiConnect from the confirmed source decks and Vuurtoren's destination decks (`notesInfo`, `cardsInfo`, `getReviewsOfCards`, `findModelsByName`, `getDeckConfig`, `retrieveMediaFile`) |

**Package files** (`packages/anki/src/apkg/read.ts`). A package is a zip, and it comes in two layouts. The older layout holds `collection.anki2` or `collection.anki21`, a SQLite file whose `col` row carries note types, decks and deck options as JSON, and a `media` file mapping zip entries to names as JSON. The current layout holds `collection.anki21b`, compressed with zstd. In it, note types, fields, templates, decks and deck options have their own tables with protobuf blobs (note type kind, CSS, template front and back, a deck's options id, learning steps, relearning steps, new cards per day, maximum interval, target retention, FSRS-6 parameters). Its `media` is a zstd-compressed protobuf list, and each media file is compressed too.

Cards in a filtered deck are imported into their home deck. A review card's due day counts from the collection's creation day. The current schema declares text columns `COLLATE unicase`, a collation only Anki has. So Vuurtoren walks the schema table's pages and swaps it for `COLLATE binary ` (same length), in the schema's SQL only, never in note text. A package may unpack to at most 512 MB per file and 1 GB in all.

**Vocabulary fields** are found with the same detection as in connected mode (section 1.1), per deck and note type. When the language server is unreachable, field names decide (`Woord`/`Word`/`Front` for the word, `Betekenis`/`Meaning`/`Back` for the meaning, `Zin`/`Sentence`/`Example` for the sentence). Headwords become keys with the server's term analysis (section 1.2), or with `wordKey` without it. Notes of other types are imported and reviewed, but do not feed the learner model.

Notes and cards keep their Anki ids. A card that is already held keeps its state and history when the same deck is imported again. Images up to 2 MB and sounds up to 8 MB are kept, and the import reports any it could not keep.

### 9.2 The scheduler

The scheduler decides when each card comes back, and in what order the cards of a day are shown. It is `packages/core/src/native/schedule.ts`, on `ts-fsrs` (FSRS-6, 21 parameters):

| Setting          | Value                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parameters       | the learner's tuned ones (9.3); before the first tuning, Anki's own FSRS-6 parameters when the imported preset had them, else the FSRS-6 defaults        |
| Target retention | per deck, default 0.9 (between 0.7 and 0.99)                                                                                                             |
| Learning steps   | per deck, default 1 min and 10 min                                                                                                                       |
| Relearning steps | per deck, default 10 min                                                                                                                                 |
| Maximum interval | per deck, default 36,500 days                                                                                                                            |
| New cards a day  | per deck, default 20; counted from 4:00 local time                                                                                                       |
| Spread           | answers of 3 days and more land on the lightest day within ts-fsrs's fuzz range (9.2.1); replays and the intervals on the buttons use the plain interval |

Imported decks bring their own steps, limits and target retention.

**Imported memory.** Each card's review log is replayed through the scheduler, oldest first, without fuzz, so stability and difficulty are what FSRS makes of the whole history. Manual changes (rescheduling, set due date) are not answers and are skipped. A manual entry followed by learning answers is a reset, and it starts the card over. A review card keeps the due date and interval Anki gave it. A reviewed card without any history gets its interval as stability and difficulty 5.

**Queue** (`nativeQueue` in `packages/db/src/cards.ts`). It works like Anki's. A word you are still learning comes first as soon as its step is due, so a word you pressed Again on comes back after its minute. Then come today's reviews, with the new words spread evenly between them. A review is due for the whole day it falls on (the day starts at 4:00), and within a day the order is shuffled, but the same all day so the queue doesn't jump around between answers. There are at most 200 reviews a day (Settings → Your words → **Reviews a day**), so after days away the rest waits for the next days. When nothing else is left, learning words due in the next 20 minutes come forward. Hard on a learning step also works as in Anki: halfway between the first two steps on the first step, and the same step again on a later one (`ankiLearningSteps` in `packages/core/src/native/schedule.ts`).

**Related cards apart.** Once a card of a note, or of another note of the same word (same key), is answered on a study day, that note's and word's other new and review cards wait for the next day. In one session only the first of them is offered. Learning and relearning steps go on. The counts on the Words badge and in Today on Read follow the same rule.

#### 9.2.1 Workload

The workload rules keep the number of reviews even from day to day.

- **Load balancing** (`balanceInterval` in `packages/core/src/native/workload.ts`). A review answer of 3 days or more can land anywhere in the range ts-fsrs's fuzz allows (`get_fuzz_range`, for 20 days about 17–23). Vuurtoren picks the day with the fewest review cards already due (`nativeDueCounts`), and ties go to the planned interval. So cards answered alike spread out by themselves, without randomness.
- **Review days** (Settings): each weekday takes its normal, reduced (half) or minimum share. The cost of a day is (cards due + 1) ÷ its share. A minimum day takes a card only when every day in the range is one.
- **Expected load.** Next to each target recall, Settings shows about how many reviews a day it means for the cards you have now. That is, for each review card, one review per interval at that recall (FSRS-6: t = S/F · (R^(−1/decay) − 1), F = 0.9^(−1/decay) − 1, capped by the maximum interval), plus the new cards a day while a deck has new cards.

**Answering** (`answerCard`): Again, Hard, Good, Easy are FSRS ratings 1–4. The event stores the card's schedule before and after the answer. So the log replays without the scheduler, and an undo restores the earlier state exactly. When another device answered the card after it, the card is replayed instead (9.6). The buttons show the interval each rating would give.

### 9.3 Tuning to you

**In short.** FSRS has parameters that describe how your memory works. Vuurtoren learns them from your own review history, so the schedule fits you better over time.

The FSRS optimizer is `fsrs-rs` compiled to WebAssembly (`@open-spaced-repetition/binding-wasm32-wasip1`), run in a worker on the device (`apps/web/src/native/`). It trains on the whole review history, both imported and answered in Vuurtoren.

1. Each card's answers become a sequence of ratings with whole study days between them (a study day starts at 4:00 local time). A card counts only when its history starts with a learning answer. A reset starts a new sequence, and manual entries are left out (`trainingSequences`).
2. Every answer given on a later study day than the one before is one training item: that answer with the card's whole history before it, same-day learning steps included.
3. The optimizer trains FSRS-6 parameters with short-term memory enabled. It needs at least 50 such answers.
4. The new and the current parameters are scored on the same items, with log loss and RMSE (binned), where lower is better. The new ones are used only when their log loss is lower, and otherwise the current ones stay.
5. With new parameters, every card with a complete history is replayed again for its stability and difficulty. Due dates stay as they are. Only the new stability and difficulty are recorded, with the parameters and the card's last answer. A card answered since (on another device) keeps that answer, and a card whose parameters were replaced meanwhile (another device tuned too) is left as it is.

It runs by itself when the app opens. The first time is once the history holds 400 answers. After that it runs every 30 days (when there are new answers) or after 500 new answers, but not within a day of the last tuning on any device. **Optimise now** in Settings runs it at once and shows the reviews used and the log loss and RMSE before and after.

### 9.4 What you know

Vuurtoren's own cards tell the learner model which words you know, the same way Anki cards do. `nativeWordEntries` in `packages/db/src/cards.ts` gives the learner model the same per-word facts an Anki snapshot gives (section 1.5). It takes each note's strongest card and reads it with `classifyCard` (section 1.4), from its FSRS stability, the time of its last answer and the decay of the parameters in use (FSRS-6 learns it, and the default is 0.1542). So **known** means stability ≥ 21 days and recall ≥ 0.6 now, and a suspended mature card stays known. A word added with **Add to my words** is `learning` with `pKnown = 0.2` until its card is first answered, as in connected mode. Manual marks and app evidence apply on top as in sections 1.6 and 1.7.

### 9.5 Word commands

The word buttons are the same as in connected mode (section 6), but they act on Vuurtoren's own cards.

| Button              | What happens to Vuurtoren's cards                                                      |
| ------------------- | -------------------------------------------------------------------------------------- |
| **Add to my words** | a new note and card (section 9.1), new in the queue's first place                      |
| **Study first**     | the word's new cards move to the front of the new queue and are unsuspended            |
| **Mark known**      | the cards get a mature interval of 21–35 days (the word is added first if it has none) |

#### 9.5.1 One memory per word

In native mode, what you do with a word outside the review screen reaches its card (`evidence` in `apps/web/src/services/liveNative.ts`), so one word has one memory state:

| What you do                                | What happens to the word's review card                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Answer a **Practice** exercise             | when the card is due today: an answer (Again, Hard, Good, Easy as the exercise's grade); a wrong answer also on a card not due yet |
| Answer a **reader blank** (first answer)   | the same: wrong is Again, right after a letter hint is Hard, right is Good                                                         |
| **Finish a page** and not look the word up | a due card moves later by 15 % of its interval (1–7 days): light evidence, not an answer                                           |
| **Look the word up** while reading         | a card not due yet becomes due now                                                                                                 |

- A word gets at most one answer a day, from wherever it comes first (the review screen included). New cards are never introduced this way, and suspended cards are left alone.
- Answers from Practice and blanks are reviews (source `practice` or `cloze`), so the optimizer trains on them. Moves from reading are not reviews and stay out of its training data.
- A move from reading is recorded as what to do (later by so many days, or due now), together with the card's last answer. It is done to the card as it is when the change applies. So a card answered since, here or on another device, is left as answered, and a card another device already moved is not moved twice.

### 9.6 The review screen

You see the front, then press Space or **Show answer**, then Again / Hard / Good / Easy (keys 1–4, and Space or Enter is Good).

Z or **Undo** takes back the latest answer, then the one before, also after a reload or on another day. It takes back the newest answer given on the review screen of this device (`nativeLastReview`), as long as no later answer to that card came from another device. The card comes back with its answer hidden. When another device's answer to the card arrives after an undo, the card is replayed from its remaining answers in order, so that answer still counts.

A vocabulary card whose template shows the word on the front is laid out by Vuurtoren, with the word and its sentence on the front, and the meaning and the sentence translation on the back. Clozes and other templates are rendered from the note type's own template (fields, conditional sections, `FrontSide`, clozes, hints). They are shown through an allow-list sanitiser that keeps formatting tags only, with no scripts, styles, frames, forms or event handlers, and only the card's own images. Sounds get a play button. After the answer, a sentence with the word from your own texts is shown when one exists.

**Your words and your reviews.** In native mode Words has a **Due** view. It lists the words with a card due now (`nativeDueKeys`), earliest first, each with how long ago it came due. With a source chosen, it shows only that text's, unit's or session's words. The word inspector lists the word's latest eight answers under **Your reviews**, with the day, the answer and the interval it gave. These come from the card's history replayed, and the latest answer shows the due date the card really got. The activity behind Progress counts the reviews answered in Vuurtoren per day; an undone answer does not count.

### 9.7 Export to .apkg

You can take your cards back to Anki as a package file. `writeAnkiPackage` (`packages/anki/src/apkg/write.ts`) writes the older package layout, which every Anki since 2.1 imports. That is `collection.anki21` (schema 11, with note types, decks and deck options as JSON in `col`) and `media` as JSON. What goes in:

| Vuurtoren               | In the package                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Note types              | imported ones keep their Anki id; Vuurtoren's own word type has a fixed id, so exports and re-imports update the same type                                                      |
| Notes                   | their ids, fields and tags; a guid from the note id, so importing a newer export updates the notes instead of doubling them                                                     |
| Decks and their parents | the deck options (steps, limits, maximum interval, target retention) and the FSRS-6 parameters in use, one preset per deck                                                      |
| Cards                   | new cards in their new-queue order; learning cards with their step and due time; review cards with their due day and interval; FSRS stability and difficulty in the card's data |
| History                 | every answer, with the interval it gave (the history replayed without fuzz); manual changes as manual entries                                                                   |
| Media                   | the images and sounds the notes and templates use                                                                                                                               |

Checked by importing the file into a fresh collection with Anki 26.08: cards, due days, memory state, history and deck presets come through.

### 9.8 Move to Anki

A learner who started in native mode can move to Anki and keep going there. `moveToAnki` (`packages/anki/src/toAnki.ts`) does it once, through AnkiConnect:

1. `notesInfo` runs on every note, and notes Anki already has (they came from Anki and kept their ids) are not added.
2. The others are added as **Vuurtoren Word** notes in their deck, tagged `vuurtoren::moved`. A Vuurtoren note keeps its fields, and an imported vocabulary note maps its word, meaning, sentence and translation fields onto Vuurtoren's. A note with several cards becomes one card, standing for its most advanced card. Notes of other types without a word are left out. If an earlier move stopped halfway, the words it already added are found again (tag `vuurtoren::moved`, same deck and word), and they are scheduled now instead of being added twice. So after a failure you can simply try again.
3. Each card reviewed in Vuurtoren gets `setDueDate "N!"`, which makes it due on the same study day, with that gap (N days) as its interval. A card due today or overdue gets `"0!"`, so it is due today in Anki too, and `setSpecificValueOfCard` then gives it back its interval from Vuurtoren (Anki would leave it at 1 day). New and learning cards are new in Anki. Suspended cards are suspended. If Anki refuses the due dates, the move stops with an error and stays undone in Vuurtoren.
4. **With history (experimental):** `setSpecificValueOfCard` sets the exact interval, reviews and lapses, and `insertReviews` writes every answer with its real time and the interval it gave (the history replayed without fuzz, as in the export). Answers Anki already holds (`getReviewsOfCards`) are not written twice. Anki computes FSRS memory from this history when its deck options are saved or optimised.
5. The profile becomes connected and reads the moved decks (Vuurtoren's note type and fields), and an Anki sync runs. Vuurtoren's own cards stay in its database, unused.

### 9.9 Starter words

A new learner in native mode can start with the most common Dutch words. The list ships with the app (`content/starter/nl-5000.json`, CC BY-SA 4.0) and works offline.

**The list** (`server/nlp/scripts/build_starter.py`, rules in `server/nlp/src/vuurtoren_nlp/starter.py`):

1. **Ranking.** The 12,000 most frequent Dutch word forms of `wordfreq` (frequency per word form, from subtitles, Wikipedia, web text and more).
2. **Forms to lemmas.** Every Tatoeba sentence of the sentence pack is analysed with the app's own spaCy pipeline, so each form gets its readings in context: "was" is read mostly as _zijn_ and now and then as _wassen_. A form's frequency is shared among its readings in proportion and summed per lemma. A form that never occurs in the sentences is analysed on its own and takes the part of speech of its dictionary entry. A lemma without a dictionary entry takes the lemma the dictionary's forms table gives for the form; a word that is only an inflection of another ("Nederlanders", plural of _Nederlander_) becomes that word.
3. **Filters.** Out go: words with digits, single letters (except _u_), names (read as a proper noun more than half the time, unless the dictionary has them as an ordinary word: _september_, _maandag_, _Engels_), abbreviations, interjections other than everyday ones (_ja_, _nee_, _hallo_, _dank_ …), English words (at least 0.5 Zipf more frequent in English and hardly in the Dutch sentences), very short words never met in context, and lemmas without a dictionary entry or meaning. Number words (_twee_, _nul_) stay.
4. **What each word gets.** The 5000 highest lemmas are kept with their rank, part of speech (the commonest reading) and article (nouns, from the dictionary). Each also gets the reader's short gloss, made with the same rules as `shortGloss`, with form-of senses resolved and the hand-written particle glosses (one test file holds both versions to the same cases). And each gets one example sentence with its English. Of the word's Tatoeba sentences, that is one of 5–10 words whose other words all rank at most 1000 after the word itself, and that shows the word as its lemma, with the lowest practice score. If there is none, it is the shortest. About 9 % of words have no sentence.

**Levels** (`packages/anki/src/starter.ts`). Ranks 1–500, 501–1000 … are levels of 500 words, each a deck "Vuurtoren · Woorden 1–500" and so on. The list has 4,930 words after review, so there are ten levels (the last one shorter), and "Start with the most common words" adds all of them. A word becomes a note of Vuurtoren's word type with one new card, in order of rank. The note holds the word with its article, the gloss, the sentence with the word in bold, the translation, and the Tatoeba sentence number as source. Notes and cards have fixed ids from the rank, so adding a level again, or on two devices before they sync, gives the same cards once. A word the learner already has a card for is skipped.

**One level at a time.** Starter decks are created with no new cards a day. When no starter deck that still has new cards adds any, the lowest such deck gets the default 20 a day (checked when the review counts are read). So the levels come in order, and the learner can change a deck's limit as usual.

**Where new words start.** Nothing is marked known, so there is no placement and no known cards in bulk. Onboarding asks "Where should new words start?" (level 1, 2, 3, 5 or 7) and keeps the answer in the language profile (`starterFrom`). The levels below it are there but get no new cards, because the one-level-at-a-time rule above only opens levels from the start level on. Settings → Language & decks, "Start new words from level N", changes it. Then the first level from there with new cards left opens at once, and any other open starter deck closes. Words the learner already knows get marked known by the reader's evidence as they read (section 1.7). Settings also adds any level that is missing.

**Audio.** Every word and example sentence of the list, and every sentence and paragraph of the bundled stories, has a recorded clip in the `audio-nl` pack, in a female and a male voice. A clip is named by its text, so nothing needs to map words to files. A word's clip is `word-<first 16 hex digits of sha1(text)>`, where the text is "<article> <word>" for nouns ("het huis", "de/het idee") and the word alone otherwise. An example sentence's clip is `sentence-<sha1(sentence)[:16]>`, for the sentence as written (`server/nlp/scripts/tts_elevenlabs.py`, `packages/anki/src/audio.ts`). The app hashes with WebCrypto, and one fixture, `server/nlp/tests/fixtures/audio-ids.json`, holds both sides to the same ids.

Starter notes keep the ids they were made with (`audio`, `sentenceAudio`), so editing a note's text later keeps its sound. Other notes get ids from their word and sentence, and those find a clip only when the text is a starter word or sentence. The reader asks for a clip for every sentence, and story sentences have one. Playback uses the clip in the chosen voice, else the system's Dutch voice, else nothing. In the reader, the inspected word uses the clip only when it stands in its dictionary form.

## 10. Sync

**In short.** Every change you make is saved as a small event. Each device writes its own events to the place you sync through, locked with your passphrase before they leave, and reads the events of your other devices. If you review on two devices, the reviews are added together, so one doesn't overwrite the other.

Sync keeps your data on every device, and the event log is the unit of sync (`packages/db/src/sync/`).

### 10.1 What travels

Every change is an event in the append-only log, and the events are what sync carries. A device sends **its own** events, oldest first, in segments of at most 2,000 events and 4 MiB of JSON (a larger single event goes alone). It imports the other devices' files. Images and sounds the events refer to (covers, card media) travel as blobs. Per-device bookkeeping (what was sent, what was received from each device, blobs known to be in the place, files set aside) stays on the device.

### 10.2 The place

The place is wherever the devices meet: a Vuurtoren server, a synced folder or WebDAV. Every place holds the same files:

| Path                                           | What it holds                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `vuurtoren/vault.json`                         | the data key under the passphrase and recovery-key locks, and a check value |
| `vuurtoren/devices/<device>/<lastId>.kev`      | events of one device after the previous file, up to `lastId`                |
| `vuurtoren/devices/<device>/<lastId>.base.kev` | a part of the device's folded events, up to `lastId`                        |
| `vuurtoren/devices/<device>/device.kev`        | the device's name and when it last wrote it                                 |
| `vuurtoren/blobs/<hmac>.kbl`                   | an image or sound                                                           |

A device writes only its own folder and blobs (named by content), so places that copy files around (Syncthing, Dropbox, iCloud Drive) never see two devices write one file. Each file names the range it holds (`after`, `last`). A reader checks it against the file's name and takes its cursor from it. A file whose earlier neighbour has not arrived yet waits, and after a day it is taken anyway.

**Folding.** Without folding, a device's folder would grow forever. Past 100 segment files, a device folds its older half (after compaction, 10.5) into parts of about 8 MiB that end where existing files end, and removes those segments. The parts before stay as they are. Only when compaction removed something, and at most every tenth fold, everything is folded again. A device that keeps up reads the segments that stay and never a part. One that was away reads only the parts after its cursor, and a new device reads all parts, then the segments.

**Limits.** No file over 60 MiB of JSON is written (a single change that big stays on its device and is reported). Unpacking stops at 64 MiB, and parts stay at most 16 MiB, so every place's 64 MiB limit holds. `device.kev` is written when something was sent, and otherwise at most hourly. Names are cut at 64 characters.

**When something is wrong.** A file that does not open is tried again for an hour, and then set aside. It is recorded with its reason in the sync state, reported in the sync's summary and listed in Settings → Your devices, and the other files of that device follow. The other devices go on meanwhile. An event a projection cannot apply stays in the log and is reported, and the others apply. A file from a newer Vuurtoren waits for the update.

There are three kinds of place:

- **A Vuurtoren server** (`/api/sync`). A sync token made on that server's Your devices page opens it and the server's language server, and nothing else. The page served by that server makes its own token with its session. A phone trades a one-time pairing code from Add a device for its own token, which it keeps in its key store.
- **A folder** (desktop app). Writes go to a temporary file and are renamed, and links inside the folder are not followed.
- **WebDAV** (desktop app), with PROPFIND, PUT and MKCOL. The app sends the requests itself, so no CORS setup is needed, and it asks once before it sends to a new address.

Requests skip the browser cache. The store of a place is built once and kept while the place stays the same.

### 10.3 Encryption

Everything is locked on the device before it goes to the place, so the place never sees any content. A random **data key** (64 bytes) seals every file. It is an AES-256-GCM key and an HMAC-SHA256 key for blob names, so the names do not reveal what a file holds. A file is `KSY2` + a random 12-byte IV + ciphertext (segments gzipped first), sealed with its path as additional data, so a file copied or renamed by the place does not open. Files in the first format (`KSY1`, no path) open too. The vault holds the data key under two **locks**:

| Lock         | Key from                                                         |
| ------------ | ---------------------------------------------------------------- |
| passphrase   | Argon2id, 64 MiB, 3 passes, one lane, a random 16-byte salt      |
| recovery key | 160 random bits (32 letters and digits, shown once), HKDF-SHA256 |

- **Changing the passphrase** re-locks the data key. No file is encrypted again, and other devices keep syncing with the key they hold. It asks for the current passphrase or the recovery key first. A new recovery key replaces the old one.
- The passphrase and the recovery key are never stored, and the data key is kept in the device's key store (10.6). A new vault is written only after its data key is kept, so no vault exists that no device can open. A recovery key that is not confirmed as saved waits in the tab's session storage, so a reload shows it again.
- A passphrase is locked without the spaces around it. One that reads like a recovery key is refused. To open the vault, the recovery lock is tried first, then the passphrase lock.
- `vault.json` is checked before use: its shape, Argon2id at most 1 GiB and 10 passes, PBKDF2 at most 10 million rounds.
- A vault in the first format (PBKDF2-SHA256, 600,000 rounds, the key derived from the passphrase) opens too. Changing its passphrase turns it into the current format with that key as its data key, so no file changes.
- The place can see the number of devices, file sizes and when files were written, but not any content. A changed file is refused (GCM). A place can still delete files or serve older ones, so keep backups.

### 10.4 Order and conflicts

Devices change things at the same time, so every device needs to put all events in the same order and reach the same state. Events carry a hybrid logical clock (milliseconds, a counter, the device). Imported events newer than the end of the log are applied there. Otherwise the projections are rebuilt from the whole log in clock order, once per sync however many files came in (a replay cut short is done when the app next opens). Either way every device reaches the same state:

- **Latest wins** for settings, the language profile, word marks, deck options and a text's details. The last event in clock order sets them.
- **Merge** for reviews and answers, which add up. An answer to a native card stores the card's schedule before it. When the card has changed since (answered on another device), the answer is applied to the card as it is then (FSRS, without fuzz), so both answers count.
- **Intent** for other changes to native cards. A move from reading, new memory after tuning and an undo say what to do, and they are applied to the card as it is when they apply (sections 9.3, 9.5.1 and 9.6). So none of them undoes an answer from another device. Mark known and Study first set the card (a mature schedule, a place in the new queue), and the latest wins.
- **Merged answers depend on the scheduler.** A merged answer is computed whenever the log is replayed, with this app's FSRS and the parameters in use then. Devices on app versions whose scheduler differs can disagree slightly on such a card until its next answer. An answer that is not merged stores its result and replays the same everywhere.
- **Event versions.** Each event type has a payload version. An event newer than this app understands is stored and passed on, but not applied, and once the app is updated it applies it.

An incoming event must have an id and a clock as Vuurtoren makes them (a ULID, and a clock with 15 + 5 padded digits and the event's own device). It must be at most a day ahead of this device's clock, and it must not carry this device's id. New ids follow this device's own newest event, never another device's.

### 10.5 Compaction

`compact()` keeps the log small. It removes what later events made useless, without changing any projection. That is Anki snapshots older than the newest of their language (each replaces the last), and the analyses and the content of deleted texts (the import stays, emptied).

### 10.6 When it runs

Sync runs by itself, often enough that an open device sees another device's changes quickly:

| When                     | What                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| the app opens            | one sync                                                                           |
| a local change           | the log's head is read every 5 s; once it has stood still for 5 s, a sync sends it |
| focus, back in view      | a sync, unless one ran in the last 5 s                                             |
| every 15 s while visible | a sync, to pull what other devices sent                                            |
| hidden or closed         | a sync whenever something is not sent yet                                          |

So a change on one open device shows on another open device within about 5 to 20 seconds. After a failed sync nothing runs by itself for 15 seconds. During a practice session (a screen holds sync) nothing runs, and what was asked runs when the hold ends. On closing, the desktop app holds the window's close request, the page syncs (at most about 5 s), and then it lets the window close. In a browser the sync starts when the page is hidden, and the page lets go of its database only after it (at most 3 s). Hidden and closed both ask for a sync, and one sync answers both.

When changes came in, the services drop their caches and every screen refetches, also when the sync failed after some files came in. A sync that fails keeps its reason for Settings and shows in the top bar's indicator, and changes stay on the device until the next sync. Files that sync waits for or left out are kept with the status and listed in Settings → Your devices. When the key store has no key for the place, sync stops by itself and Settings asks for the passphrase (or recovery key), which brings the key back. Setting up, a sync, unlocking, a passphrase change and Stop run one at a time, so Stop during a setup stays stopped.

**Setting up** asks which device this is. **Start new sync data here** (the first device) refuses a place that already holds a vault or device folders. It writes `vault.json`, reads it back, and only then shows the recovery key. **Join my synced data** never writes a vault. If the first device's files haven't arrived yet (a synced folder still copying, or another folder, address or branch), it says so. Once the place is open, sync stays set up even when the first sync does not finish, and the recovery key is shown all the same. Passphrase changes and new recovery keys read `vault.json` back too.

**A restored backup** gets a new device id (two devices restored from one backup never share one). Its events not yet sent move to the new id (same event ids, so a device that has them skips them), so they still reach the other devices.

**On a Vuurtoren server** a sync token belongs to one device. The first device folder it writes is its own, and it writes only there and the blobs. It may create `vault.json` when there is none. Replacing it needs a session, the server's token, the sync token that made it, or one made with `vault` allowed (**May change the passphrase and recovery key**, which the page's own token has). All sync files share a quota (`VUURTOREN_SYNC_QUOTA_MB`, 2 GB). With sign-in off the server answers this site and `VUURTOREN_ALLOWED_ORIGINS` only.

**A lost device** keeps the data key. Revoking its sync token closes a Vuurtoren server to it. To be safe, start new sync data in a new place with a new passphrase and join it from the other devices (a new vault starts every device's bookkeeping over).

## 11. Where the Dutch rules live

Every rule about Dutch is in one of two places, so a correction is made once.

**On the device** (`packages/core/src/nl/`, exported from `@app/core`), each with its tests next
to it:

- `contextGloss.ts`: what a word means here, before the dictionary (possessives, names,
  diminutives, a detached particle that belongs to its verb). Section 3.5.
- `formLine.ts`: the line about a word's form on its card (plural, past tense, de or het).
- `sentenceFrame.ts`: how a sentence is built, part by part (the Sentence tab, 3.8), with its
  test cases (`frames.cases.ts`) and their tokens (`frames.fixture.json`, made by
  `apps/web/scripts/frames-fixture.mjs` from a running language server).

**On the language server** (`server/nlp/src/vuurtoren_nlp/`): the word lists are data, one file
per list in `rules/nl/` (`*.txt` one entry per line, `*.tsv` a pair per line; `#` starts a
comment), read through `rules.words()` and `rules.pairs()`. `tests/test_rules.py` checks that each
loads, has no entry twice, and is used. The rules that use them are code in these modules:

- `compound.py`: `suffix_heads.txt`
- `derive.py`: `abstract.txt`, `numbers.tsv`, `particles.txt`
- `grammar.py`: `diminutive_endings.txt`, `inseparable_verbs.txt`, `ipp_verbs.txt`, `irregular_plurals.txt`, `locative_advs.txt`, `locative_preps.txt`, `not_adjectives.txt`, `not_comparison.txt`, `not_places.txt`, `not_pronominal.txt`, `object_forms.txt`, `place_nouns.txt`, `possessives.txt`, `pronominal_preps.txt`, `quantity_subjects.txt`, `speech_verbs.txt`, `subordinators.txt`, `wh_words.txt`, `zijn_verbs.txt`
- `nl.py`: `r_prepositions.txt`
- `pipeline.py`: `words_not_abbreviations.txt`
- `wordforms.py`: `excluded.txt`

The detectors that find grammar in a sentence are in `grammar.py` (section 5); word forms in
`wordforms.py`, compounds in `compound.py`, derivations in `derive.py`, and the dictionary's
choices in `dictionary.py`.
