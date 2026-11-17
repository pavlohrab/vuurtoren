import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Dumbbell, ListChecks, MessagesSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { AddToAnki, AnkiStatusChip, Button, EmptyState, Lemma, Select, Skeleton } from "@app/ui";
import { useServices } from "../services/context.js";
import type { InspectorEntry, TextWordItem } from "../services/types.js";
import { useDeckChoice } from "./useDeckChoice.js";
import { usePageHeader } from "../shell/ShellContext.js";
import { PageHeader } from "../shell/PageHeader.js";
import {
  type Job,
  type RowResult,
  STUDY_FIRST_HINT,
  type WordAction,
  actionOptions,
  applyActions,
  defaultAction,
  summarize,
} from "./textWordsActions.js";

import "./textWords.css";

const errorMessage = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : "Something went wrong. Try again.";

const SOURCE_LABEL: Record<TextWordItem["source"], string | null> = {
  introduce: null,
  lookup: "Looked up",
  gloss: "Translated",
};

/** Route component: reads the text id from the URL. */
export function TextWordsRoute() {
  const { textId } = useParams({ from: "/read/$textId/words" });
  return <TextWords key={textId} textId={textId} />;
}

/**
 * "Words from this text": the words worth keeping from a finished text, each with the sentence
 * it came from, its state in Anki and a chosen action. Nothing is written until Apply.
 */
