import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { Exercise } from "@app/core";
import { Button, Chip, Skeleton, Tabs, useToast } from "@app/ui";
import { CreateStoryButton } from "../StoryDialog.js";
import { useServices } from "../../services/context.js";
import type { UnitView, UnitWordView } from "../../services/courseTypes.js";
import { BookExercise } from "./BookExercise.js";
import { GeneratedSession } from "./GeneratedSession.js";
import "./courses.css";

const STATE_LABEL: Record<UnitWordView["state"], string> = {
  known: "known",
  learning: "learning",
  unknown: "new",
  seen: "seen",
  ignored: "ignored",
  absent: "not in Anki",
};
const STATE_TONE: Record<UnitWordView["state"], "success" | "accent" | "warm" | "neutral"> = {
  known: "success",
  learning: "accent",
  unknown: "neutral",
  seen: "neutral",
  ignored: "neutral",
  absent: "warm",
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
            <span className="cs-gloss">not in your Library</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function WordsTab({ unit }: { unit: UnitView }) {
  if (unit.words.length === 0) {
    return (
      <p className="cs-note">
        This unit has no word list yet. Map it to an Anki deck and its notes become the unit&rsquo;s
        words.
      </p>
    );
  }
  return (
    <ul className="cs-words">
      {unit.words.map((w) => (
        <li key={w.key}>
          <span className="tw-word" lang="nl">
            {w.article ? <span className="tw-article">{w.article} </span> : null}
            {w.lemma}
          </span>
          <Chip tone={STATE_TONE[w.state]}>{STATE_LABEL[w.state]}</Chip>
          {w.gloss ? <span className="cs-gloss">{w.gloss}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function PracticeTab({ courseId, n }: { courseId: string; n: number }) {
  const services = useServices();
  const [session, setSession] = useState<Exercise[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const list = await services.unitPractice(courseId, n, { size: 12 });
      if (list.length === 0) setError("This unit has no words to practise yet.");
      else setSession(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the session.");
    } finally {
      setBusy(false);
    }
  };
  if (session) {
    return (
      <GeneratedSession
        exercises={session}
        onDone={(c, t) => {
          setSession(null);
          setSummary(`Session finished: ${c} of ${t} correct.`);
        }}
      />
    );
  }
  return (
    <>
      <p className="cs-note">
        A session on this unit&rsquo;s words, with some review of earlier units. Practice keeps its
        own schedule; nothing here changes your Anki cards.
      </p>
      <Button variant="primary" disabled={busy} onClick={() => void start()}>
        {busy ? "Preparing…" : "Start practice"}
      </Button>
      {summary ? (
        <p className="cs-hint" role="status">
          {summary}
        </p>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** One unit: reading, book exercises, words, grammar and practice. */
export function UnitRoute({ courseId, n }: { courseId: string; n: number }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("exercises");
  const key = ["unit", courseId, n];
  const unit = useQuery({ queryKey: key, queryFn: () => services.unit(courseId, n) });
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
    onError: (e) => toast("Learn next did not work", e instanceof Error ? e.message : ""),
  });
  const add = useMutation({
    mutationFn: () => services.addMissingUnitWords(courseId, n),
    onSuccess: (r) => {
      toast(
        `${r.added} words added to ${r.deck}`,
        r.failed > 0 ? `${r.failed} could not be added.` : undefined,
      );
      refresh();
    },
    onError: (e) => toast("Adding words did not work", e instanceof Error ? e.message : ""),
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
        <h1>Unit not found</h1>
        <Link to="/courses/$courseId" params={{ courseId }}>
          Back to the course
        </Link>
      </div>
    );
  }
  const s = u.status;
  const fresh = s.newInAnki + s.missing;
  return (
    <div className="page">
      <p className="cs-meta">
        <Link to="/courses/$courseId" params={{ courseId }}>
          {u.course.title}
        </Link>
      </p>
      <h1>{u.unit.title}</h1>
      {s.total > 0 ? (
        <p className="page-lede">
          {Math.round(s.knownRatio * 100)}% of the words known, {s.learning} learning, {fresh} new.
        </p>
      ) : (
        <p className="page-lede">
          Pages {u.unit.pages[0]}–{u.unit.pages[1]}.
        </p>
      )}
      {s.total > 0 ? (
        <div className="cs-actions" style={{ marginBottom: 12 }}>
          <Button
            variant="primary"
            disabled={learn.isPending || s.newInAnki === 0}
            onClick={() => learn.mutate()}
          >
            {learn.isPending ? "Working…" : `Learn next (${s.newInAnki})`}
          </Button>
          {s.missing > 0 ? (
            <Button disabled={add.isPending} onClick={() => add.mutate()}>
              {add.isPending
                ? "Adding…"
                : `Add ${s.missing} missing ${s.missing === 1 ? "word" : "words"}`}
            </Button>
          ) : null}
          <CreateStoryButton preset={{ topic: u.unit.title, unit: { courseId, unitN: n } }} />
        </div>
      ) : null}
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
            label: `Exercises (${u.exercises.length})`,
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
              </div>
            ),
          },
          {
            value: "words",
            label: `Words (${u.words.length})`,
            content: (
              <div className="cs-tabpanel">
                <WordsTab unit={u} />
              </div>
            ),
          },
          {
            value: "grammar",
            label: "Grammar",
            content: (
              <div className="cs-tabpanel">
                {u.grammar.length === 0 ? (
                  <p className="cs-note">No grammar notes are linked to this unit.</p>
                ) : (
                  u.grammar.map((g) => (
                    <section key={g.title}>
                      <h3>{g.title}</h3>
                      <pre className="cs-raw" lang="nl">
                        {g.text}
                      </pre>
                    </section>
                  ))
                )}
                <p className="cs-note">From your book, for your own use.</p>
              </div>
            ),
          },
          {
            value: "practice",
            label: "Practice",
            content: (
              <div className="cs-tabpanel">
                <PracticeTab courseId={courseId} n={n} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
