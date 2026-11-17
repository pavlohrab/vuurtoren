import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { validateOutline } from "@app/core";
import { Button, Chip, Input, Select, Spinner } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { DeckMapping, ImportProgress, OutlineRow } from "../../services/courseTypes.js";
import "./courses.css";

type Step = "upload" | "ocr" | "outline" | "decks" | "analyze" | "done";
const STEPS: [Step, string][] = [
  ["upload", "Book"],
  ["ocr", "Reading"],
  ["outline", "Outline"],
  ["decks", "Anki decks"],
  ["analyze", "Exercises"],
];
const KINDS: { value: OutlineRow["kind"]; label: string }[] = [
  { value: "theme", label: "Unit" },
  { value: "grammar", label: "Grammar" },
  { value: "transcripts", label: "Transcripts" },
  { value: "wordlist", label: "Word list" },
  { value: "other", label: "Other" },
];

function Steps({ step }: { step: Step }) {
  return (
    <ol className="cs-steps" aria-label="Import steps">
      {STEPS.map(([s, label]) => (
        <li key={s} aria-current={s === step ? "step" : undefined}>
          {label}
        </li>
      ))}
    </ol>
  );
}

function ProgressBar({ p }: { p: ImportProgress | null }) {
  if (!p) return <Spinner label="Starting" />;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div>
      <div
        className="cs-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={p.message}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="cs-meta" role="status">
        {p.message}
      </p>
    </div>
  );
}

/**
 * Import wizard: upload, OCR progress, outline editor, deck mapping, exercise recognition.
 * With `courseId` it reopens an existing course at the outline step.
 */
