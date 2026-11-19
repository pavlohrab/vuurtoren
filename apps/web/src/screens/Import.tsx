import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Button, Input, Spinner, Tabs, Textarea, useToast } from "@app/ui";
import { useOcrAvailable } from "../desktop/DesktopSetup.js";
import { useServices } from "../services/context.js";
import type { ImportInput } from "../services/types.js";
import {
  ImportCancelledError,
  type OcrReviewDoc,
  type ReviewState,
  acceptAllSuggestions,
  changedCount,
  initReview,
  reviewText,
  suggestionCount,
} from "../services/ocrReview.js";
import { OcrReview } from "./ocr/OcrReview.js";
import { errorText } from "../services/errors.js";
import { ErrorNotice } from "../shell/ErrorNotice.js";
import { PageHeader } from "../shell/PageHeader.js";

type Kind = "paste" | "url" | "pdf" | "image";

interface FileDropProps {
  accept: string;
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
}

/** Click-or-drop file picker. */
function FileDrop({ accept, label, file, onFile }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setActive(false);
    onFile(e.dataTransfer.files[0] ?? null);
  };
  return (
    <div
      className="dropzone"
      data-active={active}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={onDrop}
    >
      <UploadCloud size={24} aria-hidden />
      <span>{file ? file.name : label}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        aria-label={label}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

/** Import: paste, URL, PDF or photo. Shows progress, then opens the reader. */
export function ImportScreen() {
  const services = useServices();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  // False once the learner has left this page; a finished import then must not pull them back.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The desktop app has no text recognition (Tesseract) unless it is installed on the computer.
  const ocr = useOcrAvailable();
  const [kind, setKind] = useState<Kind>("paste");
  const shownKind: Kind = !ocr && kind === "image" ? "paste" : kind;
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  // One file per tab, so a PDF can never be submitted as a photo (or the other way round).
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // The OCR review step: the recognised text waits here until the learner imports it.
  const [review, setReview] = useState<{ doc: OcrReviewDoc; state: ReviewState } | null>(null);
  const resolveReview = useRef<((text: string | null) => void) | null>(null);
  // Leaving the page during the review cancels the import.
  useEffect(() => () => resolveReview.current?.(null), []);
  const finishReview = (text: string | null) => {
    resolveReview.current?.(text);
    resolveReview.current = null;
    setReview(null);
  };

  const input = (): ImportInput | null => {
    if (kind === "paste")
      return content.trim()
        ? { kind, content, ...(title.trim() ? { title: title.trim() } : {}) }
        : null;
    if (kind === "url") return url.trim() ? { kind, url: url.trim() } : null;
    if (kind === "image" && !ocr) return null;
    const file = kind === "pdf" ? pdfFile : imageFile;
    return file ? { kind, file, ...(title.trim() ? { title: title.trim() } : {}) } : null;
  };
  const ready = input() !== null;

  const submit = async () => {
    const payload = input();
    if (!payload) return;
    setBusy(true);
    setError(null);
    setProgress([]);
    try {
      const id = await services.importText(
        payload,
        (m) => {
          if (mounted.current) setProgress((p) => [...p, m]);
        },
        {
          review: (doc) =>
            new Promise((resolve) => {
              if (!mounted.current) return resolve(doc.text);
              resolveReview.current = resolve;
              setReview({ doc, state: initReview(doc.text, doc.flags) });
            }),
        },
      );
      await qc.invalidateQueries({ queryKey: ["texts"] });
      if (mounted.current) await navigate({ to: "/read/$textId", params: { textId: id } });
      else toast("Text imported", "It is in your library.");
    } catch (e) {
      if (e instanceof ImportCancelledError) {
        if (mounted.current) {
          setProgress([]);
          setBusy(false);
        }
        return;
      }
      // A failed live import may still have changed the library (e.g. saved before analysis).
      void qc.invalidateQueries({ queryKey: ["texts"] });
      if (mounted.current) {
        // The progress lines ("Analysing the text…") are stale once the import failed.
        setProgress([]);
        setError(e ?? new Error("The import did not work."));
        setBusy(false);
      } else toast("The import did not work", errorText(e));
    }
  };

  const titleField = (
    <Input
      label="Title (optional)"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder="Taken from the text if left empty"
    />
  );

  if (review) {
    const { state, doc } = review;
    const pages = new Map(doc.pages.map((p) => [p.n, p]));
    const canAccept = suggestionCount(state);
    return (
      <div className="page import-page">
        <PageHeader
          title="Check the text"
          lede="Words that may be misread are underlined. Compare them with the scan, fix what is wrong, then import."
        />
        <OcrReview
          value={state}
          onChange={(next) => setReview({ ...review, state: next })}
          image={(n) => {
            const p = pages.get(n);
            return p ? { src: p.image, width: p.width, height: p.height } : null;
          }}
          allowTextEdit
          actions={
            <>
              {canAccept > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setReview({ ...review, state: acceptAllSuggestions(state) })}
                >
                  Accept all suggestions
                </Button>
              ) : null}
              {changedCount(state) === 0 ? (
                <Button size="sm" variant="ghost" onClick={() => finishReview(doc.text)}>
                  Skip review
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => finishReview(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => finishReview(reviewText(state))}>
                Import
              </Button>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="page page--list import-page">
      <PageHeader
        back={
          <Link to="/library">
            <ArrowLeft size={14} aria-hidden /> Library
          </Link>
        }
        title="Import text"
        lede={
          ocr
            ? "Bring in something you want to read in Dutch: paste it, add a web page, a PDF or a photo."
            : "Bring in something you want to read in Dutch: paste it, add a web page or a PDF."
        }
      />
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Tabs
          aria-label="Import source"
          value={shownKind}
          onValueChange={(v) => setKind(v as Kind)}
          items={[
            {
              value: "paste",
              label: "Paste",
              content: (
                <div className="stack">
                  {titleField}
                  <Textarea
                    label="Text"
                    rows={10}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Paste Dutch text here"
                  />
                </div>
              ),
            },
            {
              value: "url",
              label: "URL",
              content: (
                <Input
                  label="Web address"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://"
                  hint="The article text is extracted from the page."
                />
              ),
            },
            {
              value: "pdf",
              label: "PDF",
              content: (
                <div className="stack">
                  {titleField}
                  <FileDrop
                    accept="application/pdf"
                    label="Choose a PDF or drop it here"
                    file={pdfFile}
                    onFile={setPdfFile}
                  />
                </div>
              ),
            },
            ...(ocr
              ? [
                  {
                    value: "image",
                    label: "Photo",
                    content: (
                      <div className="stack">
                        {titleField}
                        <FileDrop
                          accept="image/*"
                          label="Choose a photo or drop it here"
                          file={imageFile}
                          onFile={setImageFile}
                        />
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {!ocr ? (
          <p className="k-hint" role="note" style={{ margin: 0 }}>
            Photos and scanned pages need text recognition (OCR), which the desktop app does not
            include. PDFs with a text layer, web pages and pasted text work; to import a photo,
            install Tesseract or use a Kenning server.
          </p>
        ) : null}

        {progress.length > 0 || busy ? (
          <ul className="progress-log" aria-live="polite">
            {progress.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <ErrorNotice
            error={error}
            title="The import did not work."
            onRetry={ready ? () => void submit() : undefined}
          />
        ) : null}

        <div className="row">
          <Button type="submit" variant="primary" disabled={!ready || busy}>
            {busy ? <Spinner label="Importing" /> : null}
            {busy ? "Importing" : "Import"}
          </Button>
        </div>
      </form>
    </div>
  );
}
