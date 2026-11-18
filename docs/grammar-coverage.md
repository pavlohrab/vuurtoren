# Grammar coverage

The Dutch grammar pages in `packages/content/grammar/nl`, grouped the way the Grammar screen can show them. The number is the position on the suggested learning path (`order`), the level is the CEFR level of the page. The last column lists the detectors (`server/nlp/src/kenning_nlp/grammar.py`) whose hits a page shows; a page without one is reading-only.

The pages were checked for completeness against two standard reference grammars of Dutch (a learner grammar and a comprehensive reference grammar). Every chapter of both maps to a page below or to a section of one, except pronunciation, spelling history, punctuation detail and pure vocabulary lists. All explanations and example sentences are original.

## Spelling & word building

| #   | Topic                                                                 | Level | Detectors |
| --- | --------------------------------------------------------------------- | ----- | --------- |
| 1   | Spelling rules (one vowel or two) (`spelling-rules`)                  | A1    |           |
| 50  | Building words (compounds, -heid, -ing, -er, on-…) (`word-formation`) | B1    |           |

## Word order

| #   | Topic                                                                  | Level | Detectors                                   |
| --- | ---------------------------------------------------------------------- | ----- | ------------------------------------------- |
| 6   | The verb in second place (V2) (`word-order-v2`)                        | A1    | inversion                                   |
| 7   | Questions and question words (`questions`)                             | A1    | questions                                   |
| 8   | Saying no (niet and geen) (`negation`)                                 | A1    | negation                                    |
| 16  | Inversion (`inversion`)                                                | A2    | inversion                                   |
| 17  | The verb bracket (two verbs, two places) (`verb-bracket`)              | A2    | modal-verbs, perfect-tense, separable-verbs |
| 18  | Time, manner, place (`time-manner-place`)                              | A2    |                                             |
| 33  | Where does niet go? (`niet-position`)                                  | B1    | niet-position, negation                     |
| 51  | Verb clusters and "infinitive instead of participle" (`verb-clusters`) | B2    | verb-clusters                               |

## Verbs