export function TextWords({ textId }: { textId: string }) {
  const services = useServices();
  const qc = useQueryClient();
  const [includeGlossed, setIncludeGlossed] = useState(false);
  /** Actions the learner changed; rows not listed use the default for their Anki state. */
  const [choices, setChoices] = useState<ReadonlyMap<string, WordAction>>(new Map());
  const [results, setResults] = useState<ReadonlyMap<string, RowResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const reading = useQuery({
    queryKey: ["reading", textId],
    queryFn: () => services.getReading(textId),
  });
  // The top bar names the text; the page heading names the review.
  usePageHeader(reading.data?.text.title ?? "Words");
  // No refetch on focus: statuses must not shift while the learner is choosing or applying.
  const words = useQuery({
    queryKey: ["textWords", textId, includeGlossed],
    queryFn: () => services.textWords(textId, { includeGlossed }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const deckChoice = useDeckChoice(reading.data?.text.sourceKind === "ai" ? "ai" : "reading");
  const actionOf = (w: TextWordItem): WordAction =>
    choices.get(w.key) ?? defaultAction(w.entry.anki.status);
  const isDone = (w: TextWordItem) => results.get(w.key)?.ok === true;

  const jobs: Job[] = useMemo(
    () =>
      (words.data ?? []).flatMap((item) => {
        const action = choices.get(item.key) ?? defaultAction(item.entry.anki.status);
        const locked =
          results.get(item.key)?.ok === true || item.entry.anki.status === "unavailable";
        return action === "skip" || locked ? [] : [{ item, action }];
      }),
    [words.data, choices, results],
  );

  const apply = async () => {
    if (running || jobs.length === 0) return;
    setRunning(true);
    setSummary(null);
    const batch = new Map<string, RowResult>();
    try {
      // New notes go to the deck shown in the apply bar (the picker's choice, if any).
      const opts = deckChoice.chosen ? { deck: deckChoice.chosen } : undefined;
      const writes = {
        addToAnki: (e: InspectorEntry) => services.addToAnki(e, opts),
        learnNext: (e: InspectorEntry) => services.learnNext(e),
        markKnown: (e: InspectorEntry) => services.markKnown(e, opts),
      };
      await applyActions(jobs, writes, {
        onProgress: (done, total, item) =>
          setProgress(`Applying ${done + 1} of ${total}: ${item.lemma}`),
        onResult: (key, result) => {
          batch.set(key, result);
          setResults((prev) => new Map(prev).set(key, result));
        },
      });
      setSummary(summarize(batch.values()));
    } finally {
      setRunning(false);
      setProgress(null);
      // Mark the data stale without refetching this page: the rows keep showing what happened.
      void qc.invalidateQueries({ queryKey: ["textWords"], refetchType: "none" });
      for (const k of ["reading", "words", "learner", "texts", "inspect"]) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    }
  };

  const title = reading.data?.text.title;
  const list = words.data;

  return (
    <div className="page page--narrow">
      <PageHeader
        title="Words from this text"
        lede={
          <>
            {title ? `From “${title}”. ` : ""}
            Choose what to do with each word, then apply. Nothing changes in Anki until you do.
          </>
        }
        actions={
          list && list.length > 0 ? (
            <>
              <Link
                to="/talk"
                search={{
                  words: list
                    .slice(0, 6)
                    .map((w) => w.lemma)
                    .join(","),
                  ...(title ? { topic: title } : {}),
                }}
                className="k-btn k-btn--ghost"
              >
                <MessagesSquare size={16} aria-hidden /> Talk about it
              </Link>
              <Link
                to="/practice"
                search={{ words: list.map((w) => w.key).join(",") }}
                className="k-btn k-btn--secondary"
              >
                <Dumbbell size={16} aria-hidden /> Practise these words
              </Link>
            </>
          ) : null
        }
      />

      <div className="tw-toolbar">
        <label className="tw-check">
          <input
            type="checkbox"
            checked={includeGlossed}
            onChange={(e) => setIncludeGlossed(e.target.checked)}
          />
          Show translated words too
        </label>
        <span className="tw-links">
          <Link to="/read/$textId" params={{ textId }}>
            Back to the text
          </Link>
          <Link to="/words" search={{ source: `text:${textId}` }}>
            Open in Words
          </Link>
        </span>
      </div>

      {words.isPending ? (
        <div className="stack" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 96, borderRadius: 10 }} />
          ))}
        </div>
      ) : words.isError && !list ? (
        <div role="alert" className="stack">
          <p className="error-text">The words could not be loaded. {errorMessage(words.error)}</p>
          <div>
            <Button onClick={() => void words.refetch()}>Try again</Button>
          </div>
        </div>
      ) : list && list.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={28} />}
          title="No new words in this text"
          description="Nothing was highlighted or looked up here, so there is nothing to add."
          action={
            <Link to="/library" className="k-btn k-btn--primary">
              Back to the library
            </Link>
          }
        />
      ) : (
        <>
          <ul className="tw-list" aria-label="Words from this text">
            {(list ?? []).map((w) => (
              <WordRow
                key={w.key}
                item={w}
                action={actionOf(w)}
                result={results.get(w.key)}
                done={isDone(w)}
                disabled={running}
                onAction={(a) => setChoices((prev) => new Map(prev).set(w.key, a))}
              />
            ))}
          </ul>
          <div className="tw-apply">
            <p className="tw-apply-text" role="status" aria-live="polite">
              {progress ?? summary ?? ""}
            </p>
            {deckChoice.addDeck && jobs.some((j) => j.item.entry.anki.status === "absent") ? (
              <AddToAnki
                {...deckChoice.addDeck}
                label="New cards to"
                size="md"
                disabled={running}
              />
            ) : null}
            <Button
              variant="primary"
              disabled={running || jobs.length === 0}
              onClick={() => void apply()}
            >
              {running
                ? "Applying…"
                : jobs.length === 0
                  ? "Apply"
                  : `Apply ${jobs.length} ${jobs.length === 1 ? "action" : "actions"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface WordRowProps {
  item: TextWordItem;
  action: WordAction;
  result: RowResult | undefined;
  done: boolean;
  disabled: boolean;
  onAction: (action: WordAction) => void;
}

/** One word: headword, meaning, the sentence with the word highlighted, status and action. */
function WordRow({ item, action, result, done, disabled, onAction }: WordRowProps) {
  const { anki } = item.entry;
  const unavailable = anki.status === "unavailable";
  const [from, to] = item.sentenceHighlight;
  const s = item.sentence;
  const source = SOURCE_LABEL[item.source];
  const withArticle = item.article && item.pos === "NOUN";
  return (
    <li className="tw-row">
      <div className="tw-head">
        <Lemma className="tw-word" lemma={item.lemma} article={withArticle ? item.article : null} />
        <AnkiStatusChip status={anki.status} />
        {source ? <span className="tw-source">{source}</span> : null}
      </div>
      <p className="tw-meaning">{item.glosses[0] ?? "No meaning found"}</p>
      <p className="tw-sentence" lang="nl">
        {s.slice(0, from)}
        <mark>{s.slice(from, to)}</mark>
        {s.slice(to)}
      </p>
      {item.entry.sentenceTranslation ? (
        <p className="tw-translation" lang="en">
          {item.entry.sentenceTranslation}
        </p>
      ) : null}
      <div className="tw-action" title={action === "learn" ? STUDY_FIRST_HINT : undefined}>
        <Select
          label={`Action for ${item.lemma}`}
          value={unavailable ? "skip" : action}
          options={
            unavailable ? [{ value: "skip", label: "Unavailable" }] : actionOptions(anki.status)
          }
          onValueChange={(v) => onAction(v as WordAction)}
          disabled={disabled || done || unavailable}
        />
        {unavailable ? (
          <p className="tw-result tw-result--bad">
            Actions are unavailable{anki.detail ? `: ${anki.detail}` : "."}
          </p>
        ) : result ? (
          <p
            className={result.ok ? "tw-result" : "tw-result tw-result--bad"}
            role={result.ok ? "status" : "alert"}
          >
            {result.ok ? `Done. ${result.message}` : `Failed. ${result.message}`}
          </p>
        ) : null}
      </div>
    </li>
  );
}
