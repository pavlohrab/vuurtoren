import { createContext, useContext, useEffect } from "react";
import type { ReaderMode } from "@app/ui";

/** What the top bar shows; screens publish it with usePageHeader. */
export interface PageHeader {
  title: string;
  /**
   * A reader page: the title is quiet (muted, UI font) and the page portals its own controls
   * (coverage, Read | Cloze | Gloss, Aa, …) into `toolbarEl`, so the top bar is the reader bar.
   */
  reader?: boolean;
  /** Render the title as the page's h1 (only for pages without an in-page heading). */
  heading?: boolean;
  /** Breadcrumb before the title, e.g. the course of a unit. */
  parent?: { label: string; to: string } | null;
  /**
   * Keep the title in the top bar while the page's own h1 is in view. Only for a title that
   * says something else than the h1 (Home's date next to its greeting).
   */
  always?: boolean;
}

export interface ShellState {
  setHeader(header: PageHeader | null): void;
  mode: ReaderMode;
  setMode(mode: ReaderMode): void;
  /** DOM node in the top bar, after the title, where a reader page portals its controls. */
  toolbarEl: HTMLElement | null;
  /** DOM node of the inspector panel body; pages portal their inspector into it. */
  inspectorEl: HTMLElement | null;
  /** Reader pages declare they use the inspector; it opens (slides in) when a word is chosen. */
  setInspectorAvailable(available: boolean): void;
  inspectorOpen: boolean;
  setInspectorOpen(open: boolean): void;
  /** The word panel widened for a word's full entry (computers; it resets when the panel closes). */
  inspectorWide?: boolean;
  setInspectorWide?(wide: boolean): void;
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
  const { reader = false, heading = false, always = false } = extra;
  const parentLabel = extra.parent?.label;
  const parentTo = extra.parent?.to;
  useEffect(() => {
    const parent = parentLabel && parentTo ? { label: parentLabel, to: parentTo } : null;
    setHeader({ title, reader, heading, parent, always });
    return () => setHeader(null);
  }, [setHeader, title, reader, heading, always, parentLabel, parentTo]);
}
