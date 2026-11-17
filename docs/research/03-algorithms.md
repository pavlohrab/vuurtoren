# 03 — Algorithms: ingestion, learner model, graded reading, exercises (no AI)

> Verified Nov 2026: ts-fsrs/fsrs-rs APIs, Surya/docTR licences, simplemma language count, lindera/vibrato WASM builds. Everything else is from established literature and library docs. Pin versions and re-check licences before shipping.

## 1. Ingestion pipeline

image/PDF → raw text → clean (dehyphenate, merge lines, remove running headers) → sentences → tokens → lemma + POS + morph → `Token{surface, lemma, pos, feats, dep, sent_id, char_span}`

**OCR**

| Tool                            | Runs                             | Notes                                                                      |
| ------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| Apple Vision / Google ML Kit v2 | on device                        | Best default for mobile. ML Kit has no Arabic.                             |
| **Tesseract 5** / tesseract.js  | client or server                 | Apache-2.0, 100+ languages including `nld` and `ukr`. Fine on clean scans. |
| PaddleOCR                       | server (ONNX possible on device) | Apache-2.0. Strong on photos; has layout analysis.                         |
| docTR                           | server                           | Apache-2.0. Good on documents.                                             |
| Surya                           | server, GPU                      | GPL code; weights under modified OpenRAIL with a revenue cap. **Avoid.**   |

**PDF:** pdf.js (client, Apache-2.0), pypdfium2 (BSD). PyMuPDF is AGPL, so avoid it. A PDF with no text layer goes to OCR.

**Segmentation:** `Intl.Segmenter` (built into browsers; uses ICU, handles CJK and Thai) on the client; spaCy `senter` or pySBD on a server.

**Tokenization / lemmatization**

| Library                        | Runs                              | Notes                                                                                             |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| **spaCy**                      | server                            | MIT, ~25 languages including **nl** (`nl_core_news_sm/md/lg`) and **uk** (`uk_core_news_sm/trf`). |
| Stanza                         | server                            | UD-trained, 70+ languages, best morphology, slow.                                                 |
| UDPipe 2                       | server                            | Models are CC BY-NC-SA. Not for commercial use.                                                   |
| **simplemma**                  | Python, tables exportable to JSON | MIT, 48 languages including nl and uk. Good lite fallback.                                        |
| pymorphy3                      | server                            | Russian/Ukrainian morphology.                                                                     |
| lindera / vibrato / jieba-wasm | WASM                              | Japanese, Korean, Chinese.                                                                        |
| Snowball                       | anywhere                          | Matching fallback only.                                                                           |

## 2. Learner model

- **From Anki**, per card: target field, `ivl`, queue/type, and FSRS `{s, d}` from `cards.data`.
  - Retrievability R = (1 + F·t/S)^(−decay). FSRS-4.5/5: decay 0.5, F = 19/81. FSRS-6: decay is per preset.
- **States:** `unknown | seen | learning | known | ignored`, each with `p_known ∈ [0,1]`.
  - **Known:** ivl ≥ 21, or R ≥ 0.9 with S ≥ 21.
  - **Learning:** p = R.
  - **Reading signals:** exposure without a lookup bumps p with diminishing gains. A lookup sets the word to learning and lowers p.
  - **Unseen words:** prior from frequency rank vs estimated vocabulary size.
- **Vocabulary size:**
  - Yes/no test with pseudowords (LexTALE / VST, Nation & Beglar 2007), sampled per 1k frequency band.
  - Fit a logistic of p(known) vs log rank; vocab_est = Σp.
- **Frequency data:** wordfreq (CC-BY-SA, includes nl and uk), FrequencyWords (OpenSubtitles), Leipzig corpora.
- **CEFR:** Kelly lists (9 languages), CEFRLex family, CEFR-J (English).
  - Rough mapping: A1 ≈ 500, A2 ≈ 1000, B1 ≈ 2000, B2 ≈ 4000, C1 ≈ 8000 word families.
- **Text difficulty = token coverage** (known share of running tokens, excluding proper nouns and numbers):
  - Laufer 1989: 95% is the minimum.
  - Hu & Nation 2000: 98% for unassisted reading.
  - Schmitt, Jiang & Grabe 2011: comprehension rises roughly linearly with coverage.
  - Operational i+1: about 1 new lemma per 50 tokens.

## 3. Graded reading algorithm

1. Split the text into segments of about 150 tokens.
2. Score each: `cov = Σ p_known / N`, `new_types`, mean sentence length.
3. Pick segments near the target coverage T (start at 0.98) with ≤ B new types (5–8 per 300 tokens).
4. **Unknown words:**
   - Rank by `repeats × log(1/rank)`, keeping only rank ≤ vocab_est + 3000.
   - Top B → **introduce**: pre-teach, gloss on first occurrence.
   - Rare words, or words seen once → **gloss**.
   - Still below T → simplify, skip, or switch to **weave** (see 06).
5. **Clozes:**
   - Candidates are learning and known words; priority (1 − R) when R is in [0.7, 0.95], weighted by frequency.
   - At most one per sentence, about one per two sentences; skip sentence 0; sentence length ≥ 6.
   - Require ≥ 3 valid distractors.
6. **Staircase controller:**
   - If cloze accuracy is ≥ 85% and lookups are below 2%: T −= 0.005 (floor 0.92), B += 1.
   - If accuracy falls below 70%: T goes back up.
   - Can be upgraded later to Elo/IRT.
7. **Simplification:**
   - Rule-based: substitute known synonyms, drop parentheticals, split long sentences. Brittle.
   - LLM: optional, with the output re-scored.

