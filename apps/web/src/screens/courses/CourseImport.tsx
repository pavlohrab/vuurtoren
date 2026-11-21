import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { validateOutline } from "@app/core";
import { Button, Chip, Input, Select, Spinner, Textarea, useNativeMode } from "@app/ui";
import { useServices } from "../../services/context.js";
import { PageHeader } from "../../shell/PageHeader.js";
import { useAppInfo } from "../../shell/AppInfo.js";
import { useOcrAvailable } from "../../desktop/DesktopSetup.js";
import type {
  DeckMapping,
  ImportProgress,
  OutlineRow,
  PagePreview,
  PendingImport,
} from "../../services/courseTypes.js";
import { OutlineEditor } from "./OutlineEditor.js";
import { CourseReview } from "./CourseReview.js";
import type { CourseReviewPage, TextEdit } from "../../services/ocrReview.js";
import "./courses.css";

type Step = "upload" | "ocr" | "check" | "outline" | "decks" | "analyze" | "done";
const STEPS: [Step, string][] = [
  ["upload", "Book"],
  ["ocr", "Reading"],
  ["check", "Check"],
  ["outline", "Outline"],
  ["decks", "Anki decks"],
  ["analyze", "Exercises"],
];

function Steps({ step }: { step: Step }) {
  const native = useNativeMode();
  const current = STEPS.findIndex(([s]) => s === step);
  return (
    <ol className="cs-steps" aria-label="Import steps">
      {STEPS.map(([s, label], i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          data-done={i < current || undefined}
        >
          <span className="cs-step-n" aria-hidden>
            {i < current ? <Check size={12} /> : i + 1}
          </span>
          {s === "decks" && native ? "Decks" : label}
        </li>
      ))}
    </ol>
  );
}

/** Where the book ends up, by storage mode (server, this browser, or the demo). */
function privacyCopy(mode: "server" | "browser" | "desktop" | "phone" | undefined): string {
  if (mode === "desktop")
    return "It is read by the language tools on this computer and kept only in your Vuurtoren data file. Nothing is shared.";
  if (mode === "server")
    return "It is read on your own Vuurtoren server and kept only in its storage. Nothing is shared.";
  if (mode === "browser")
    return "Its pages are read by your language server, and the course is kept only in this browser. Nothing is shared.";
  if (mode === "phone")
    return "Its pages are read by your language server, and the course is kept only in this app. Nothing is shared.";
  return "This is the demo: nothing you upload is kept.";
}

