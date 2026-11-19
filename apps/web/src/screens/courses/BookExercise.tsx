import { useCallback, useEffect, useRef, useState } from "react";
import type { Exercise, ExerciseItem } from "@app/core";
import { LOW_CONFIDENCE } from "@app/core";
import { Info, Pencil } from "lucide-react";
import { Button, Chip, Textarea, Tooltip } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { BookCheckResult, BookExerciseView } from "../../services/courseTypes.js";
import { GeneratedSession } from "./GeneratedSession.js";
import { MenuButton } from "../library/MenuButton.js";
import { readLocal, writeLocal } from "../../storage/local.js";

const TYPE_LABEL: Record<BookExerciseView["type"], string> = {
  gapfill: "Fill in",
  "conjugation-table": "Conjugation table",
  "sentence-building": "Build sentences",
  choice: "Choose",
  matching: "Match",
  "open-task": "Open task",
  listening: "Listening",
  unknown: "Text",
};
const INTERACTIVE = new Set(["gapfill", "conjugation-table", "sentence-building", "choice"]);

interface Props {
  courseId: string;
  unitN: number;
  exercise: BookExerciseView;
  onChanged: () => void;
  /** Made with AI for the unit (not from the book): no page, no "More like this". */
  generated?: boolean;
}

/** Remembered notes of an open task; storage may be unavailable (private window). */
function useNotes(key: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => readLocal(key) ?? "");
  return [
    value,
    (v) => {
      setValue(v);
      writeLocal(key, v);
    },
  ];
}

/**
 * A quiet info icon only when the stored answer may be wrong (worked out from the book with
 * low confidence). Where other answers came from is an internal detail.
 */
function SourceNote({ item }: { item: ExerciseItem }) {
  if (item.answerSource !== "derived" || item.confidence >= LOW_CONFIDENCE) return null;
  const text = "This answer was worked out from the book and may be wrong. Fix it if it is.";
  return (
    <Tooltip content={text}>
      <button type="button" className="cs-info" aria-label={text}>
        <Info size={14} aria-hidden />
      </button>
    </Tooltip>
  );
}

/** One typed or chosen item; the exercise's one Check checks it, Fix answer is in its menu. */
function Item({
  props: { courseId, unitN, exercise, onChanged },
  index,
  register,
}: {
  props: Props;
  index: number;
  /** Hands the exercise this item's check (answers only when something was entered). */
  register: (index: number, check: () => Promise<void>) => void;
}) {
  const services = useServices();
  const item = exercise.items[index]!;
  const prior = exercise.answers[index];
  const blanks = item.prompt.split("____");
  const count = Math.max(1, blanks.length - 1);
  const [values, setValues] = useState<string[]>(() =>
    (prior?.answer ?? "").split("|").concat(Array(count).fill("")).slice(0, count),
  );
  const [used, setUsed] = useState<number[]>([]);
  const pieces = used.map((i) => item.chunks?.[i] ?? "");
  const [result, setResult] = useState<BookCheckResult | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fix, setFix] = useState("");
  const [error, setError] = useState<string | null>(null);
  const building = exercise.type === "sentence-building";
  const answer = building ? pieces.join(" ") : values.join("|");

  const check = async (refresh = true) => {
    if (!answer.replace(/\|/g, "").trim()) return;
    setError(null);
    try {
      setResult(await services.checkBookItem(courseId, unitN, exercise.number, index, answer));
      if (refresh) onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check the answer.");
    }
  };
  // The exercise's Check calls the latest version of this item's check.
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  });
  useEffect(() => register(index, () => checkRef.current(false)), [register, index]);
  const saveFix = async () => {
    await services.setBookAnswer(courseId, unitN, exercise.number, index, fix);
    setFixing(false);
    setResult(null);
    onChanged();
  };
  const verdict =
    result ?? (prior?.answer !== undefined ? { correct: prior.correct ?? null } : null);

  return (
    <li className="cs-item" style={{ listStyle: "none" }}>
      {building ? (
        <div style={{ width: "100%" }}>
          <div className="cs-pieces" aria-label="Words to place">
            {(item.chunks ?? []).map((c, i) => (
              <Button
                key={`${c}-${i}`}
                size="sm"
                disabled={used.includes(i)}
                onClick={() => setUsed((u) => [...u, i])}
              >
                {c}
              </Button>
            ))}
          </div>
          <p lang="nl">
            {pieces.length ? (
              pieces.join(" ")
            ) : (
              <span className="cs-hint">Tap the words in order.</span>
            )}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setUsed((u) => u.slice(0, -1))}
            disabled={!used.length}
          >
            Undo
          </Button>
        </div>
      ) : exercise.type === "choice" && item.options ? (
        <>
          <span lang="nl">{item.prompt}</span>
          {item.options.map((o) => (
            <label key={o} className="tw-check">
              <input
                type="radio"
                name={`ex-${exercise.number}-${index}`}
                checked={values[0] === o}
                onChange={() => setValues([o])}
              />
              {o}
            </label>
          ))}
        </>
      ) : (
        blanks.map((part, i) => (
          <span key={i} lang="nl">
            {part}
            {i < blanks.length - 1 ? (
              <input
                className="k-input"
                aria-label={`Answer ${index + 1}${count > 1 ? `, blank ${i + 1}` : ""}`}
                value={values[i] ?? ""}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void check();
                }}
              />
            ) : null}
          </span>
        ))
      )}
      {verdict?.correct === true ? (
        <span className="cs-ok" role="status">
          Correct{verdict.note ? `. ${verdict.note}` : ""}
        </span>
      ) : null}
      {verdict?.correct === false ? (
        <span className="cs-bad" role="status">
          Not quite{result?.expected ? `. Expected: ${result.expected}` : ""}
        </span>
      ) : null}
      {verdict?.correct === null ? (
        <span className="cs-hint" role="status">
          No answer to compare with.{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setFix(answer);
              setFixing(true);
            }}
          >
            Use mine as the answer
          </button>
        </span>
      ) : null}
      <SourceNote item={item} />
      <MenuButton
        className="cs-item-menu"
        label={`More for item ${index + 1}`}
        items={[
          {
            label: "Fix answer…",
            icon: <Pencil size={16} aria-hidden />,
            onSelect: () => {
              setFix(item.answer ?? "");
              setFixing(true);
            },
          },
        ]}
      />
      {fixing ? (
        <span className="row">
          <input
            className="k-input"
            aria-label="Correct answer"
            value={fix}
            onChange={(e) => setFix(e.target.value)}
          />
          <Button size="sm" variant="primary" disabled={!fix.trim()} onClick={() => void saveFix()}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFixing(false)}>
            Cancel
          </Button>
        </span>
      ) : null}
      {error ? (
        <span className="error-text" role="alert">
          {error}
        </span>
      ) : null}
    </li>
  );
}

