import { pct, plural } from "../../format.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import {
  AnkiStatusChip,
  Button,
  Chip,
  Lemma,
  Skeleton,
  Tabs,
  Tooltip,
  WordStateChip,
  useToast,
} from "@app/ui";
import { CreateStoryButton, useAIReady } from "../StoryDialog.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { usePageHeader } from "../../shell/ShellContext.js";
import { PageHeader } from "../../shell/PageHeader.js";
import type { UnitGrammarTopic, UnitView, UnitWordView } from "../../services/courseTypes.js";
import { AddWordsDialog } from "./AddWordsDialog.js";
import { BookExercise } from "./BookExercise.js";
import "./courses.css";

/** Word state, or the Anki status for unit words that are not in Anki at all. */
function UnitWordState({ state }: { state: UnitWordView["state"] }) {
  return state === "absent" ? <AnkiStatusChip status="absent" /> : <WordStateChip state={state} />;
}

const STUDY_FIRST_HINT =
  "Moves the unit's new cards to the front of Anki's queue, so Anki shows them next.";

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
            <span className="cs-gloss">not in your Library</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function WordsTab({ unit, courseId, n }: { unit: UnitView; courseId: string; n: number }) {
  if (unit.words.length === 0) {
    return (
      <p className="cs-note">
        This unit has no word list yet. Map it to an Anki deck and its notes become the unit&rsquo;s
        words.
      </p>
    );
  }
  const keys = unit.words.map((w) => w.key);
  return (
    <>
      <div className="cs-actions" style={{ marginBottom: 12 }}>
        <Link
          to="/words"
          search={{ source: `unit:${courseId}/${n}` }}
          className="k-btn k-btn--secondary k-btn--sm"
        >
          Open in Words
        </Link>
        <Link
          to="/practice"
          search={{ words: keys.join(",") }}
          className="k-btn k-btn--secondary k-btn--sm"
        >
          Practise these words
        </Link>
        <Link
          to="/talk"
          search={{ words: keys.slice(0, 6).join(","), topic: unit.unit.title }}
          className="k-btn k-btn--ghost k-btn--sm"
        >
          Talk about this unit
        </Link>
      </div>
      <ul className="cs-words">
        {unit.words.map((w) => (
          <li key={w.key}>
            {/* The shared Words hub opens the word in its inspector (forms, decks, actions). */}
            <Link
              to="/words"
              search={{ source: `unit:${courseId}/${n}`, word: w.key }}
              className="cs-word-link"
            >
              <Lemma lemma={w.lemma} article={w.article} />
            </Link>
            <UnitWordState state={w.state} />
            {w.gloss ? <span className="cs-gloss">{w.gloss}</span> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Practice uses the app's one Practice screen, restricted to the unit's words. */
function PracticeTab({ unit, onBook }: { unit: UnitView; onBook: () => void }) {
  const keys = unit.words.filter((w) => w.state !== "known").map((w) => w.key);
  const all = unit.words.map((w) => w.key);
  if (all.length === 0) {
    return <p className="cs-note">This unit has no words to practise yet.</p>;
  }
  return (
    <>
      <p className="cs-note">
        Practice keeps its own schedule per word and skill; nothing here changes your Anki cards.
      </p>
      <div className="cs-actions">
        <Link
          to="/practice"
          search={{ words: (keys.length ? keys : all).slice(0, 60).join(",") }}
          className="k-btn k-btn--primary"
        >
          Practise this unit&rsquo;s words
        </Link>
        <Button onClick={onBook}>Do the book&rsquo;s exercises</Button>
      </div>
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
                    Kenning&rsquo;s page on this topic
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

/** One unit: reading, book exercises, words, grammar and practice. */
export function UnitRoute({ courseId, n }: { courseId: string; n: number }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
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
        r.moved > 0 ? `${r.moved} words moved to the front in Anki` : "Nothing to move",
        r.skipped > 0 ? `${r.skipped} words have no new card.` : undefined,
      );
      refresh();
    },
    onError: (e) => toast("Could not move the cards in Anki", errorText(e)),
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
  return (
    <div className="page">
      <PageHeader
        // The top bar shows this breadcrumb on wider screens.
        back={
          <span className="cs-meta cs-crumb">
            <Link to="/courses/$courseId" params={{ courseId }}>
              {u.course.title}
            </Link>
          </span>
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
      />
      {s.total > 0 ? (
        <div className="cs-actions" style={{ marginBottom: 12 }}>
          <Tooltip content={STUDY_FIRST_HINT}>
            <Button
              variant="primary"
              disabled={learn.isPending || s.newInAnki === 0}
              title={STUDY_FIRST_HINT}
              onClick={() => learn.mutate()}
            >
              {learn.isPending ? "Working…" : `Study first in Anki (${s.newInAnki})`}
            </Button>
          </Tooltip>
          {s.missing > 0 ? (
            <Button onClick={() => setAdding(true)}>
              Add {plural(s.missing, "word")} to Anki…
            </Button>
          ) : null}
          <Link
            to="/talk"
            search={{
              words: u.words
                .filter((w) => w.state !== "known")
                .slice(0, 6)
                .map((w) => w.key)
                .join(","),
              topic: u.unit.title,
            }}
            className="k-btn k-btn--ghost"
          >
            Talk about this unit
          </Link>
          <CreateStoryButton
            preset={{
              topic: u.unit.title,
              unit: { courseId, unitN: n },
              ...(grammar.data?.[0] ? { grammarTopic: grammar.data[0].topicId } : {}),
            }}
          />
        </div>
      ) : null}
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
                  <WordsTab unit={u} courseId={courseId} n={n} />
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
            {
              value: "practice",
              label: "Practice",
              content: (
                <div className="cs-tabpanel">
                  <PracticeTab unit={u} onBook={() => setTab("exercises")} />
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
