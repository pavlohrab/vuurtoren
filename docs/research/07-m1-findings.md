# 07 — M1 findings on a real collection (2026-11-17)

Collection: 11 Dutch decks (A Frequency Dictionary of Dutch + 10 _De Opmaat A2_ themes), 7,422 notes, 9,008 cards, 621 reviewed. AnkiConnect with API v1, Anki 26.08.1. **FSRS off** (SM-2).

## Gate result

| metric                                         | value                                                          |
| ---------------------------------------------- | -------------------------------------------------------------- |
| decks/note types auto-detected                 | 11/11, after pooling share per note type (Thema 03 alone: 43%) |
| unique keys (headwords + aliases)              | 5,700                                                          |
| known / learning / unknown                     | 269 / 316 / 5,115                                              |
| **headword found in its own example sentence** | **99.4%** (6,971 of 7,039); studied notes 569/571              |

The sentence check is the automatic gate. Each note's example sentence must contain its headword according to the text analyzer, which exercises the card ↔ text matching end to end. Sentences that already contain a cloze blank (`____`) are excluded.

## What we learned (and changed)

1. **Don't re-lemmatize headwords.** Vocabulary decks list citation forms already. spaCy without context gets them wrong: vragen → vraag, staat → staan, geleden → lijden, pensioneren → pensioner. The key is now the headword; alternatives ("zij, ze", "kost, kosten") become aliases; "(zich)" marks reflexive verbs; "het of de X" and "door ... gaan" are handled.
2. **spaCy's nl lemmatizer is weak on inflection.** It produced betekeniss, pott, juwe, knipken, regeeren, and left past tenses untouched (ontdekten, sneed). Fix: combine it with simplemma's dictionary lemma. Keep spaCy when its lemma is a known, changed word; otherwise take the dictionary lemma. Hit rate went from 89% to 99%.
3. **Matcher candidates (recall, never the primary lemma):** de-inflected adjectives (bepaalde → bepaald), plural stems (katten → kat), fused separable forms (aangelopen → aanlopen), te-infinitives (in te stellen → instellen), clause-final particles the parser missed (Trek … aan → aantrekken), and the bare verb next to a joined particle verb.
4. **Particle bugs:** spaCy invents particles (bel → terugbellen) and double-joins (af + opbouwen). Both are fixed.
5. **Language ID on short fields:** lingua returns an all-zero list for numbers, and its arbitrary first entry was "nl". A numeric "Freq" field was picked as the word field. Low-confidence or letterless input now yields no language, and only fields with letters are considered.
6. **Several decks per learner is normal.** The learner model merges all of them (1,328 words occur in more than one deck).
7. **FSRS is often off.** Recall is then estimated as 0.9^(days since last review / interval). When FSRS is on, v1 `scheduling.get` supplies stability (batched JSON-RPC, 100 per request).

## Remaining misses (long tail, accepted)

- Reordered idioms (nodig hebben, zorgen maken).
- 1st-person verb stems (ik droom → dromen).
- Rare spaCy mis-tags.
- Deck data errors (random/rondom, west/westen).

## Update after the precision review (same day)

- An independent review showed the gate above measured **recall only**: lemma, alternative and surface matches can only add hits. Precision is now covered by `server/nlp/tests/test_precision.py` (58 labelled sentences).
- Lemma choice is now precision-first. spaCy's unchanged lemma is kept unless the morphology says the word is inflected, and the Wiktionary forms table is used as a lemma oracle. Result: **99.1%** (64 misses of 7,039), with studied words at 570/571.
- The new misses are mostly past tenses spaCy leaves unchanged, and stranded particles after _hier/daar_. These are the cost of no longer producing false matches such as _bellen → bel_ and _kat → kater_.
