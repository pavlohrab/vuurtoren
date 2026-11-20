import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Input, Select, Textarea, useToast } from "@app/ui";
import { type FormEvent, useState } from "react";
import { useServices } from "../../services/context.js";
import type { TextSummary } from "@app/db";
import { errorText } from "../../services/errors.js";

/** The fields of a text the details dialog edits. */
export type EditableText = Pick<
  TextSummary,
  "id" | "title" | "importedTitle" | "author" | "note" | "level"
>;

const LEVELS = ["", "A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * Edit a text's title, author, source note and level (TextMetaUpdated). Used from the Library
 * cover menu; the reader can open it too. `text` null = closed.
 */
export function TextDetailsDialog({
  text,
  onClose,
}: {
  text: EditableText | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={text !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Edit details"
    >
      {text ? <DetailsForm key={text.id} text={text} onClose={onClose} /> : null}
    </Dialog>
  );
}

function DetailsForm({ text, onClose }: { text: EditableText; onClose: () => void }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(text.title);
  const [author, setAuthor] = useState(text.author ?? "");
  const [note, setNote] = useState(text.note ?? "");
  const [level, setLevel] = useState(text.level ?? "");

  const save = useMutation({
    mutationFn: () =>
      services.updateTextMeta(text.id, {
        ...(title.trim() !== text.title ? { title: title.trim() || null } : {}),
        ...(author.trim() !== (text.author ?? "") ? { author: author.trim() || null } : {}),
        ...(note.trim() !== (text.note ?? "") ? { note: note.trim() || null } : {}),
        ...(level !== (text.level ?? "") ? { level: level || null } : {}),
      }),
    onSuccess: async () => {
      onClose();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["texts"] }),
        qc.invalidateQueries({ queryKey: ["reading", text.id] }),
      ]);
    },
    onError: (e) => toast("Could not save the details", errorText(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form className="lib-form" onSubmit={submit}>
      <Input
        label="Title"
        lang="nl"
        value={title}
        maxLength={300}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        {...(text.importedTitle ? { hint: `Imported as "${text.importedTitle}"` } : {})}
      />
      <Input
        label="Author (optional)"
        value={author}
        maxLength={200}
        onChange={(e) => setAuthor(e.target.value)}
      />
      <Textarea
        label="Source note (optional)"
        value={note}
        rows={2}
        maxLength={1000}
        placeholder="De Opmaat A2, p. 34"
        onChange={(e) => setNote(e.target.value)}
      />
      <Select
        label="Level"
        value={level || "none"}
        onValueChange={(v) => setLevel(v === "none" ? "" : v)}
        options={LEVELS.map((l) => ({ value: l || "none", label: l || "No level" }))}
      />
      <div className="k-dialog-actions">
        {text.importedTitle ? (
          <Button
            variant="ghost"
            className="lib-form-reset"
            onClick={() => setTitle(text.importedTitle ?? text.title)}
          >
            Use imported title
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
