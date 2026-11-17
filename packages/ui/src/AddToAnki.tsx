import * as RPopover from "@radix-ui/react-popover";
import { Check, ChevronDown, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "./Button.js";

/** One deck the picker offers. */
export interface DeckOption {
  deck: string;
  /** Kenning's destination decks, decks mapped to course units, or any other Anki deck. */
  group: "kenning" | "course" | "anki";
  /** Short note, e.g. "Reading" or the unit a course deck belongs to. */
  hint?: string;
}

export interface AddToAnkiProps {
  /** Where the word goes now. */
  deck: string;
  options: readonly DeckOption[];
  onDeckChange: (deck: string) => void;
  /** Called by the main button. Omit for a deck picker only (e.g. a batch apply bar). */
  onAdd?: () => void;
  /** Main button text before the deck name (default "Add to"). */
  label?: string;
  disabled?: boolean;
  /** What is added, for the accessible name: "Add gezellig to <deck>". */
  subject?: string;
  variant?: "primary" | "secondary";
  size?: "md" | "sm";
}

const GROUPS: { id: DeckOption["group"]; title: string }[] = [
  { id: "kenning", title: "Kenning decks" },
  { id: "course", title: "Course decks" },
  { id: "anki", title: "Other Anki decks" },
];

/** The last two levels of a deck name, which tell decks apart without the long root. */
export function shortDeck(deck: string): string {
  const parts = deck.split("::");
  return parts.length > 2 ? `…::${parts.slice(-2).join("::")}` : deck;
}

/**
 * The one Add to Anki control: always names the destination deck and lets the learner pick
 * another one (Kenning's decks, course decks, any Anki deck, or a new deck) before adding.
 */
export function AddToAnki({
  deck,
  options,
  onDeckChange,
  onAdd,
  label = "Add to",
  disabled = false,
  subject,
  variant = "primary",
  size = "md",
}: AddToAnkiProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const listId = useId();
  const pick = (d: string) => {
    onDeckChange(d);
    setOpen(false);
    setCreating(false);
    setName("");
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    const d = name.trim().replace(/\s*::\s*/g, "::");
    if (d) pick(d);
  };
  const seen = new Set<string>();
  const unique = options.filter((o) => (seen.has(o.deck) ? false : (seen.add(o.deck), true)));
  if (!seen.has(deck)) unique.unshift({ deck, group: "kenning" });

  const picker = (
    <RPopover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCreating(false);
      }}
    >
      <RPopover.Trigger asChild>
        <Button
          variant={onAdd ? variant : "secondary"}
          size={size}
          className={onAdd ? "k-add-anki-caret" : "k-add-anki-deck"}
          disabled={disabled}
          aria-label={onAdd ? `Choose the deck (now ${deck})` : undefined}
          title={deck}
        >
          {onAdd ? null : <span className="k-add-anki-name">{`${label} ${shortDeck(deck)}`}</span>}
          <ChevronDown size={16} aria-hidden />
        </Button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content className="k-popover k-add-anki-menu" align="end" sideOffset={6}>
          <div id={listId} role="listbox" aria-label="Deck for new words">
            {GROUPS.map(({ id, title }) => {
              const items = unique.filter((o) => o.group === id);
              if (!items.length) return null;
              return (
                <div key={id} role="group" aria-label={title}>
                  <div className="k-overline k-add-anki-group">{title}</div>
                  {items.map((o) => (
                    <button
                      key={o.deck}
                      type="button"
                      role="option"
                      aria-selected={o.deck === deck}
                      className="k-add-anki-option"
                      onClick={() => pick(o.deck)}
                    >
                      <span className="k-add-anki-check" aria-hidden>
                        {o.deck === deck ? <Check size={14} /> : null}
                      </span>
                      <span className="k-add-anki-option-name">{o.deck}</span>
                      {o.hint ? <span className="k-add-anki-hint">{o.hint}</span> : null}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          {creating ? (
            <form className="k-add-anki-new" onSubmit={create}>
              <input
                className="k-input"
                aria-label="New deck name"
                placeholder="Kenning::Nederlands::…"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>
                Use
              </Button>
            </form>
          ) : (
            <button
              type="button"
              className="k-add-anki-option"
              onClick={() => {
                setCreating(true);
                setName(deck.includes("::") ? `${deck.split("::").slice(0, -1).join("::")}::` : "");
              }}
            >
              <span className="k-add-anki-check" aria-hidden>
                <Plus size={14} />
              </span>
              <span className="k-add-anki-option-name">New deck…</span>
            </button>
          )}
          <p className="k-add-anki-foot">Anki creates the deck when the first word is added.</p>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );

  if (!onAdd) return <div className="k-add-anki">{picker}</div>;
  return (
    <div className="k-add-anki" role="group" aria-label="Add to Anki">
      <Button
        variant={variant}
        size={size}
        className="k-add-anki-main"
        disabled={disabled}
        onClick={onAdd}
        title={`${label} ${deck}`}
        {...(subject ? { "aria-label": `Add ${subject} to ${deck}` } : {})}
      >
        <span className="k-add-anki-name">{`${label} ${shortDeck(deck)}`}</span>
      </Button>
      {picker}
    </div>
  );
}