| #   | Topic                                                                                   | Level | Detectors            |
| --- | --------------------------------------------------------------------------------------- | ----- | -------------------- |
| 3   | The present tense (`present-tense`)                                                     | A1    |                      |
| 13  | The imperative (`imperative`)                                                           | A1    | imperative           |
| 14  | Modal verbs (kunnen, willen, moeten, mogen) (`modal-verbs`)                             | A1    | modal-verbs          |
| 19  | Separable verbs (`separable-verbs`)                                                     | A2    | separable-verbs      |
| 20  | The perfect tense (heb gewerkt) (`perfect-tense`)                                       | A2    | perfect-tense        |
| 21  | hebben or zijn in the perfect (`hebben-or-zijn`)                                        | A2    | perfect-tense        |
| 22  | The simple past (werkte, liep) (`imperfect-tense`)                                      | A2    | imperfect-tense      |
| 23  | Strong and irregular verbs (`irregular-verbs`)                                          | A2    | imperfect-tense      |
| 24  | Talking about the future (`future`)                                                     | A2    | future               |
| 31  | Reflexive verbs (zich wassen) (`reflexive-verbs`)                                       | A2    | reflexive-verbs      |
| 39  | would and should (zou, zouden) (`conditional`)                                          | B1    | conditional          |
| 40  | The past perfect (had gedaan) (`past-perfect`)                                          | B1    | past-perfect         |
| 41  | The passive (worden and zijn) (`passive`)                                               | B1    | passive              |
| 42  | Busy doing (aan het + infinitive, zitten te) (`progressive`)                            | B1    | progressive          |
| 43  | staan, liggen, zitten and zetten, leggen (`position-verbs`)                             | B1    | position-verbs       |
| 45  | Inseparable prefixes (be-, ver-, ont-…) (`inseparable-prefixes`)                        | B1    | inseparable-prefixes |
| 46  | laten (let, have something done, let's) (`laten`)                                       | B1    | laten, verb-clusters |
| 47  | Easily confused verbs (kennen/weten, wonen/leven…) (`verb-pairs`)                       | B1    |                      |
| 52  | would have and will have (zou hebben gedaan, zal hebben gedaan) (`conditional-perfect`) | B2    | conditional-perfect  |
| 53  | The impersonal passive (er wordt gedanst) (`impersonal-passive`)                        | B2    | impersonal-passive   |
| 61  | Old wish forms (leve de koning, het zij zo) (`subjunctive`)                             | C1    |                      |

## Infinitives & participles

| #   | Topic                                                                             | Level | Detectors        |
| --- | --------------------------------------------------------------------------------- | ----- | ---------------- |
| 36  | Infinitive with or without te (`te-infinitive`)                                   | B1    | te-infinitive    |
| 37  | om … te, zonder te, door te (`om-te-infinitive`)                                  | B1    | om-te-infinitive |
| 54  | Participles as adjectives (de gestolen fiets, lachend) (`participles`)            | B2    |                  |
| 55  | The infinitive as a noun (het lezen van…) (`infinitive-as-noun`)                  | B2    |                  |
| 58  | Long phrases before a noun (de door hem geschreven brief) (`extended-attributes`) | C1    |                  |

## Nouns & articles

| #   | Topic                                                | Level | Detectors                   |
| --- | ---------------------------------------------------- | ----- | --------------------------- |
| 4   | de, het and een (`de-het`)                           | A1    | diminutives, demonstratives |
| 5   | Plural nouns (-en and -s) (`plural-nouns`)           | A1    | plural-nouns                |
| 27  | Diminutives (-je, -tje, -pje, -etje) (`diminutives`) | A2    | diminutives                 |

## Pronouns

| #   | Topic                                                               | Level | Detectors           |
| --- | ------------------------------------------------------------------- | ----- | ------------------- |
| 2   | Subject pronouns (ik, jij, je, u…) (`personal-pronouns`)            | A1    |                     |
| 11  | Possessives (mijn, jouw, van mij, de mijne) (`possessive-pronouns`) | A1    | possessive-pronouns |
| 12  | this and that (deze, dit, die, dat) (`demonstratives`)              | A1    | demonstratives      |
| 15  | Object pronouns (me, hem, haar, ze…) (`object-pronouns`)            | A2    | object-pronouns     |
| 32  | iemand, niemand, iets, niets, alles, elk… (`indefinite-pronouns`)   | A2    |                     |

## Adjectives & adverbs

| #   | Topic                                                    | Level | Detectors            |
| --- | -------------------------------------------------------- | ----- | -------------------- |
| 25  | Adjective endings (the -e rule) (`adjective-inflection`) | A2    | adjective-inflection |
| 26  | Comparing (groter, grootst) (`comparison`)               | A2    | comparison           |
| 48  | Adverbs (how, when, where, how much) (`adverbs`)         | B1    |                      |

## Sentences & clauses

| #   | Topic                                                                  | Level | Detectors             |
| --- | ---------------------------------------------------------------------- | ----- | --------------------- |
| 29  | Joining main clauses (en, maar, want, of, dus) (`conjunctions`)        | A2    | conjunctions          |
| 30  | Subordinate clauses (verb at the end) (`subordinate-clauses`)          | A2    | subordinate-clauses   |
| 34  | Relative clauses (die, dat, wat, waar-) (`relative-pronouns`)          | B1    | relative-pronouns     |
| 35  | Reported speech and indirect questions (`indirect-speech`)             | B1    | indirect-speech       |
| 56  | Linking adverbs (daarom, toch, dus, immers) (`conjunctional-adverbs`)  | B2    | inversion             |
| 59  | Conditions without als (Had je gebeld, dan…) (`conditional-inversion`) | C1    | conditional-inversion |

## Small words

| #   | Topic                                                                            | Level | Detectors                                 |
| --- | -------------------------------------------------------------------------------- | ----- | ----------------------------------------- |
| 28  | Prepositions of place, time and movement (`prepositions`)                        | A2    |                                           |
| 38  | The word er (four jobs) (`er`)                                                   | B1    | er                                        |
| 44  | Verbs and adjectives with fixed prepositions (`verbs-with-prepositions`)         | B1    | verbs-with-prepositions                   |
| 49  | Little words that add tone (even, maar, toch, wel, eens…) (`modal-particles`)    | B1    | modal-particles                           |
| 57  | erop, daarmee, waarover (er/daar/hier/waar + preposition) (`pronominal-adverbs`) | B2    | pronominal-adverbs, er, relative-pronouns |
| 60  | One er, two jobs (Er liggen er drie; er wordt veel over gepraat) (`er-combined`) | C1    | er                                        |

## Numbers & time

| #   | Topic                                               | Level | Detectors |
| --- | --------------------------------------------------- | ----- | --------- |
| 9   | Numbers, ordinals and amounts (`numbers`)           | A1    |           |
| 10  | Dates, days and telling the time (`dates-and-time`) | A1    |           |

## Register & variation

| #   | Topic                                                              | Level | Detectors |
| --- | ------------------------------------------------------------------ | ----- | --------- |
| 62  | Formal and informal Dutch (hetgeen, men, gij, emails) (`register`) | C1    |           |
| 63  | Dutch in Flanders and the Netherlands (`flemish-dutch`)            | C1    |           |

## Reader detectors (2026-11): precision

Eight detectors added for the reader's margin marks: `pronominal-adverbs` (fused and split er/daar/hier/waar + preposition), `position-verbs` (staan/liggen/zitten/hangen with a place, or + te + infinitive), `laten` (+ infinitive, laten we), `verbs-with-prepositions` (51 curated verb/adjective + preposition pairs, also with a split pronominal adverb), `niet-position` (only when the scope is clear: before a predicate adjective, before a prepositional phrase of its own verb, or clause-final after a definite object), `inseparable-prefixes` (curated list of 70 common be-/ge-/her-/ont-/ver-/er- verbs), `modal-particles` (even/maar/eens/toch/nou/hoor, only in requests, questions or exclamations) and `object-pronouns` (object forms, reflexive uses and possessive look-alikes excluded). Each has hand-labelled cases in `server/nlp/tests/grammar_cases.py`.

Precision was judged by hand on random Tatoeba sentences (4–18 words) from `sentences-nl.sqlite`:

| Topic                   | Tuning set (2000 sentences) | Held-out (1000 sentences) |
| ----------------------- | --------------------------- | ------------------------- |
| pronominal-adverbs      | 38 / 38                     | 18 / 18                   |
| position-verbs          | 31 / 31                     | 9 / 11                    |
| laten                   | 19 / 19                     | 14 / 14                   |
| verbs-with-prepositions | 73 / 73                     | 37 / 37                   |
| niet-position           | 65 / 67                     | 27 / 28                   |
| inseparable-prefixes    | 108 / 108                   | 55 / 56                   |
| modal-particles         | 6 / 6                       | 5 / 5                     |
| object-pronouns         | 176 / 177                   | 108 / 109                 |
| **all**                 | **516 / 519 (99.4%)**       | **273 / 278 (98.2%)**     |

The tuning set was used to write the exclusions, so its number is optimistic; the held-out number was taken before the last three fixes (a noun "hen", "verrassend", "op de universiteit zitten"). Recall is deliberately low for `modal-particles` (wel, gewoon and statement uses of toch are left out) and for `niet-position` (only unambiguous scopes). Very common phenomena (V2/inversion, de/het, plurals…) are shown in the reader's focus mode only, never as margin marks.
