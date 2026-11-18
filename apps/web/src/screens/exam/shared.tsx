/**
 * Pieces shared by the exam screens: the clock, the score card, words to learn (Add to Anki,
 * Practice) and grammar links, plus recording an attempt.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Clock, Dumbbell, Plus } from "lucide-react";
import { useState } from "react";
import { type ExamPart, type Score, grammarTopic } from "@app/content";
import { AddToAnki, Button, Chip, useToast } from "@app/ui";
import { normalizeKey } from "@app/core";
import { useServices } from "../../services/context.js";
import type { ExamAttemptInput } from "../../services/examTypes.js";
import { errorText } from "../../services/errors.js";
import { formatClock } from "../../exam/timer.js";
import { pct } from "../../format.js";
import { useDeckChoice } from "../useDeckChoice.js";

/** The exam clock in the session bar: remaining time (exam) or elapsed time (practice). */
export function ExamClock({ remaining, elapsed }: { remaining: number | null; elapsed: number }) {
  const low = remaining !== null && remaining < 5 * 60_000;
  return (
    <span className="exam-clock" data-low={low || undefined} role="timer" aria-live="off">
      <Clock size={14} aria-hidden />
      {remaining !== null ? (
        <>
          <span className="k-sr">Time left: </span>
          {formatClock(remaining)}
        </>
      ) : (
        <>
          <span className="k-sr">Time spent: </span>
          {formatClock(elapsed)}
        </>
      )}
    </span>
  );
}

/** Score vs the estimated pass mark. */
export function ScoreCard({
  part,
  score,
  mode,
  unit = "points",
}: {
  part: ExamPart;
  score: Score;
  mode: "exam" | "practice";
  unit?: string;
}) {
  return (
    <section
      className="exam-score"
      data-part={part}
      aria-label="Your score"
      data-passed={score.passed || undefined}
    >
      <p className="exam-score-big">
        {score.correct}
        <span className="exam-score-of"> / {score.total}</span>
      </p>
      <div className="exam-score-text">
        <p className="exam-score-verdict">
          {score.passed ? "Likely pass" : "Not there yet"}
          <Chip tone={score.passed ? "success" : "neutral"}>{pct(score.ratio)}</Chip>
        </p>
        <p className="exam-muted">
          Pass mark about {score.passMark} {unit} of {score.total} (an estimate; the official pass
          marks are not published).
          {mode === "practice" ? " Practice rounds are easier than the timed exam." : ""}
        </p>
      </div>
    </section>
  );
}

/** Record a finished session once; refreshes the attempts list. */
export function useRecordAttempt() {
  const services = useServices();
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: ExamAttemptInput) => services.recordExamAttempt(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["exam", "attempts"] }),
    onError: (e) => toast("Your result could not be saved", errorText(e)),
  });
}

/** Words worth learning from a session: add each to Anki, or practise them all. */
export function WordsToLearn({ words }: { words: { lemma: string; en: string }[] }) {
  const deckChoice = useDeckChoice("reading");
  if (words.length === 0) return null;
  const keys = words.map((w) => normalizeKey(w.lemma)).filter(Boolean);
  return (
    <section className="exam-words" aria-labelledby="exam-words-h">
      <div className="exam-section-head">
        <h2 id="exam-words-h">Words to learn</h2>
        <Link
          to="/practice"
          search={{ words: keys.join(",") }}
          className="k-btn k-btn--secondary k-btn--sm"
        >
          <Dumbbell size={14} aria-hidden /> Practise these
        </Link>
      </div>
      <p className="exam-muted">From the texts where you missed a question.</p>
      <ul className="exam-word-list">
        {words.map((w) => (
          <WordRow key={w.lemma} lemma={w.lemma} en={w.en} deckChoice={deckChoice} />
        ))}
      </ul>
    </section>
  );
}

function WordRow({
  lemma,
  en,
  deckChoice,
}: {
  lemma: string;
  en: string;
  deckChoice: ReturnType<typeof useDeckChoice>;
}) {
  const services = useServices();
  const toast = useToast();
  const [added, setAdded] = useState<string | null>(null);
  const key = normalizeKey(lemma);
  const add = useMutation({
    mutationFn: async () => {
      const entry = await services.inspectWord(key);
      return services.addToAnki(
        entry.glosses.length ? entry : { ...entry, glosses: [en] },
        deckChoice.chosen ? { deck: deckChoice.chosen } : {},
      );
    },
    onSuccess: (r) => setAdded(r.deck),
    onError: (e) => toast(`Could not add ${lemma}`, errorText(e)),
  });
  return (
    <li className="exam-word">
      <Link to="/words" search={{ word: key }} className="exam-word-lemma" lang="nl">
        {lemma}
      </Link>
      <span className="exam-word-gloss">{en}</span>
      {added ? (
        <span className="exam-word-done">
          <Check size={14} aria-hidden /> Added
        </span>
      ) : deckChoice.addDeck ? (
        <AddToAnki
          {...deckChoice.addDeck}
          size="sm"
          variant="secondary"
          subject={lemma}
          disabled={add.isPending}
          onAdd={() => add.mutate()}
        />
      ) : (
        <Button size="sm" disabled={add.isPending} onClick={() => add.mutate()}>
          <Plus size={14} aria-hidden /> Anki
        </Button>
      )}
    </li>
  );
}

/** Links to the grammar pages a task practises (unknown ids are skipped). */
export function GrammarLinks({ ids }: { ids: readonly string[] }) {
  const topics = [...new Set(ids)].map((id) => grammarTopic(id)).filter((t) => t !== undefined);
  if (topics.length === 0) return null;
  return (
    <p className="exam-grammar">
      <span className="exam-muted">Grammar for this task:</span>{" "}
      {topics.map((t) => (
        <Link
          key={t.id}
          to="/grammar/$topic"
          params={{ topic: t.id }}
          className="exam-grammar-link"
        >
          {t.title}
        </Link>
      ))}
    </p>
  );
}
