import * as RPopover from "@radix-ui/react-popover";
import { Check, ChevronDown, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "./Button.js";
import { useNativeMode } from "./mode.js";

/** One deck the picker offers. */
export interface DeckOption {
  deck: string;
  /** Vuurtoren's destination decks, decks mapped to course units, or any other Anki deck. */
  group: "vuurtoren" | "course" | "anki";
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
  /**
   * With `onAdd`: the main button's text (default "Add to Anki", or "Add to my words" in native
   * mode); the deck is named only in the menu. Without: the text before the deck's name
   * (default "Add to").
   */
  label?: string;
  disabled?: boolean;
  /** What is added, for the accessible name: "Add gezellig to <deck>". */
  subject?: string;
  variant?: "primary" | "secondary";
  size?: "md" | "sm";
  /** Native mode: Vuurtoren's own decks, worded without Anki. */
  native?: boolean;
}

const GROUPS: { id: DeckOption["group"]; title: string }[] = [
  { id: "vuurtoren", title: "Vuurtoren decks" },
  { id: "course", title: "Course decks" },
  { id: "anki", title: "Other Anki decks" },
];

/** The deck's own name, its last level: "Vuurtoren::Nederlands::Reading" -> "Reading". */
export function deckName(deck: string): string {
  return deck.split("::").at(-1)?.trim() || deck;
}

/**
 * The one Add to Anki control: a plain main button and a menu that shows where the word goes
 * and lets the learner pick another deck (Vuurtoren's decks, course decks, any Anki deck, or a
 * new deck) before adding.
 */
export function AddToAnki({
  deck,
  options,
  onDeckChange,
  onAdd,
  label,
  disabled = false,
  subject,
  variant = "primary",
  size = "md",
  native: nativeProp,
}: AddToAnkiProps) {
  const nativeMode = useNativeMode();
  const native = nativeProp ?? nativeMode;
  const addLabel = native ? "Add to my words" : "Add to Anki";
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
  if (!seen.has(deck)) unique.unshift({ deck, group: "vuurtoren" });

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
          aria-label={onAdd ? `Choose the deck (now ${deckName(deck)})` : undefined}
          title={deck}
        >
          {onAdd ? null : (
            <span className="k-add-anki-name">{`${label ?? "Add to"} ${deckName(deck)}`}</span>
          )}
          <ChevronDown size={16} aria-hidden />
        </Button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content className="k-popover k-add-anki-menu" align="end" sideOffset={6}>
          <p className="k-add-anki-now">
            Goes to <strong>{deckName(deck)}</strong>
          </p>
          <div id={listId} role="listbox" aria-label="Deck for new words">
            {GROUPS.map(({ id, title }) => {
              const items = unique.filter((o) => o.group === id);
              if (!items.length) return null;
              return (
                <div key={id} role="group" aria-label={title}>
                  <div className="k-overline k-add-anki-group">
                    {native && id === "anki" ? "Other decks" : title}
                  </div>
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
                placeholder="Vuurtoren::Nederlands::…"
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
          <p className="k-add-anki-foot">
            {native
              ? "The deck is made when the first word is added."
              : "Anki creates the deck when the first word is added."}
          </p>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );

  if (!onAdd) return <div className="k-add-anki">{picker}</div>;
  return (
    <div className="k-add-anki" role="group" aria-label={addLabel}>
      <Button
        variant={variant}
        size={size}
        className="k-add-anki-main"
        disabled={disabled}
        onClick={onAdd}
        {...(subject ? { "aria-label": `${addLabel}: ${subject}` } : {})}
      >
        <span className="k-add-anki-name">{label ?? addLabel}</span>
      </Button>
      {picker}
    </div>
  );
}
