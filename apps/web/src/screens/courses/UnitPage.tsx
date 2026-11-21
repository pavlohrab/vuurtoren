import { pct, plural } from "../../format.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MessagesSquare, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  AnkiStatusChip,
  Button,
  Chip,
  Lemma,
  Skeleton,
  Tabs,
  Tooltip,
  WordStateChip,
  useNativeMode,
  useToast,
} from "@app/ui";
import { storySearch, useAIReady } from "../StoryForm.js";
import { MenuButton } from "../library/MenuButton.js";
import { type WordInspectorHandle, useWordInspector } from "../useWordInspector.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { usePageHeader } from "../../shell/ShellContext.js";
import { PageHeader } from "../../shell/PageHeader.js";
import type { UnitGrammarTopic, UnitView, UnitWordView } from "../../services/courseTypes.js";
import { AddWordsDialog } from "./AddWordsDialog.js";
import { BookExercise } from "./BookExercise.js";
import "./courses.css";

/** Word state, or the card status for unit words that have no card at all. */
function UnitWordState({ state }: { state: UnitWordView["state"] }) {
  return state === "absent" ? <AnkiStatusChip status="absent" /> : <WordStateChip state={state} />;
}

const STUDY_FIRST_HINT = {
  anki: "Moves the unit's new cards to the front of Anki's queue, so Anki shows them next.",
  native: "Moves the unit's new cards to the front of your review queue, so they come next.",
};

