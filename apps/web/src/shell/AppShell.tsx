import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  BookText,
  Command as CommandIcon,
  FileText,
  Languages,
  Library,
  MessagesSquare,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  Settings as SettingsIcon,
  Sun,
  TrendingUp,
  Dumbbell,
  Plus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Chip,
  CommandPalette,
  CoverageMeter,
  Tabs,
  Tooltip,
  type CommandGroup,
  type ReaderMode,
} from "@app/ui";
import { useServices } from "../services/context.js";
import { useTheme, type ThemeChoice } from "../theme.js";
import { ShellContext, type PageHeader, type ShellState } from "./ShellContext.js";

const PAGE_TITLES: Record<string, string> = {
  "/library": "Library",
  "/import": "Import text",
  "/words": "Words",
  "/practice": "Practice",
  "/converse": "Converse",
  "/grammar": "Grammar",
  "/progress": "Progress",
  "/settings": "Settings",
};

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const THEME_ICON: Record<ThemeChoice, ReactNode> = {
  system: <Monitor size={16} />,
  light: <Sun size={16} />,
  dark: <Moon size={16} />,
};

const MODES = [
  { value: "read", label: "Read" },
  { value: "cloze", label: "Cloze" },
  { value: "gloss", label: "Gloss" },
] as const;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The three-column app frame: sidebar, top bar with content, and the inspector panel. */
export function AppShell() {
  const services = useServices();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [theme, setTheme] = useTheme();

  const [header, setHeader] = useState<PageHeader | null>(null);
  const [mode, setMode] = useState<ReaderMode>("read");
  const [inspectorEl, setInspectorEl] = useState<HTMLElement | null>(null);
  const [inspectorAvailable, setInspectorAvailable] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });

  // ⌘K / Ctrl+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shell = useMemo<ShellState>(
    () => ({
      setHeader,
      mode,
      setMode,
      inspectorEl,
      setInspectorAvailable,
      inspectorOpen,
      setInspectorOpen,
    }),
    [mode, inspectorEl, inspectorOpen],
  );

  const readTarget = useMemo(() => {
    const list = texts.data ?? [];
    return list.find((t) => t.lastSegment > 0) ?? list[0];
  }, [texts.data]);

  const title = header?.title ?? PAGE_TITLES[pathname] ?? "Kenning";
  const showInspector = inspectorAvailable && inspectorOpen;

  const goto = useCallback(
    (to: string) => void navigate({ to } as Parameters<typeof navigate>[0]),
    [navigate],
  );

  const groups: CommandGroup[] = useMemo(() => {
    const pages: [string, string, ReactNode][] = [
      ["/library", "Library", <Library key="l" size={16} />],
      ["/import", "Import text", <Plus key="i" size={16} />],
      ["/practice", "Practice", <Dumbbell key="p" size={16} />],
      ["/converse", "Converse", <MessagesSquare key="c" size={16} />],
      ["/words", "Words", <Languages key="w" size={16} />],
      ["/grammar", "Grammar", <BookText key="g" size={16} />],
      ["/progress", "Progress", <TrendingUp key="pr" size={16} />],
      ["/settings", "Settings", <SettingsIcon key="s" size={16} />],
    ];
    return [
      {
        heading: "Go to",
        entries: pages.map(([to, label, icon]) => ({
          id: to,
          label,
          icon,
          onSelect: () => goto(to),
        })),
      },
      {
        heading: "Texts",
        entries: (texts.data ?? []).map((t) => ({
          id: t.id,
          label: t.title,
          keywords: ["open", "read"],
          icon: <FileText size={16} />,
          onSelect: () => void navigate({ to: "/read/$textId", params: { textId: t.id } }),
        })),
      },
    ].filter((g) => g.entries.length > 0);
  }, [texts.data, goto, navigate]);

  return (
    <ShellContext.Provider value={shell}>
      <div
        className="shell"
        data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
        data-inspector={showInspector ? "open" : "closed"}
      >
        <nav className="sidebar" aria-label="Main">
          <div className="sidebar-brand">
            <BookOpen size={20} aria-hidden />
            <span className="brand-label">Kenning</span>
          </div>
          <NavLink to="/library" label="Library" icon={<Library size={18} />} />
          {readTarget ? (
            <Link
              to="/read/$textId"
              params={{ textId: readTarget.id }}
              className="nav-link"
              title="Read"
              activeOptions={{ exact: false }}
            >
              <BookOpen size={18} />
              <span className="nav-label">Read</span>
            </Link>
          ) : (
            <NavLink to="/library" label="Read" icon={<BookOpen size={18} />} />
          )}
          <NavLink to="/practice" label="Practice" icon={<Dumbbell size={18} />} />
          <NavLink to="/converse" label="Converse" icon={<MessagesSquare size={18} />} />
          <NavLink to="/words" label="Words" icon={<Languages size={18} />} />
          <NavLink to="/grammar" label="Grammar" icon={<BookText size={18} />} />
          <NavLink to="/progress" label="Progress" icon={<TrendingUp size={18} />} />
          <div className="nav-spacer" />
          <NavLink to="/settings" label="Settings" icon={<SettingsIcon size={18} />} />
        </nav>

        <div className="main">
          <header className="topbar">
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setSidebarCollapsed((c) => !c)}
            >
              <PanelLeft size={16} />
            </Button>
            <h1 className="topbar-title">{title}</h1>
            {header?.coverage != null ? (
              <div className="topbar-group">
                <CoverageMeter value={header.coverage} />
                {header.newCount != null ? (
                  <Chip tone="warm">{header.newCount} to learn</Chip>
                ) : null}
              </div>
            ) : null}
            <div className="topbar-spacer" />
            {header?.reader ? (
              <Tabs
                aria-label="Reading mode"
                items={MODES}
                value={mode}
                onValueChange={(v) => setMode(v as ReaderMode)}
              />
            ) : null}
            <div className="topbar-group">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Open command palette"
                onClick={() => setPaletteOpen(true)}
              >
                <CommandIcon size={14} />
                <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
              </Button>
              <Tooltip content={`Theme: ${theme}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={`Theme: ${theme}. Switch theme`}
                  onClick={() => setTheme(THEME_NEXT[theme])}
                >
                  {THEME_ICON[theme]}
                </Button>
              </Tooltip>
              {inspectorAvailable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"}
                  aria-pressed={inspectorOpen}
                  onClick={() => setInspectorOpen(!inspectorOpen)}
                >
                  <PanelRight size={16} />
                </Button>
              ) : null}
            </div>
          </header>
          <main className="content" id="content">
            <Outlet />
          </main>
        </div>

        <aside className="inspector-panel" aria-label="Inspector" hidden={!showInspector}>
          <div className="inspector-head">
            <span className="k-overline">Word</span>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Close inspector"
              onClick={() => setInspectorOpen(false)}
            >
              <X size={16} />
            </Button>
          </div>
          <div className="inspector-body" ref={setInspectorEl} />
        </aside>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={groups} />
    </ShellContext.Provider>
  );
}

type FixedRoute =
  "/library" | "/practice" | "/converse" | "/words" | "/grammar" | "/progress" | "/settings";

function NavLink({ to, label, icon }: { to: FixedRoute; label: string; icon: ReactNode }) {
  return (
    <Link to={to} className="nav-link" title={label}>
      {icon}
      <span className="nav-label">{label}</span>
    </Link>
  );
}
