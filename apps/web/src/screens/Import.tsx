import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Button, Input, Spinner, Tabs, Textarea, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import type { ImportInput } from "../services/types.js";

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

  const [kind, setKind] = useState<Kind>("paste");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  // One file per tab, so a PDF can never be submitted as a photo (or the other way round).
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = (): ImportInput | null => {
    if (kind === "paste")
      return content.trim()
        ? { kind, content, ...(title.trim() ? { title: title.trim() } : {}) }
        : null;
    if (kind === "url") return url.trim() ? { kind, url: url.trim() } : null;
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
      const id = await services.importText(payload, (m) => {
        if (mounted.current) setProgress((p) => [...p, m]);
      });
      await qc.invalidateQueries({ queryKey: ["texts"] });
      if (mounted.current) await navigate({ to: "/read/$textId", params: { textId: id } });
      else toast("Text imported", "It is in your library.");
    } catch (e) {
      // A failed live import may still have changed the library (e.g. saved before analysis).
      void qc.invalidateQueries({ queryKey: ["texts"] });
      const message = e instanceof Error ? e.message : "The import did not work. Try again.";
      if (mounted.current) {
        setError(message);
        setBusy(false);
      } else toast("The import did not work", message);
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

  return (
    <div className="page page--narrow">
      <h1>Import text</h1>
      <p className="page-lede">Bring in something you want to read in Dutch.</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Tabs
          aria-label="Import source"
          value={kind}
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
          ]}
        />

        {progress.length > 0 || busy ? (
          <ul className="progress-log" aria-live="polite">
            {progress.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
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
