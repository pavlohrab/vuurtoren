import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Camera, FileText, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { Button, Input, Spinner, Tabs, Textarea, useToast } from "@app/ui";
import { useOcrAvailable } from "../desktop/DesktopSetup.js";
import { currentDevice } from "../platform/index.js";
import { sharedFor } from "../platform/share.js";
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
import { StoryForm, useAIReady, type StoryPreset } from "./StoryForm.js";

type Kind = "paste" | "url" | "pdf" | "image";
type Tab = Kind | "story";

/** Tab names in the URL (?tab=web) and the import kind behind each. */
const TAB_OF: Record<string, Tab> = {
  paste: "paste",
  web: "url",
  pdf: "pdf",
  photo: "image",
  story: "story",
};
const PARAM_OF: Record<Tab, string> = {
  paste: "paste",
  url: "web",
  pdf: "pdf",
  image: "photo",
  story: "story",
};

/** A finger, not a mouse: no drag and drop, and a camera may be at hand. */
function useTouch(): boolean {
  const [touch] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true,
  );
  return touch;
}

interface FilePickProps {
  kind: "pdf" | "image";
  file: File | null;
  onFile: (f: File | null) => void;
}

/**
 * Choose a PDF or a photo. With a mouse: a box to click or drop on. With a finger: Choose PDF,
 * or Choose photo and Take photo (the camera). Once chosen, the file stays in view (a photo as
 * a preview) with Replace and Remove, also when the import fails, until it is removed.
 */
