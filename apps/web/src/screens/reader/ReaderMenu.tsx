import { Link } from "@tanstack/react-router";
import { ChevronLeft, Ellipsis } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import type { GrammarTopic } from "@app/content";
import { Dialog, Popover } from "@app/ui";
import { GrammarTopics, type PickerTopic } from "./ReaderGrammar.js";

export type MenuView = "menu" | "grammar";

/** Up/Down/Home/End move between the menu's items (a menu has one tab stop). */
function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"));
  const at = items.indexOf(document.activeElement as HTMLElement);
  const go = (i: number) => {
    e.preventDefault();
    items[(i + items.length) % items.length]?.focus();
  };
  if (e.key === "ArrowDown") go(at + 1);
  else if (e.key === "ArrowUp") go(at < 0 ? -1 : at - 1);
  else if (e.key === "Home") go(0);
  else if (e.key === "End") go(-1);
}

function Item({
  onSelect,
  kbd,
  keyboardOnly = false,
  children,
}: {
  onSelect: () => void;
  kbd?: string;
  /** Only with a keyboard (the list of shortcuts): hidden on a touch screen. */
  keyboardOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={keyboardOnly ? "rmenu-item k-keyhint" : "rmenu-item"}
      onClick={onSelect}
    >
      <span className="rmenu-label">{children}</span>
      {kbd ? (
        <kbd className="rmenu-kbd" aria-hidden>
          {kbd}
        </kbd>
      ) : null}
    </button>
  );
}

/**
 * The reader's "…" menu: the grammar focus picker (a second view of the same popover), focus
 * mode, Show answers, Simplify this page, Words from this text, Edit details and the keyboard
 * shortcuts.
 */
export function ReaderMenu({
  open,
  onOpenChange,
  view,
  onViewChange,
  textId,
  summary,
  about = null,
  grammar,
  readingFocus,
  onFocusMode,
  onShowAnswers,
  onSimplify,
  onEditDetails,
  onShortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: MenuView;
  onViewChange: (view: MenuView) => void;
  textId: string;
  /** "82% known · 3 to learn on this page". */
  summary: string;
  /** "A1 words · A2 grammar · 233 words" (LV8: the text's levels, apart), or null. */
  about?: string | null;
  grammar: {
    value: GrammarTopic | null;
    topics: readonly PickerTopic[];
    suggested: readonly PickerTopic[];
    onChange: (topic: GrammarTopic | null) => void;
    unavailable: boolean;
  };
  readingFocus: boolean;
  onFocusMode: () => void;
  /** Reveal every blank on the page (only while some are open). */
  onShowAnswers?: (() => void) | undefined;
  /** Only with an AI provider. */
  onSimplify?: (() => void) | undefined;
  onEditDetails: () => void;
  onShortcuts: () => void;
}) {
  const close = (then: () => void) => () => {
    onOpenChange(false);
    then();
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) onViewChange("menu");
      }}
      label={view === "grammar" ? "Choose a grammar topic" : "More reading options"}
      className={view === "grammar" ? "rmenu rmenu--grammar" : "rmenu"}
      align="end"
      trigger={
        <button
          type="button"
          className="rbar-btn"
          aria-label="More reading options"
          aria-haspopup="menu"
          title="More"
        >
          <Ellipsis size={17} aria-hidden />
        </button>
      }
    >
      {view === "grammar" ? (
        <>
          <button type="button" className="rmenu-back" onClick={() => onViewChange("menu")}>
            <ChevronLeft size={15} aria-hidden />
            Grammar focus
          </button>
          <GrammarTopics
            topics={grammar.topics}
            suggested={grammar.suggested}
            value={grammar.value}
            onChange={(t) => {
              grammar.onChange(t);
              onOpenChange(false);
              onViewChange("menu");
            }}
            unavailable={grammar.unavailable}
          />
        </>
      ) : (
        <>
          <p className="rmenu-summary">
            {summary}
            {about ? (
              <>
                <br />
                About this text: {about}
              </>
            ) : null}
          </p>
          <div role="menu" aria-label="More reading options" onKeyDown={onMenuKey}>
            <button
              type="button"
              role="menuitem"
              className="rmenu-item"
              aria-label={
                grammar.value
                  ? `Grammar focus: ${grammar.value.title}. Change`
                  : "Grammar focus: off. Choose"
              }
              onClick={() => onViewChange("grammar")}
            >
              <span className="rmenu-label">Grammar focus</span>
              <span className="rmenu-value">{grammar.value ? grammar.value.title : "Off"}</span>
            </button>
            <Item onSelect={close(onFocusMode)} kbd="F">
              {readingFocus ? "Leave focus mode" : "Focus mode"}
            </Item>
            {onShowAnswers ? <Item onSelect={close(onShowAnswers)}>Show answers</Item> : null}
            {onSimplify ? <Item onSelect={close(onSimplify)}>Simplify this page</Item> : null}
            <Link
              to="/read/$textId/words"
              params={{ textId }}
              role="menuitem"
              className="rmenu-item"
            >
              <span className="rmenu-label">Words from this text</span>
            </Link>
            <Item onSelect={close(onEditDetails)}>Edit details…</Item>
            <hr className="rmenu-sep k-keyhint" />
            <Item onSelect={close(onShortcuts)} kbd="?" keyboardOnly>
              Keyboard shortcuts
            </Item>
          </div>
        </>
      )}
    </Popover>
  );
}

const SHORTCUTS: [string, string][] = [
  ["← →", "Previous / next page (from outside the text)"],
  ["j k", "Move into the text, then word by word with the arrows"],
  ["Enter", "Open the word under the focus"],
  ["Esc", "Close the word panel, then the grammar focus, then focus mode"],
  ["F", "Focus mode"],
  ["?", "In a blank: a letter hint. Elsewhere: this list"],
  ["⌘/Ctrl + −", "Text size"],
  ["⌘/Ctrl K", "Command palette"],
];

/** The reader's keyboard shortcuts. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <dl className="rkeys">
        {SHORTCUTS.map(([k, what]) => (
          <div key={k} className="rkeys-row">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