/** A book exercise rendered by its type: interactive items, notes for open tasks, text otherwise. */
export function BookExercise(props: Props) {
  const { courseId, unitN, exercise, generated: made = false } = props;
  const services = useServices();
  const [notes, setNotes] = useNotes(`kenning.course.${courseId}.${unitN}.${exercise.number}`);
  const [generated, setGenerated] = useState<Exercise[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const interactive = INTERACTIVE.has(exercise.type) && exercise.items.length > 0;
  // One Check for the whole exercise: every item hands over its check.
  const checks = useRef(new Map<number, () => Promise<void>>());
  const register = useCallback((i: number, fn: () => Promise<void>) => {
    checks.current.set(i, fn);
  }, []);
  const [checking, setChecking] = useState(false);
  const checkAll = async () => {
    setChecking(true);
    try {
      await Promise.all([...checks.current.values()].map((fn) => fn()));
      props.onChanged();
    } finally {
      setChecking(false);
    }
  };
  const canMore =
    !made &&
    ["gapfill", "conjugation-table", "sentence-building", "choice"].includes(exercise.type);

  const more = async () => {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const list = await services.moreLikeThis(courseId, unitN, exercise.number);
      if (list.length === 0) setError("No new items could be made from this unit's words yet.");
      else setGenerated(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make new items.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="cs-ex" aria-label={`Exercise ${exercise.number}`}>
      <div className="cs-ex-head">
        <h3>{made ? TYPE_LABEL[exercise.type] : `Exercise ${exercise.number}`}</h3>
        <Chip>{made ? "AI, checked" : TYPE_LABEL[exercise.type]}</Chip>
        {made ? null : <span className="cs-hint">page {exercise.page}</span>}
      </div>
      {exercise.instruction ? (
        <p className="cs-instruction" lang="nl">
          {exercise.instruction}
        </p>
      ) : null}
      {exercise.example ? (
        <p className="cs-example" lang="nl">
          Example: {exercise.example}
        </p>
      ) : null}
      {exercise.passage ? (
        <div className="cs-passage" lang="nl">
          {exercise.passage.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : null}
      {interactive ? (
        <ol style={{ padding: 0, margin: 0 }}>
          {exercise.items.map((_, i) => (
            <Item key={i} props={props} index={i} register={register} />
          ))}
        </ol>
      ) : exercise.type === "open-task" || exercise.type === "listening" ? (
        <Textarea
          label="Your notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          hint="Saved on this device. Not graded."
        />
      ) : (
        <pre className="cs-raw" lang="nl">
          {exercise.raw || "No text was recognised for this exercise."}
        </pre>
      )}
      {interactive || canMore ? (
        <div className="row" style={{ marginTop: 8 }}>
          {interactive ? (
            <Button size="sm" disabled={checking} onClick={() => void checkAll()}>
              {checking ? "Checking…" : "Check answers"}
            </Button>
          ) : null}
          {canMore ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void more()}>
              {busy ? "Preparing…" : "More practice like this"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {generated ? (
        <GeneratedSession
          exercises={generated}
          onDone={(c, t) => {
            setGenerated(null);
            setSummary(`${c} of ${t} correct.`);
          }}
        />
      ) : null}
      {summary ? (
        <p className="cs-hint" role="status">
          {summary}
        </p>
      ) : null}
    </article>
  );
}
