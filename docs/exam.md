# Exam preparation (`/exam`)

Practice for the Dutch **inburgeringsexamen at A2**. Facts, sources and what is uncertain:
[research/08-inburgering-a2.md](research/08-inburgering-a2.md) (last checked 2026-11-18).

## What is there

- **Overview** (`/exam`): the five parts with format, official duration, item count and an
  _estimated_ pass rule, the date the facts were checked, links to inburgeren.nl, DUO, IND and
  the official practice exams (linked, never embedded or copied).
- **Part pages** (`/exam/<part>`): two mock exams per part (practice or timed), KNM by theme,
  single writing tasks, an AI-written item for Lezen/Luisteren, and your results.
- **Sessions** (`/exam/<part>?mode=practice|exam&set=N` or `&theme=<knm theme | writing task id>`):
  - _Lezen / KNM_: multiple choice, options shuffled per session (seeded). Practice shows right
    or wrong with a short explanation; exam mode is timed (65 / 45 min), free navigation, hand in.
  - _Luisteren_: the fragment is read by the browser's Dutch voice (Web Speech, pitch per
    speaker), speed 0.75 / 0.9 / 1×, two plays per fragment in exam mode; the transcript appears
    after answering (practice) or in the review. Without a Dutch voice the transcript is shown.
  - _Schrijven_: form and free-writing tasks with a word count; after handing in a checklist
    (task points + A2 rubric), the model answer and links to grammar pages. With an AI provider:
    examiner-style feedback (verdict per point, corrections, corrected text); its verdicts tick
    the task points. The score is what is ticked.
  - _Spreken_: situation + question, a per-question clock; the answer is recorded with
    MediaRecorder when allowed and kept **in memory only** (playback for self-review, released
    when you leave). Model answer, checklist, optional AI feedback on a typed transcript.
- **Results**: score against the estimated pass mark, KNM by theme, a review of every question,
  and _Words to learn_ (vocabulary of texts with a missed question) with Add to Anki per word,
  a link to the word in Words and _Practise these_ (`/practice?words=`).
- **Home**: an _Exam prep_ step in Today once you have finished one session (first untried part,
  else the weakest latest result; done-state when you practised today).

## Content (`packages/content/exam/nl-a2/*.json`)

All items are original and written for this app in the official formats; none are copied from
DUO/CvTE material. `scripts/generate.ts` validates them (`src/exam.ts`: unique ids, 2–4 distinct
options, answer in range, known grammar topic ids) into `src/generated/exam.ts`.

| Part      | Volume                                                            |
| --------- | ----------------------------------------------------------------- |
| Lezen     | 20 texts, 50 questions (2 mocks of 25)                            |
| Luisteren | 24 fragments, 48 questions (2 mocks of 24)                        |
| Schrijven | 8 tasks (2 mocks of 4: one form + three messages)                 |
| Spreken   | 20 prompts (2 mocks of 10)                                        |
| KNM       | 88 questions, 11 per official theme (2 mocks of 40 = 5 per theme) |

Scoring rules live in `src/examScore.ts` (`scoreMc`, `scoreRubric`, `passMark`, `missedVocab`,
`optionOrder`); exam facts in `src/examInfo.ts` (`A2_EXAM`, update `lastChecked` when re-checked).

## Data

One event per finished session, `ExamAttempt` (`lang, exam, part, mode, setId, correct, total,
passMark, durationMs, at, missed?, words?`), folded from the log by `projectExamAttempts`
(`packages/db/src/exam.ts`, no table) and exposed as `examAttempts(lang)` (RPC allow-list and HTTP
client). Audio and typed answers are never stored.

## AI (only when a provider is set)

`packages/ai/src/exam.ts`: `generateExamItem` writes an original A2 item around the learner's
known lemmas, checks coverage with the reader's matcher and rewrites once if needed (kept only if
coverage does not drop); `examFeedback` judges a written answer or a typed spoken answer against
the task's checklist. Generated items are not stored.
