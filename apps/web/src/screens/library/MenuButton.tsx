import { Popover } from "@app/ui";
import { MoreHorizontal } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import "./menuButton.css";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * A quiet "…" button with a small menu (role menu; arrow keys, Home/End, Esc). Used on Library
 * covers and shelf headers, OCR review and Courses.
 */
export function MenuButton({
  label,
  items,
  className,
}: {
  /** Accessible name of the button, e.g. "More for Het weer". */
  label: string;
  items: MenuItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() =>
      list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(),
    );
    return () => cancelAnimationFrame(id);
  }, [open]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      all[(n + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      label={label}
      className="lib-menu"
      trigger={
        <button
          type="button"
          className={className ? `lib-menu-btn ${className}` : "lib-menu-btn"}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          title="More"
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
      }
    >
      <div role="menu" aria-label={label} ref={list} onKeyDown={onKey}>
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="lib-menu-item"
            data-danger={it.danger ? "" : undefined}
            onClick={() => {
              setOpen(false);
              it.onSelect();
            }}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