export function CourseImportScreen({ courseId: existing }: { courseId?: string }) {
  const services = useServices();
  const qc = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [step, setStep] = useState<Step>(existing ? "outline" : "upload");
  const [courseId, setCourseId] = useState<string | null>(existing ?? null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OutlineRow[]>([]);
  const [mapping, setMapping] = useState<DeckMapping | null>(null);
  const [chosen, setChosen] = useState<Record<number, string[]>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => {
    if (mounted.current)
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
  };

  useEffect(() => {
    if (!existing) return;
    void services.outline(existing).then(setRows, fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  const start = async () => {
    if (files.length === 0) return;
    if (files.length > 1 && files.some(isPdf)) {
      setError("Choose one PDF, or several photos of pages, not both.");
      return;
    }
    setError(null);
    setProgress(null);
    setStep("ocr");
    try {
      const id = await services.importCourse(
        {
          kind: files.some(isPdf) ? "pdf" : "images",
          files,
          ...(title.trim() ? { title: title.trim() } : {}),
        },
        (p) => mounted.current && setProgress(p),
      );
      if (!mounted.current) return;
      setCourseId(id);
      setRows(await services.outline(id));
      setStep("outline");
    } catch (e) {
      fail(e);
      setStep("upload");
    }
  };

  const saveOutline = async () => {
    if (!courseId) return;
    setError(null);
    try {
      await services.editOutline(courseId, rows);
      const m = await services.deckMapping(courseId);
      setMapping(m);
      setChosen({
        ...m.current,
        ...Object.fromEntries(
          Object.entries(m.suggested).filter(([n]) => (m.current[Number(n)] ?? []).length === 0),
        ),
      });
      setStep("decks");
    } catch (e) {
      fail(e);
    }
  };

  const finish = async () => {
    if (!courseId) return;
    setError(null);
    setProgress(null);
    setStep("analyze");
    try {
      await services.mapDecks(courseId, chosen);
      await services.analyzeCourse(courseId, (p) => mounted.current && setProgress(p));
      await qc.invalidateQueries({ queryKey: ["courses"] });
      await qc.invalidateQueries({ queryKey: ["texts"] });
      if (mounted.current) setStep("done");
    } catch (e) {
      fail(e);
      setStep("decks");
    }
  };

  // The page count is checked by the service; here only the shape of the outline.
  const outlineProblem = validateOutline(rows, 0);

  const update = (i: number, patch: Partial<OutlineRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="page page--narrow">
      <h1>{existing ? "Edit course" : "Add a course"}</h1>
      <Steps step={step === "done" ? "analyze" : step} />
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      {step === "upload" ? (
        <>
          <p className="page-lede">
            Upload your own copy of a textbook, as a PDF or as photos of the pages. It is read on
            your own server and kept only in your own storage. Nothing is shared.
          </p>
          <div
            className="dropzone"
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInput.current?.click();
              }
            }}
          >
            <UploadCloud size={24} aria-hidden />
            <span>
              {files.length === 0
                ? "Choose a PDF, or photos of the pages"
                : files.length === 1
                  ? files[0]?.name
                  : `${files.length} photos, read in name order`}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/*"
              multiple
              hidden
              aria-label="Book file"
              onChange={(e) =>
                setFiles(
                  [...(e.target.files ?? [])].sort((a, b) =>
                    a.name.localeCompare(b.name, undefined, { numeric: true }),
                  ),
                )
              }
            />
          </div>
          <Input
            label="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            hint="Taken from the file name when left empty."
          />
          <p className="cs-note">
            A scanned book of about 300 pages needs a few minutes of reading. You can leave this
            page open and come back to it.
          </p>
          <Button variant="primary" disabled={files.length === 0} onClick={() => void start()}>
            Start reading the book
          </Button>
        </>
      ) : null}

      {step === "ocr" ? (
        <>
          <p className="page-lede">Reading the pages. This happens once per book.</p>
          <ProgressBar p={progress} />
        </>
      ) : null}

      {step === "outline" ? (
        <>
          <p className="page-lede">
            Kenning guessed the units from the table of contents and the page footers. Correct the
            titles and page ranges where needed.
          </p>
          {rows.map((r, i) => (
            <div className="cs-outline-row" key={i}>
              <Input
                {...(i === 0 ? { label: "Title" } : {})}
                aria-label={`Title of unit ${i + 1}`}
                value={r.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
              <Input
                {...(i === 0 ? { label: "From page" } : {})}
                aria-label={`First page of unit ${i + 1}`}
                type="number"
                min={1}
                value={r.pages[0]}
                onChange={(e) => update(i, { pages: [Number(e.target.value), r.pages[1]] })}
              />
              <Input
                {...(i === 0 ? { label: "To page" } : {})}
                aria-label={`Last page of unit ${i + 1}`}
                type="number"
                min={1}
                value={r.pages[1]}
                onChange={(e) => update(i, { pages: [r.pages[0], Number(e.target.value)] })}
              />
              <Select
                {...(i === 0 ? { label: "Kind" } : {})}
                value={r.kind}
                onValueChange={(v) => update(i, { kind: v as OutlineRow["kind"] })}
                options={KINDS}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove unit ${i + 1}`}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          {outlineProblem && rows.length > 0 ? (
            <p className="cs-bad" role="status">
              {outlineProblem}
            </p>
          ) : null}
          <div className="row" style={{ marginTop: 12 }}>
            <Button
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  {
                    title: `Unit ${rs.length + 1}`,
                    pages: [
                      (rs[rs.length - 1]?.pages[1] ?? 0) + 1,
                      (rs[rs.length - 1]?.pages[1] ?? 0) + 10,
                    ],
                    kind: "theme",
                  },
                ])
              }
            >
              Add a unit
            </Button>
            <Button
              variant="primary"
              disabled={outlineProblem !== null}
              onClick={() => void saveOutline()}
            >
              Continue
            </Button>
          </div>
        </>
      ) : null}

      {step === "decks" && mapping ? (
        <>
          <p className="page-lede">
            Match each unit to the Anki decks that hold its words. Suggestions are filled in; change
            them if they are wrong, or skip this step.
          </p>
          {mapping.decks.length === 0 ? (
            <p className="cs-note" role="note">
              Anki is not reachable, so no decks can be suggested. You can map them later.
            </p>
          ) : null}
          {rows
            .map((r, i) => ({ r, n: i + 1 }))
            .filter(({ r }) => r.kind === "theme")
            .map(({ r, n }) => {
              const picked = chosen[n] ?? [];
              return (
                <div className="cs-deck-row" key={n}>
                  <strong>{r.title}</strong>
                  <div>
                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                      {picked.map((d) => (
                        <Chip key={d} tone="accent">
                          {d}{" "}
                          <button
                            type="button"
                            className="link-button"
                            aria-label={`Remove ${d} from ${r.title}`}
                            onClick={() =>
                              setChosen((c) => ({ ...c, [n]: (c[n] ?? []).filter((x) => x !== d) }))
                            }
                          >
                            ×
                          </button>
                        </Chip>
                      ))}
                    </div>
                    {mapping.decks.length > 0 ? (
                      <Select
                        value=""
                        placeholder="Add a deck"
                        onValueChange={(d) =>
                          setChosen((c) => ({ ...c, [n]: [...new Set([...(c[n] ?? []), d])] }))
                        }
                        options={mapping.decks
                          .filter((d) => !picked.includes(d))
                          .map((d) => ({ value: d, label: d }))}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          <div className="row" style={{ marginTop: 16 }}>
            <Button onClick={() => setStep("outline")}>Back</Button>
            <Button variant="primary" onClick={() => void finish()}>
              Find the exercises
            </Button>
          </div>
        </>
      ) : null}

      {step === "analyze" ? (
        <>
          <p className="page-lede">
            Recognising exercises, working out answers and adding the reading texts to your Library.
          </p>
          <ProgressBar p={progress} />
        </>
      ) : null}

      {step === "done" && courseId ? (
        <>
          <p className="page-lede">The course is ready.</p>
          <div className="row">
            <Link to="/courses/$courseId" params={{ courseId }} className="k-btn k-btn--primary">
              Open the course
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
