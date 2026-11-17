import { createContext, useContext, useEffect } from "react";
import type { ReaderMode } from "@app/ui";

/** What the top bar shows; screens publish it with usePageHeader. */
export interface PageHeader {
  title: string;
  /** Coverage in [0, 1] of the current reading unit. */
  coverage?: number | null;
  newCount?: number | null;
  /** Show the Read | Cloze | Gloss mode tabs. */
  reader?: boolean;
  /** Render the title as the page's h1 (only for pages without an in-page heading). */
  heading?: boolean;
  /** Breadcrumb before the title, e.g. the course of a unit. */
  parent?: { label: string; to: string } | null;
}

export interface ShellState {
  setHeader(header: PageHeader | null): void;
  mode: ReaderMode;
  setMode(mode: ReaderMode): void;
  /** DOM node of the inspector panel body; pages portal their inspector into it. */
  inspectorEl: HTMLElement | null;
  /** Reader pages declare they use the inspector so the shell shows the panel. */
  setInspectorAvailable(available: boolean): void;
  inspectorOpen: boolean;
  setInspectorOpen(open: boolean): void;
}

export const ShellContext = createContext<ShellState | null>(null);

/** Access shell state (header, reading mode, inspector). */
export function useShell(): ShellState {
  const s = useContext(ShellContext);
  if (!s) throw new Error("useShell must be used inside <AppShell>");
  return s;
}

/** Publish the top-bar content for the current screen; cleared on unmount. */
export function usePageHeader(title: string, extra: Omit<PageHeader, "title"> = {}): void {
  const { setHeader } = useShell();
  const { coverage = null, newCount = null, reader = false, heading = false } = extra;
  const parentLabel = extra.parent?.label;
  const parentTo = extra.parent?.to;
  useEffect(() => {
    const parent = parentLabel && parentTo ? { label: parentLabel, to: parentTo } : null;
    setHeader({ title, coverage, newCount, reader, heading, parent });
    return () => setHeader(null);
  }, [setHeader, title, coverage, newCount, reader, heading, parentLabel, parentTo]);
}