## 4. Exercises without AI

| Exercise                           | Generation                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Cloze multiple choice / typed      | Sentence from your text or Tatoeba; distractors per §6c; accept the lemma or the right form; edit distance 1 = partial credit |
| Meaning multiple choice / matching | Glosses from Wiktextract/Kaikki; distractors of the same POS and frequency band                                               |
| Inflection drills                  | Wiktextract `forms[]`, UniMorph, mlconjug3, pattern (nl!), verbecc                                                            |
| Sentence scramble                  | 5–12 tokens, punctuation fixed                                                                                                |
| Dictation / listening              | Web Speech / OS TTS / Piper (MIT, ONNX); token diff                                                                           |
| Translation pairs                  | Tatoeba (CC-BY 2.0 FR): sentences where every word but the target is known                                                    |
| Collocations                       | High PMI/logDice pairs from a parsed corpus                                                                                   |
| **Dutch-specific**                 | de/het (gender from Wiktionary), separable-verb placement, perfectum hebben/zijn, adjective -e                                |
| **Ukrainian-specific**             | case endings, aspect pairs, motion verbs, stress                                                                              |

**Data licences:**

- Kaikki/Wiktextract: CC-BY-SA 3.0 + GFDL.
- Tatoeba: CC-BY.
- JMdict, CC-CEDICT: CC-BY-SA.
- OPUS/OpenSubtitles: use for frequency lists only.
- CC-BY-SA data can ship with attribution; derived data stays CC-BY-SA; app code is unaffected.

## 5. Scheduling

- **Do not write exercise results to Anki.** Context and multiple-choice options act as cues, so the results would corrupt FSRS.
- Keep the app's own **ts-fsrs** scheduler per (lemma, skill), with default parameters.
- Grading: multiple choice correct = Hard, typed correct = Good, fast typed = Easy, wrong = Again.
- Anki only receives new notes.

## 6. Pseudo-code

### (a) Known-word extraction

```
def build_known(anki_cards, lang, now):
    known = {}
    for c in anki_cards:
        word = clean(c.fields[TARGET_FIELD])
        key  = normalize(lemmatize(word, lang))     # SAME analyzer as texts
        R = fsrs_R(c) if c.fsrs else (0.9 if c.ivl >= 21 else min(0.9, c.ivl/21))
        state = KNOWN if (c.ivl >= 21 or (R >= 0.9 and c.fsrs.s >= 21)) else LEARNING
        known[key] = max_by_p(known.get(key), Entry(state, p=R))
    return known

def match(token):
    for k in (token.lemma, surface_index.get(norm(token.surface)), stem(token.surface)):
        if k and norm(k) in known: return known[norm(k)]
    return Entry(UNKNOWN, p=prior_from_freq(rank(token.lemma)))
```

### (b) Scoring and cloze selection

```
def score(seg, model):
    toks = [t for t in seg.tokens if t.is_word and not t.is_propn and not model.ignored(t)]
    cov  = sum(model.p(t) for t in toks) / len(toks)
    new  = {t.lemma for t in toks if model.p(t) < 0.5}
    return cov, new

def plan(seg, model, B):
    unk = Counter(t.lemma for t in seg.tokens if model.p(t) < 0.5)
    ranked = sorted(unk, key=lambda l: -(unk[l] * log(1e6/freq_rank(l))))
    introduce, gloss = ranked[:B], ranked[B:]
    clozes, used = [], set()
    cands = [t for t in seg.tokens if model.state(t) in (LEARNING, KNOWN)
             and t.sent_id != 0 and len(seg.sent(t.sent_id)) >= 6]
    for t in sorted(cands, key=lambda t: -(1-model.R(t)) * (0.7 <= model.R(t) <= 0.95)):
        if t.sent_id in used or len(clozes) >= len(seg.sents)//2: continue
        if len(distractors(t)) < 3: continue
        clozes.append(t); used.add(t.sent_id)
    return introduce, gloss, clozes
```

### (c) Distractors

```
def distractors(target, k=3):
    pool = lexicon.where(pos=target.pos)
    pool = [w for w in pool if abs(log(rank(w)) - log(rank(target.lemma))) < 0.5]
    sim  = {w: cos(vec(w), vec(target.lemma)) for w in pool}       # fastText cc.<lang>.300, top 50k
    cand = [w for w in pool if 0.25 < sim[w] < 0.6 and w not in synonyms(target.lemma)]
    cand += [w for w in pool if levenshtein(w, target.lemma) <= 2][:2]
    cand = [w for w in cand if ngram_score(ctx_with(w)) < ngram_score(ctx_with(target)) - margin]
    return prefer_known([inflect(w, target.feats) or w for w in dedupe(cand)])[:k]
```

References: Sakaguchi et al. 2013 (ACL); Jiang & Lee 2017 (BEA); Alhazmi et al. 2024 (arXiv 2402.01512).

## 7. Language difficulty

| Tier   | Languages                          | Notes                                                                        |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------- |
| Easy   | ES, IT, PT, FR, **NL**, DE, EN, SV | NL/DE compound splitting; **NL separable verbs need a dependency parse**     |
| Medium | RU, **UK**, PL, CS                 | Heavy inflection: lemmatizer required (spaCy uk / pymorphy3); stress for TTS |
| Medium | JA, ZH, KO                         | Need segmenters (lindera, jieba)                                             |
| Hard   | TR, FI, HU, AR, HE, TH, VI         | FST analyzers or server-side tools                                           |