function ReadTab({ unit }: { unit: UnitView }) {
  if (unit.texts.length === 0) {
    return <p className="cs-note">No reading texts were found in this unit.</p>;
  }
  return (
    <ul className="cs-words" style={{ gridTemplateColumns: "1fr" }}>
      {unit.texts.map((t, i) => (
        <li key={i}>
          <span lang="nl">{t.label}</span>
          <Chip>{t.kind === "transcript" ? "listening transcript" : "reading text"}</Chip>
          <span className="cs-gloss">
            page {t.page} · {t.words} words
          </span>
          {t.textId ? (
            <>
              <Link to="/read/$textId" params={{ textId: t.textId }}>
                Read
              </Link>
              <Link to="/read/$textId/words" params={{ textId: t.textId }}>
                Words
              </Link>
            </>
          ) : (
            <span className="cs-gloss">not in your texts</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The unit's words: each opens the word inspector here; the card actions for the unit and the
 * ways on (Practice, Words) sit above the list.
 */
function WordsTab({
  unit,
  courseId,
  n,
  inspector,
  anki,
}: {
  unit: UnitView;
  courseId: string;
  n: number;
  inspector: WordInspectorHandle;
  anki: ReactNode;
}) {
  const native = useNativeMode();
  if (unit.words.length === 0) {
    return (
      <p className="cs-note">
        This unit has no word list yet. Map it to {native ? "a deck" : "an Anki deck"} and its notes
        become the unit&rsquo;s words.
      </p>
    );
  }
  const keys = unit.words.map((w) => w.key);
  const toLearn = unit.words.filter((w) => w.state !== "known").map((w) => w.key);
  return (
    <>
      <div className="cs-actions" style={{ marginBottom: 12 }}>
        <Link
          to="/practice"
          search={{ words: (toLearn.length ? toLearn : keys).slice(0, 60).join(",") }}
          className="k-btn k-btn--secondary k-btn--sm"
        >
          Practise these words
        </Link>
        {anki}
        <Link
          to="/words"
          search={{ source: `unit:${courseId}/${n}` }}
          className="k-btn k-btn--ghost k-btn--sm"
        >
          Open in Words
        </Link>
      </div>
      <ul className="cs-words">
        {unit.words.map((w) => (
          <li key={w.key}>
            <button
              type="button"
              className="cs-word-link"
              aria-pressed={inspector.current === w.key}
              onClick={(e) => inspector.openKey(w.key, e.currentTarget)}
            >
              <Lemma lemma={w.lemma} article={w.article} />
            </button>
            <UnitWordState state={w.state} />
            {w.gloss ? <span className="cs-gloss">{w.gloss}</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Grammar the unit's texts show (linked to the topic pages), then the book's own notes. */
function GrammarTab({ unit, topics }: { unit: UnitView; topics: UnitGrammarTopic[] | undefined }) {
  return (
    <>
      {topics === undefined ? (
        <Skeleton style={{ height: 60, borderRadius: 8 }} />
      ) : topics.length > 0 ? (
        <section aria-label="Grammar in this unit">
          <p className="cs-note">
            Grammar this unit&rsquo;s texts use most. Each topic page explains it with examples and
            has its own practice.
          </p>
          <ul className="cs-grammar-list">
            {topics.map((t) => (
              <li key={t.topicId}>
                <div>
                  <Link
                    to="/grammar/$topic"
                    params={{ topic: t.topicId }}
                    className="cs-unit-title"
                  >
                    {t.title}
                  </Link>{" "}
                  <Chip>{t.level}</Chip>
                  <p className="cs-meta">{t.summary}</p>
                  {t.example ? (
                    <p className="cs-example" lang="nl">
                      {t.example}
                    </p>
                  ) : null}
                </div>
                <span className="cs-meta">{plural(t.count, "sentence")}</span>
                <Link
                  to="/grammar/$topic/practice"
                  params={{ topic: t.topicId }}
                  className="k-btn k-btn--secondary k-btn--sm"
                >
                  Practise
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="cs-note">No grammar topics were found in this unit&rsquo;s texts.</p>
      )}
      {unit.grammar.length > 0 ? (
        <details className="cs-booknotes" open={unit.unit.kind === "grammar"}>
          <summary>Grammar notes from your book</summary>
          {unit.grammar.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              {g.topicId ? (
                <p className="cs-meta">
                  <Link to="/grammar/$topic" params={{ topic: g.topicId }}>
                    Vuurtoren&rsquo;s page on this topic
                  </Link>
                </p>
              ) : null}
              <pre className="cs-raw" lang="nl">
                {g.text}
              </pre>
            </section>
          ))}
        </details>
      ) : null}
    </>
  );
}

/** "Generate exercises like this unit" (only with a configured AI provider). */
function GenerateButton({
  courseId,
  n,
  onDone,
}: {
  courseId: string;
  n: number;
  onDone: () => void;
}) {
  const services = useServices();
  const toast = useToast();
  const ready = useAIReady();
  const [progress, setProgress] = useState<string | null>(null);
  const gen = useMutation({
    mutationFn: () => services.generateUnitExercises(courseId, n, setProgress),
    onSuccess: (r) => {
      setProgress(null);
      toast(
        r.added > 0 ? `${r.added} new items for this unit` : "No new items passed the checks",
        [
          r.grammarTopic ? `With ${r.grammarTopic}.` : "",
          r.rejected ? `${r.rejected} sentences were dropped by the checks.` : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
      );
      onDone();
    },
    onError: (e) => {
      setProgress(null);
      toast("Could not make exercises", errorText(e));
    },
  });
  if (!ready) return null;
  return (
    <div className="cs-actions">
      <Button disabled={gen.isPending} onClick={() => gen.mutate()}>
        <Sparkles size={16} aria-hidden />
        {gen.isPending ? (progress ?? "Working…") : "Generate exercises like this unit"}
      </Button>
    </div>
  );
}

/** One unit: reading, book exercises, words and grammar. */
export function UnitRoute({ courseId, n }: { courseId: string; n: number }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const aiReady = useAIReady();
  const inspector = useWordInspector("course");
  const native = useNativeMode();
  const where = native ? "" : " in Anki";
  const studyFirstHint = native ? STUDY_FIRST_HINT.native : STUDY_FIRST_HINT.anki;
  const [tab, setTab] = useState("exercises");
  const [adding, setAdding] = useState(false);
  const key = ["unit", courseId, n];
  const unit = useQuery({ queryKey: key, queryFn: () => services.unit(courseId, n) });
  const grammar = useQuery({
    queryKey: ["unit-grammar", courseId, n],
    queryFn: () => services.unitGrammar(courseId, n),
  });
  usePageHeader(unit.data?.unit.title ?? "Unit", {
    parent: { label: unit.data?.course.title ?? "Courses", to: `/courses/${courseId}` },
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["course", courseId] });
  };

  const learn = useMutation({
    mutationFn: () => services.learnNextForUnit(courseId, n),
    onSuccess: (r) => {
      toast(
        r.moved > 0 ? `${plural(r.moved, "word")} moved to the front${where}` : "Nothing to move",
        r.skipped > 0
          ? `${plural(r.skipped, "word")} ${r.skipped === 1 ? "has" : "have"} no new card.`
          : undefined,
      );
      refresh();
    },
    onError: (e) => toast(`Could not move the cards${where}`, errorText(e)),
  });
  if (unit.isPending) {
    return (
      <div className="page">
        <Skeleton style={{ height: 120, borderRadius: 10 }} />
      </div>
    );
  }
  const u = unit.data;
  if (unit.isError || !u) {
    return (
      <div className="page">
        <PageHeader
          title="Unit not found"
          lede={
            <Link to="/courses/$courseId" params={{ courseId }}>
              Back to the course
            </Link>
          }
        />
      </div>
    );
  }
  const s = u.status;
  const fresh = s.newInAnki + s.missing;
  // "Continue the unit": its first text in the reader (which resumes where you were), else
  // the exercises.
  const firstText = u.texts.find((t) => t.textId)?.textId;
  const talkWords = u.words
    .filter((w) => w.state !== "known")
    .slice(0, 6)
    .map((w) => w.key)
    .join(",");
  const more = [
    {
      label: "Talk about this unit",
      icon: <MessagesSquare size={16} aria-hidden />,
      onSelect: () =>
        void navigate({ to: "/talk", search: { words: talkWords, topic: u.unit.title } }),
    },
    ...(aiReady
      ? [
          {
            label: "Write a story",
            icon: <Sparkles size={16} aria-hidden />,
            onSelect: () =>
              void navigate({
                to: "/import",
                search: storySearch({
                  topic: u.unit.title,
                  unit: { courseId, unitN: n },
                  ...(grammar.data?.[0] ? { grammarTopic: grammar.data[0].topicId } : {}),
                }),
              }),
          },
        ]
      : []),
  ];
  // The unit's card actions live with its words.
  const anki =
    s.total > 0 ? (
      <>
        {s.newInAnki > 0 ? (
          <Tooltip content={studyFirstHint}>
            <Button
              size="sm"
              disabled={learn.isPending}
              title={studyFirstHint}
              onClick={() => learn.mutate()}
            >
              {learn.isPending ? "Working…" : `Study first${where} (${s.newInAnki})`}
            </Button>
          </Tooltip>
        ) : null}
        {s.missing > 0 ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add {plural(s.missing, "word")}
            {native ? "" : " to Anki"}…
          </Button>
        ) : null}
      </>
    ) : null;
  return (
    <div className="page">
      <PageHeader
        back={
          <Link to="/courses/$courseId" params={{ courseId }}>
            <ArrowLeft size={14} aria-hidden /> {u.course.title}
          </Link>
        }
        title={u.unit.title}
        lede={
          s.total > 0 ? (
            <>
              {pct(s.knownRatio)} of the words known, {s.learning} learning, {fresh} new.
            </>
          ) : (
            <>
              Pages {u.unit.pages[0]}–{u.unit.pages[1]}.
            </>
          )
        }
        actions={
          <>
            {firstText ? (
              <Link
                to="/read/$textId"
                params={{ textId: firstText }}
                className="k-btn k-btn--primary"
              >
                Continue the unit
              </Link>
            ) : (
              <Button variant="primary" onClick={() => setTab("exercises")}>
                Continue the unit
              </Button>
            )}
            <MenuButton label="More for this unit" items={more} />
          </>
        }
      />
      {adding ? (
        <AddWordsDialog courseId={courseId} scope={n} open={adding} onOpenChange={setAdding} />
      ) : null}
      <div className="cs-tabs">
        <Tabs
          aria-label="Unit sections"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              value: "read",
              label: "Read",
              content: (
                <div className="cs-tabpanel">
                  <ReadTab unit={u} />
                </div>
              ),
            },
            {
              value: "exercises",
              label: `Exercises (${u.exercises.length + u.generated.length})`,
              content: (
                <div className="cs-tabpanel">
                  {u.exercises.length === 0 ? (
                    <p className="cs-note">No exercises were recognised in this unit.</p>
                  ) : (
                    u.exercises.map((e) => (
                      <BookExercise
                        key={e.number}
                        courseId={courseId}
                        unitN={n}
                        exercise={e}
                        onChanged={refresh}
                      />
                    ))
                  )}
                  {u.generated.length > 0 ? (
                    <section className="cs-made" aria-label="Made for this unit">
                      <h2 className="cs-section-title">Made for this unit</h2>
                      {u.generated.map((e) => (
                        <BookExercise
                          key={e.number}
                          courseId={courseId}
                          unitN={n}
                          exercise={e}
                          onChanged={refresh}
                          generated
                        />
                      ))}
                    </section>
                  ) : null}
                  <GenerateButton courseId={courseId} n={n} onDone={refresh} />
                </div>
              ),
            },
            {
              value: "words",
              label: `Words (${u.words.length})`,
              content: (
                <div className="cs-tabpanel">
                  <WordsTab unit={u} courseId={courseId} n={n} inspector={inspector} anki={anki} />
                </div>
              ),
            },
            {
              value: "grammar",
              label: "Grammar",
              content: (
                <div className="cs-tabpanel">
                  <GrammarTab unit={u} topics={grammar.data} />
                </div>
              ),
            },
          ]}
        />
      </div>
      {inspector.portal}
    </div>
  );
}
