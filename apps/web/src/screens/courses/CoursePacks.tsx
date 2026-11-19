import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import {
  type CoursePack,
  type PackMode,
  type PackSummary,
  parseCoursePack,
  summarizePack,
} from "@app/core";
import { Button, Dialog, useToast } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { ImportProgress, PackImportResult } from "../../services/courseTypes.js";
import { ProgressBar } from "./CourseImport.js";
import "./courses.css";
import { saveFile } from "../../saveFile.js";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Course page → "Export course pack…": full (with the book's text) or structure only. */
export function ExportPackDialog({
  courseId,
  open,
  onOpenChange,
}: {
  courseId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const services = useServices();
  const toast = useToast();
  const [mode, setMode] = useState<PackMode>("structure");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const pack = await services.exportCoursePack(courseId, mode);
      saveFile(pack.json, pack.fileName, "application/json");
      toast("Course pack saved", pack.fileName);
      onOpenChange(false);
    } catch (e) {
      toast("Could not export the course", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export course pack"
      description="One file with the course's units, Anki decks, word lists, exercises and your corrections."
    >
      <fieldset className="stack cs-pack-modes" style={{ gap: 10 }}>
        <legend className="cs-meta">What to include</legend>
        <label className="cs-pack-mode">
          <input
            type="radio"
            name="pack-mode"
            checked={mode === "structure"}
            onChange={() => setMode("structure")}
          />
          <span>
            <strong>Structure only</strong>
            <span className="cs-meta">
              Units, page ranges, word lists, exercise types and answers, without the book&rsquo;s
              text. Applied to your own copy of the same book.
            </span>
          </span>
        </label>
        <label className="cs-pack-mode">
          <input
            type="radio"
            name="pack-mode"
            checked={mode === "full"}
            onChange={() => setMode("full")}
          />
          <span>
            <strong>Full</strong>
            <span className="cs-meta">
              Everything, including the recognised text, so it imports without the book or OCR.
            </span>
          </span>
        </label>
      </fieldset>
      {mode === "full" ? (
        <div className="banner" role="note">
          <span>
            A full pack contains the book&rsquo;s text. It is for your personal use: a backup, or
            moving the course to your other devices. Don&rsquo;t share it.
          </span>
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void run()}>
          {busy ? "Exporting…" : "Download"}
        </Button>
      </div>
    </Dialog>
  );
}

function Preview({ s }: { s: PackSummary }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <p>
        <strong>{s.title}</strong>{" "}
        <span className="cs-meta">
          · {s.mode === "full" ? "full pack (with the book's text)" : "structure only"} ·{" "}
          {s.pageCount} pages
        </span>
      </p>
      <p className="cs-meta" data-testid="pack-counts">
        {s.units.length} units · {s.words} words · {s.exercises} exercises ({s.answers} answers)
        {s.corrections ? ` · ${s.corrections} corrections` : ""}
      </p>
      <ul className="cs-pack-units">
        {s.units.map((u) => (
          <li key={u.n}>
            <span>{u.title}</span>
            <span className="cs-meta">
              pp. {u.pages[0]}–{u.pages[1]}
              {u.words ? ` · ${u.words} words` : ""}
              {u.exercises ? ` · ${u.exercises} exercises` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Courses → "Import a course pack": choose or drop the file, preview, import. */
export function ImportPackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const services = useServices();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const packInput = useRef<HTMLInputElement>(null);
  const bookInput = useRef<HTMLInputElement>(null);
  const [pack, setPack] = useState<CoursePack | null>(null);
  const [book, setBook] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<PackImportResult | null>(null);

  const reset = () => {
    setPack(null);
    setBook([]);
    setError(null);
    setProgress(null);
    setResult(null);
  };

  const readPack = async (file: File | undefined) => {
    if (!file) return;
    reset();
    try {
      setPack(parseCoursePack(JSON.parse(await file.text())));
    } catch (e) {
      setError(e instanceof SyntaxError ? "This file is not valid JSON." : errorText(e));
    }
  };

  const run = async () => {
    if (!pack) return;
    setBusy(true);
    setError(null);
    try {
      const r = await services.importCoursePack(pack, {
        ...(book.length ? { files: book } : {}),
        onProgress: setProgress,
      });
      setResult(r);
      await qc.invalidateQueries({ queryKey: ["courses"] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const summary = pack ? summarizePack(pack) : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) reset();
        onOpenChange(o);
      }}
      title="Import a course pack"
      description="A .kenning-course.json file exported from Kenning."
    >
      {result ? (
        <div className="stack" style={{ gap: 10 }}>
          <p role="status">
            Imported {result.units} units, {result.words} words, {result.exercises} exercises and{" "}
            {result.texts} texts.
            {result.matched !== undefined
              ? ` ${result.matched} exercises matched your copy${result.missing ? `, ${result.missing} not found in it` : ""}.`
              : ""}
          </p>
          {result.textsFailed ? (
            <p className="error-text">
              {result.textsFailed} texts could not be analysed (is the language server running?).
              Open the course&rsquo;s outline and run the analysis again to add them.
            </p>
          ) : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button
              variant="primary"
              onClick={() => {
                const id = result.courseId;
                reset();
                onOpenChange(false);
                void navigate({ to: "/courses/$courseId", params: { courseId: id } });
              }}
            >
              Open the course
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <div
            className="dropzone"
            role="button"
            tabIndex={0}
            data-active={drag}
            onClick={() => packInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                packInput.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void readPack(e.dataTransfer.files[0]);
            }}
          >
            <UploadCloud size={24} aria-hidden />
            <span>{pack ? "Choose another pack" : "Choose or drop a course pack"}</span>
            <input
              ref={packInput}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Course pack file"
              onChange={(e) => void readPack(e.target.files?.[0])}
            />
          </div>
          {summary ? <Preview s={summary} /> : null}
          {pack?.mode === "structure" ? (
            <div className="stack" style={{ gap: 6 }}>
              <p className="cs-meta">
                This pack has no text of the book. Choose your own copy of it (
                {pack.course.pageCount} pages); it is read like a normal import, from the
                server&rsquo;s cache if it read the file before, and the pack is applied on top.
              </p>
              <Button onClick={() => bookInput.current?.click()}>
                {book.length ? book[0]?.name : "Choose the book file…"}
              </Button>
              <input
                ref={bookInput}
                type="file"
                accept="application/pdf,image/*"
                multiple
                hidden
                aria-label="Book file"
                onChange={(e) => setBook([...(e.target.files ?? [])])}
              />
            </div>
          ) : null}
          {busy ? <ProgressBar p={progress} /> : null}
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button
              disabled={busy}
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!pack || busy || (pack.mode === "structure" && book.length === 0)}
              onClick={() => void run()}
            >
              {busy ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
