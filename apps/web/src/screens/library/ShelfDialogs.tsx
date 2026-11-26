import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Input, useToast } from "@app/ui";
import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useServices } from "../../services/context.js";
import type { Shelf } from "../../services/libraryTypes.js";
import { moveTexts } from "./moveTexts.js";

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
      if (shelf) {
        await services.renameShelf(shelf.id, name);
        return;
      }
      // The texts move to the new shelf: off the shelves they were on (F5).
      const before = qc.getQueryData<Shelf[]>(["shelves"]) ?? [];
      await services.createShelf(name, textIds);
      for (const s of before) {
        const on = textIds.filter((id) => s.textIds.includes(id));
        if (on.length) await services.removeFromShelf(s.id, on);
      }
    },
    onSuccess: async () => {
      onClose();
      await qc.invalidateQueries({ queryKey: ["shelves"] });
      if (!shelf && textIds.length) toast(`Moved to “${name.trim()}”`);
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
 * Move texts to a shelf (F5): a text sits on one shelf of yours. Pick a shelf and it moves
 * there, off the others; or make a new shelf for it; or take it off the shelf it is on. The
 * phone opens this with a long press on a cover, the computer from the cover's "…" menu.
 */
export function MoveToShelfDialog({
  textIds,
  label,
  shelves,
  onClose,
}: {
  /** Texts to move; empty = closed. */
  textIds: string[];
  /** What is being moved, for the title ("Het weer", "3 texts"). */
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
      title={`Move “${label}” to`}
    >
      {open ? <MoveToShelfForm textIds={textIds} shelves={shelves} onClose={onClose} /> : null}
    </Dialog>
  );
}

function MoveToShelfForm({
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
  /** Off every shelf of yours but `keep`. */
  const offOthers = async (keep: string | null) => {
    for (const s of shelves) {
      if (s.id === keep) continue;
      const on = textIds.filter((id) => s.textIds.includes(id));
      if (on.length) await services.removeFromShelf(s.id, on);
    }
  };
  const done = async (message: string, undo?: () => Promise<void>) => {
    await qc.invalidateQueries({ queryKey: ["shelves"] });
    toast(
      message,
      undefined,
      undo
        ? {
            label: "Undo",
            onAct: () => void undo().then(() => qc.invalidateQueries({ queryKey: ["shelves"] })),
          }
        : undefined,
    );
    onClose();
  };
  const move = useMutation({
    mutationFn: (s: Shelf) => moveTexts(services, shelves, s.id, textIds),
    onSuccess: (undo, s) => done(`Moved to “${s.name}”`, undo),
    onError: (e) => toast("Could not move the text", errorText(e)),
  });
  const takeOff = useMutation({
    mutationFn: (s: Shelf) => services.removeFromShelf(s.id, textIds),
    onSuccess: (_r, s) => done(`Taken off “${s.name}”`),
    onError: (e) => toast("Could not change the shelf", errorText(e)),
  });
  const create = useMutation({
    mutationFn: async () => {
      await services.createShelf(newName, textIds);
      await offOthers(null);
    },
    onSuccess: () => done(`Moved to “${newName.trim()}”`),
    onError: (e) => toast("Could not create the shelf", errorText(e)),
  });
  const busy = move.isPending || takeOff.isPending || create.isPending;
  const on = shelves.filter(isOn);
  return (
    <div className="lib-form">
      {shelves.length ? (
        <ul className="lib-move-picks" aria-label="Shelves">
          {shelves.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="lib-move-pick"
                aria-current={isOn(s) ? "true" : undefined}
                disabled={busy || isOn(s)}
                onClick={() => move.mutate(s)}
              >
                <span>{s.name}</span>
                {isOn(s) ? <Check size={16} aria-label="It is here" /> : null}
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
        <Button type="submit" disabled={!newName.trim() || busy}>
          Create
        </Button>
      </form>
      <div className="k-dialog-actions">
        {on.map((s) => (
          <Button key={s.id} variant="ghost" disabled={busy} onClick={() => takeOff.mutate(s)}>
            Take it off “{s.name}”
          </Button>
        ))}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