function FilePick({ kind, file, onFile }: FilePickProps) {
  const touch = useTouch();
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const preview = useMemo(
    () =>
      file && kind === "image" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null,
    [file, kind],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const accept = kind === "pdf" ? "application/pdf" : "image/*";
  const noun = kind === "pdf" ? "PDF" : "photo";
  const inputs = (
    <>
      <input
        ref={pick}
        type="file"
        accept={accept}
        hidden
        aria-label={touch ? `Choose ${noun}` : `Choose a ${noun} or drop it here`}
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {kind === "image" ? (
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label="Take photo"
          onChange={(e) => {
            onFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      ) : null}
    </>
  );
  if (file) {
    return (
      <div className="file-chosen">
        {inputs}
        {preview ? (
          <img
            className="file-chosen-preview"
            src={preview}
            alt={`The chosen photo, ${file.name}`}
          />
        ) : null}
        <p className="file-chosen-name">
          <FileText size={16} aria-hidden /> {file.name}
        </p>
        <div className="row">
          <Button size="sm" onClick={() => pick.current?.click()}>
            Replace
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onFile(null)}>
            Remove
          </Button>
        </div>
      </div>
    );
  }
  if (touch) {
    return (
      <div className="file-picks row">
        {inputs}
        <Button variant="primary" onClick={() => pick.current?.click()}>
          <UploadCloud size={16} aria-hidden /> Choose {noun}
        </Button>
        {kind === "image" ? (
          <Button onClick={() => camera.current?.click()}>
            <Camera size={16} aria-hidden /> Take photo
          </Button>
        ) : null}
      </div>
    );
  }
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
      onClick={() => pick.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick.current?.click();
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
      <span>{`Choose a ${noun} or drop it here`}</span>
      {inputs}
    </div>
  );
}

/**
 * Add text: paste, a web page, a PDF, a photo, or a story written by the AI provider. Shows
 * progress, then opens the reader.
 */
export function ImportScreen() {
  const services = useServices();
  const navigate = useNavigate();
  const search: {
    tab?: string;
    topic?: string;
    grammar?: string;
    course?: string;
    unit?: string;
    shared?: string;
  } = useSearch({ from: "/import" });
  const aiReady = useAIReady();
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

  // Photo import needs text recognition on the language server.
  const ocr = useOcrAvailable();
  // A phone has no language server of its own: without its server a new text cannot be
  // prepared here, so say so before anything is typed.
  const phone = currentDevice().kind === "android";
  const sync = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => services.syncStatus(),
    enabled: phone,
  });
  const noServer = phone && sync.isSuccess && sync.data.place === null;
  const asked = TAB_OF[search.tab ?? "paste"] ?? "paste";
  const tab: Tab = (asked === "image" && !ocr) || (asked === "story" && !aiReady) ? "paste" : asked;
  const kind: Kind = tab === "story" ? "paste" : tab;
  const setTab = (t: Tab) =>
    void navigate({
      to: "/import",
      search: t === "paste" ? {} : { tab: PARAM_OF[t] },
      replace: true,
    });
  const storyPreset: StoryPreset = {
    ...(search.topic ? { topic: search.topic } : {}),
    ...(search.grammar ? { grammarTopic: search.grammar } : {}),
    ...(search.course && search.unit && Number.isFinite(Number(search.unit))
      ? { unit: { courseId: search.course, unitN: Number(search.unit) } }
      : {}),
  };
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  // Shared from another app (Android): fill the link or the text in, for the learner to add.
  // Each share has its own id; it fills the fields once (state set while rendering, as React
  // recommends for state that follows a prop).
  const [sharedSeen, setSharedSeen] = useState<string | undefined>(undefined);
  if (search.shared && search.shared !== sharedSeen) {
    setSharedSeen(search.shared);
    const shared = sharedFor(search.shared);
    if (shared?.kind === "url") setUrl(shared.url);
    else if (shared?.kind === "paste") setContent(shared.text);
  }
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
      else toast("Text added", "It is in Your texts on Read.");
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
        setError(e ?? new Error("This text didn't come in. Try again."));
        setBusy(false);
      } else toast("Could not import the text", errorText(e));
    }
  };

  const titleField = (
    <Input
      label="Title (optional)"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder="From the text"
    />
  );

  if (review) {
    const { state, doc } = review;
    const pages = new Map(doc.pages.map((p) => [p.n, p]));
    const canAccept = suggestionCount(state);
    return (
      <div className="page import-page">
        <PageHeader
          back={
            <button type="button" className="link-button" onClick={() => finishReview(null)}>
              <ArrowLeft size={14} aria-hidden /> Add text
            </button>
          }
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
          more={[
            ...(canAccept > 0
              ? [
                  {
                    label: "Accept all suggestions",
                    onSelect: () => setReview({ ...review, state: acceptAllSuggestions(state) }),
                  },
                ]
              : []),
            ...(changedCount(state) === 0
              ? [{ label: "Skip review", onSelect: () => finishReview(doc.text) }]
              : []),
          ]}
          actions={
            <>
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

  const fields: Record<Kind, ReactNode> = {
    paste: (
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
    url: (
      <Input
        label="Web address"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://"
      />
    ),
    pdf: (
      <div className="stack">
        {titleField}
        <FilePick kind="pdf" file={pdfFile} onFile={setPdfFile} />
      </div>
    ),
    image: (
      <div className="stack">
        {titleField}
        <FilePick kind="image" file={imageFile} onFile={setImageFile} />
      </div>
    ),
  };

  return (
    <div className="page page--list import-page">
      <PageHeader
        back={
          <Link to="/">
            <ArrowLeft size={14} aria-hidden /> Read
          </Link>
        }
        title="Add text"
        lede={
          aiReady
            ? "Something you want to read in Dutch: paste it, add a web page or a PDF, or have a story written for you."
            : "Something you want to read in Dutch: paste it, or add a web page or a PDF."
        }
      />
      {noServer ? (
        <div className="k-hint import-needs-server" role="note">
          Your phone needs a computer or a server to read new texts.{" "}
          <Link to="/settings" search={{ section: "devices" }}>
            Connect your server
          </Link>
          , or add the text on your computer: it comes here when you sync.
        </div>
      ) : null}
      <Tabs
        aria-label="Add text from"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        items={[
          { value: "paste", label: "Paste" },
          { value: "url", label: "Web" },
          { value: "pdf", label: "PDF" },
          ...(ocr ? [{ value: "image", label: "Photo" }] : []),
          ...(aiReady ? [{ value: "story", label: "Write a story" }] : []),
        ]}
      />
      {tab === "story" ? (
        <div className="import-story">
          <StoryForm key={JSON.stringify(storyPreset)} preset={storyPreset} />
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {fields[kind]}
          {!ocr && kind === "pdf" ? (
            <p className="k-hint" role="note" style={{ margin: 0 }}>
              This language server can't read scanned pages. A PDF with text in it works.
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
              title="This text didn't come in. Try again."
              onRetry={ready ? () => void submit() : undefined}
            />
          ) : null}

          <div className="row">
            <Button type="submit" variant="primary" disabled={!ready || busy}>
              {busy ? <Spinner label="Adding" /> : null}
              {busy ? "Adding…" : "Add to my texts"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