export function ProgressBar({ p }: { p: ImportProgress | null }) {
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
  const storageMode = useAppInfo().data?.mode;
  const native = useNativeMode();
  // Photos and scanned pages need text recognition on the language server.
  const ocr = useOcrAvailable();
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
  const [pages, setPages] = useState<PagePreview[] | undefined>(undefined);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [source, setSource] = useState<"file" | "web">("file");
  const [urls, setUrls] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // The Check step: flagged pages wait here until the learner continues or skips.
  const [check, setCheck] = useState<CourseReviewPage[] | null>(null);
  const resolveCheck = useRef<((edits: Map<number, TextEdit[]> | null) => void) | null>(null);
  // Leaving the wizard during the check keeps the text as recognised.
  useEffect(() => () => resolveCheck.current?.(null), []);
  const review = {
    review: (pages: CourseReviewPage[]) =>
      new Promise<Map<number, TextEdit[]> | null>((resolve) => {
        if (!mounted.current) return resolve(null);
        resolveCheck.current = resolve;
        setCheck(pages);
        setStep("check");
      }),
  };
  const endCheck = (edits: Map<number, TextEdit[]> | null) => {
    resolveCheck.current?.(edits);
    resolveCheck.current = null;
    setCheck(null);
    setStep("ocr");
  };

  const fail = (e: unknown) => {
    if (mounted.current)
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
  };

  useEffect(() => {
    if (!existing) return;
    void services.outline(existing).then(setRows, fail);
    void services.pagePreviews(existing).then(setPages, () => setPages(undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  // A book whose reading was started earlier (the wizard was left): offer to continue it.
  useEffect(() => {
    if (existing) return;
    void services.pendingImport().then((p) => mounted.current && setPending(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  const toOutline = async (id: string) => {
    setCourseId(id);
    setRows(await services.outline(id));
    setPages(await services.pagePreviews(id).catch(() => undefined));
    setStep("outline");
  };

  const resume = async () => {
    setError(null);
    setProgress(null);
    setStep("ocr");
    try {
      const id = await services.resumeImport((p) => mounted.current && setProgress(p), review);
      if (mounted.current) await toOutline(id);
    } catch (e) {
      fail(e);
      setPending(await services.pendingImport());
      setStep("upload");
    }
  };

  const startWeb = async () => {
    const list = urls
      .split(/\s+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));
    if (list.length === 0) {
      setError("Paste the addresses of the web pages, one per line.");
      return;
    }
    setError(null);
    setProgress(null);
    setStep("ocr");
    try {
      const id = await services.importCourse(
        { kind: "url", urls: list, title: title.trim() || "Web course" },
        (p) => mounted.current && setProgress(p),
      );
      if (mounted.current) await toOutline(id);
    } catch (e) {
      fail(e);
      setStep("upload");
    }
  };

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
        review,
      );
      if (!mounted.current) return;
      await toOutline(id);
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
  const outlineProblem = validateOutline(rows, pages?.length ?? 0);

  return (
    <div className={step === "outline" || step === "check" ? "page" : "page page--narrow"}>
      <PageHeader title={existing ? "Edit course" : "Add a course"} />
      <Steps step={step === "done" ? "analyze" : step} />
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}

      {step === "upload" ? (
        <div className="stack">
          {pending ? (
            <div className="banner cs-resume" role="note">
              <span>
                You started reading <strong>{pending.title}</strong> ({pending.total} pages).
                Vuurtoren can pick it up where it is.
              </span>
              <span className="cs-actions">
                <Button variant="primary" size="sm" onClick={() => void resume()}>
                  Continue
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void services.discardPendingImport();
                    setPending(null);
                  }}
                >
                  Start over
                </Button>
              </span>
            </div>
          ) : null}
          <p className="page-lede">
            {ocr
              ? "Upload your own copy of a textbook: a PDF (scanned or not), an EPUB, or photos of the pages."
              : "Upload your own copy of a textbook: a PDF with a text layer or an EPUB."}{" "}
            Any textbook works; Vuurtoren finds its units and you can correct them.{" "}
            {privacyCopy(storageMode)}
          </p>
          {ocr ? null : (
            <p className="cs-note" role="note">
              Photos and scanned PDFs need text recognition, which this language server does not
              have.
            </p>
          )}
          <div className="cs-source" role="group" aria-label="What to import">
            <Button
              size="sm"
              variant={source === "file" ? "secondary" : "ghost"}
              aria-pressed={source === "file"}
              onClick={() => setSource("file")}
            >
              A book file or photos
            </Button>
            <Button
              size="sm"
              variant={source === "web" ? "secondary" : "ghost"}
              aria-pressed={source === "web"}
              onClick={() => setSource("web")}
            >
              Web pages
            </Button>
          </div>
          {source === "file" ? (
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
                  ? ocr
                    ? "Choose a PDF or EPUB, or photos of the pages"
                    : "Choose a PDF or EPUB"
                  : files.length === 1
                    ? files[0]?.name
                    : `${files.length} photos, read in name order`}
              </span>
              <input
                ref={fileInput}
                type="file"
                accept={
                  ocr
                    ? "application/pdf,application/epub+zip,.epub,image/*"
                    : "application/pdf,application/epub+zip,.epub"
                }
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
          ) : (
            <Textarea
              label="Web pages, one address per line"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              hint="Each page becomes one unit, in this order."
              rows={5}
            />
          )}
          <Input
            label={source === "file" ? "Title (optional)" : "Title"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            {...(source === "file" ? { hint: "Taken from the file name when left empty." } : {})}
          />
          {source === "file" && ocr ? (
            <p className="cs-note">
              A scanned book of about 300 pages takes a few minutes to read. You can leave this
              page: the reading goes on, and you can continue here later.
            </p>
          ) : null}
          <div className="row">
            {source === "file" ? (
              <Button variant="primary" disabled={files.length === 0} onClick={() => void start()}>
                Start reading the book
              </Button>
            ) : (
              <Button variant="primary" disabled={!urls.trim()} onClick={() => void startWeb()}>
                Read the pages
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {step === "ocr" ? (
        <>
          <p className="page-lede">
            Reading the pages. This happens once per book; you can leave this page and continue
            later.
          </p>
          <ProgressBar p={progress} />
        </>
      ) : null}

      {step === "check" && check ? <CourseReview pages={check} onDone={endCheck} /> : null}

      {step === "outline" ? (
        <>
          <p className="page-lede">
            Vuurtoren guessed the units from the table of contents, page footers and headings.
            Correct titles and boundaries where needed: click the page where a unit starts.
          </p>
          <OutlineEditor rows={rows} onChange={setRows} pages={pages} />
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
            Match each unit to the {native ? "decks" : "Anki decks"} that hold its words.
            Suggestions are filled in; change them if they are wrong, or skip this step.
          </p>
          {mapping.decks.length === 0 ? (
            <p className="cs-note" role="note">
              {native
                ? "You have no decks yet, so none can be suggested. You can map them later."
                : "Anki is not reachable, so no decks can be suggested. You can map them later."}
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
            Recognising exercises, working out answers and adding the reading texts to Your texts.
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
