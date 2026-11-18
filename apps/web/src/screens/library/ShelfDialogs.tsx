import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Input, useToast } from "@app/ui";
import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useServices } from "../../services/context.js";
import type { Shelf } from "../../services/libraryTypes.js";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Try again.");

/**
 * Name a new shelf (optionally putting `textIds` on it) or rename one. `open` false = closed.
 */
export function ShelfNameDialog({
  open,
  shelf,
  textIds = [],
  onClose,
}: {
  open: boolean;
  /** The shelf to rename; absent = create a new one. */
  shelf?: Shelf | undefined;
  textIds?: string[];
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={shelf ? "Rename shelf" : "New shelf"}
      {...(shelf ? {} : { description: "A shelf groups texts, like a book series or a topic." })}
    >
      {open ? (
        <ShelfNameForm key={shelf?.id ?? "new"} shelf={shelf} textIds={textIds} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function ShelfNameForm({
  shelf,
  textIds,
  onClose,
}: {
  shelf?: Shelf | undefined;
  textIds: string[];
  onClose: () => void;
}) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(shelf?.name ?? "");
  const save = useMutation({
    mutationFn: async () => {
      if (shelf) await services.renameShelf(shelf.id, name);
      else await services.createShelf(name, textIds);
    },
    onSuccess: async () => {
      onClose();
      await qc.invalidateQueries({ queryKey: ["shelves"] });
      if (!shelf && textIds.length) toast(`Added to "${name.trim()}"`);
    },
    onError: (e) => toast("Could not save the shelf", errorText(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) save.mutate();
  };
  return (
    <form className="lib-form" onSubmit={submit}>
      <Input
        label="Name"
        value={name}
        maxLength={80}
        autoFocus
        placeholder="De Opmaat, News, Stories…"
        onChange={(e) => setName(e.target.value)}
      />
      <div className="k-dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!name.trim() || save.isPending}>
          {shelf ? "Rename" : "Create shelf"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Put texts on shelves: one toggle per shelf (a text may be on several) and a quick new shelf.
 * With several texts, a shelf counts as "on" only when all of them are on it.
 */
export function AddToShelfDialog({
  textIds,
  label,
  shelves,
  onClose,
}: {
  /** Texts to shelve; empty = closed. */
  textIds: string[];
  /** What is being shelved, for the title ("Het weer", "3 texts"). */
  label: string;
  shelves: Shelf[];
  onClose: () => void;
}) {
  const open = textIds.length > 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Add to shelf"
      description={label}
    >
      {open ? <AddToShelfForm textIds={textIds} shelves={shelves} onClose={onClose} /> : null}
    </Dialog>
  );
}

function AddToShelfForm({
  textIds,
  shelves,
  onClose,
}: {
  textIds: string[];
  shelves: Shelf[];
  onClose: () => void;
}) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const isOn = (s: Shelf) => textIds.every((id) => s.textIds.includes(id));
  const toggle = useMutation({
    mutationFn: async (s: Shelf) =>
      isOn(s) ? services.removeFromShelf(s.id, textIds) : services.addToShelf(s.id, textIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shelves"] }),
    onError: (e) => toast("Could not change the shelf", errorText(e)),
  });
  const create = useMutation({
    mutationFn: () => services.createShelf(newName, textIds),
    onSuccess: async () => {
      setNewName("");
      await qc.invalidateQueries({ queryKey: ["shelves"] });
    },
    onError: (e) => toast("Could not create the shelf", errorText(e)),
  });
  return (
    <div className="lib-form">
      {shelves.length ? (
        <ul className="lib-shelf-picks" aria-label="Shelves">
          {shelves.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="k-toggle"
                aria-pressed={isOn(s)}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(s)}
              >
                {isOn(s) ? <Check size={14} aria-hidden /> : null}
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lib-muted">No shelves yet. Make the first one:</p>
      )}
      <form
        className="lib-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create.mutate();
        }}
      >
        <Input
          label="New shelf"
          value={newName}
          maxLength={80}
          placeholder="Name"
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" disabled={!newName.trim() || create.isPending}>
          Create
        </Button>
      </form>
      <div className="k-dialog-actions">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
