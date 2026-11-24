import { plural } from "../format.js";
import { SUPPORT_URL, recordUse } from "../support.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  BookText,
  ClipboardCheck,
  Ellipsis,
  Layers,
  Command as CommandIcon,
  FileText,
  Languages,
  MessagesSquare,
  Monitor,
  Moon,
  PanelLeft,
  Compass,
  Settings as SettingsIcon,
  Sun,
  TrendingUp,
  Dumbbell,
  GraduationCap,
  Heart,
  Plus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  Chip,
  Logo,
  NativeModeContext,
  CommandPalette,
  Tooltip,
  type CommandGroup,
  type ReaderMode,
} from "@app/ui";
import { useServices } from "../services/context.js";
import { useTheme, type ThemeChoice } from "../theme.js";
import { useAppInfo } from "./AppInfo.js";
import { DesktopSetup } from "../desktop/DesktopSetup.js";
import { DegradedIndicator } from "./DegradedIndicator.js";
import { AnkiSyncLine } from "./AnkiSyncLine.js";
import { useAnkiAutoSync } from "./ankiSync.js";
import { useAutoTune } from "./autoTune.js";
import { ShellContext, type PageHeader, type ShellState } from "./ShellContext.js";
import { useBottomSheet } from "./useBottomSheet.js";
import { Tour, startTour } from "./Tour.js";
import { useAutoSync } from "./useAutoSync.js";
import { useBackClose, useSystemBack } from "./backStack.js";
import { useConnectLinks } from "./useConnectLinks.js";
import { useDebounced } from "../useDebounced.js";

const PAGE_TITLES: Record<string, string> = {
  "/": "Read",
  "/import": "Add text",
  "/words": "Words",
  "/words/all": "Words",
  "/practice": "Practice",
  "/review": "Review",
  "/courses": "Courses",
  "/talk": "Talk",
  "/grammar": "Grammar",
  "/exam": "Exam",
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

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "as the phone",
  light: "light",
  dark: "dark",
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The two rooms: which one a path belongs to (the nav marks it), or null for the others. */
function roomOf(pathname: string): "read" | "words" | null {
  if (pathname === "/" || pathname === "/import" || pathname.startsWith("/read/")) return "read";
  if (/^\/(words|review|practice|progress)(\/|$)/.test(pathname)) return "words";
  return null;
}

/** The three-column app frame: sidebar, top bar with content, and the inspector panel. */
export function AppShell() {
  const services = useServices();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [theme, setTheme] = useTheme();
  const { notice, demo, onLeaveDemo, desktop } = useAppInfo();
  const qc = useQueryClient();
  useAutoSync(services, qc);
  useConnectLinks(services, qc);
  useAnkiAutoSync(services, qc, !demo);

  const [header, setHeader] = useState<PageHeader | null>(null);
  const [mode, setMode] = useState<ReaderMode>("read");
  const [inspectorEl, setInspectorEl] = useState<HTMLElement | null>(null);
  const [toolbarEl, setToolbarEl] = useState<HTMLElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);
  const pageTitleInView = usePageTitleInView(contentEl);
  const [inspectorAvailable, setInspectorAvailable] = useState(false);
  // Closed until a word is chosen: it then slides in (a bottom sheet on a phone).
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Phone tab bar: the "More" sheet with the secondary destinations. Transient: choosing an
  // item or any change of page closes it, and going back never brings it back.
  const [moreOpen, setMoreOpenState] = useState(false);
  const [morePath, setMorePath] = useState(pathname);
  if (morePath !== pathname) {
    setMorePath(pathname);
    if (moreOpen) setMoreOpenState(false);
  }
  const moreButton = useRef<HTMLButtonElement>(null);
  // A day of use, for the support card's timing (counted on this device only).
  useEffect(() => recordUse(), []);
  const setMoreOpen = useCallback((open: boolean) => setMoreOpenState(open), []);
  /** Dismissed without choosing (Esc, Back, the scrim): focus goes back to the More button. */
  const dismissMore = useCallback(() => {
    setMoreOpenState(false);
    moreButton.current?.focus();
  }, []);
  useBackClose(moreOpen, dismissMore);
  useSystemBack();
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissMore();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen, dismissMore]);

  // The palette's Texts group: read when the palette opens, not at every start.
  const texts = useQuery({
    queryKey: ["texts"],
    queryFn: () => services.listTexts(),
    enabled: paletteOpen,
  });
  // The palette's Words group: looked up as the learner types (two letters or more).
  const [paletteSearch, setPaletteSearch] = useState("");
  const wordQuery = useDebounced(paletteSearch.trim(), 150);
  const paletteWords = useQuery({
    queryKey: ["words", "palette", wordQuery],
    queryFn: () => services.words({ query: wordQuery, limit: 8 }),
    enabled: paletteOpen && wordQuery.length >= 2,
    staleTime: 30_000,
  });
  // Native mode: cards due in Review (the badge), and tuning by itself when it is time.
  const review = useQuery({
    queryKey: ["review", "overview"],
    queryFn: () => services.reviewOverview(),
    staleTime: 60_000,
  });
  const native = review.data?.native === true;
  // With Anki the badge counts practice instead; failures just hide the badge. Not asked in
  // native mode, where the badge is Review's: it read every card at each start and word action.
  const practice = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
    staleTime: 60_000,
    enabled: review.isSuccess && !native,
  });
  useAutoTune(services, qc, native && !demo);
  // Talk needs an AI provider: without one it stays out of the navigation.
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  const talk = ai.data?.configured === true;
  const room = roomOf(pathname);
  const wordsDue = native ? review.data?.due : practice.data?.due;

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
      toolbarEl,
      inspectorEl,
      setInspectorAvailable,
      inspectorOpen,
      setInspectorOpen,
    }),
    [mode, toolbarEl, inspectorEl, inspectorOpen],
  );

  const title =
    header?.title ??
    PAGE_TITLES[pathname] ??
    (pathname.startsWith("/courses/") ? "Courses" : "Vuurtoren");
  const showInspector = inspectorAvailable && inspectorOpen;
  const sheetRef = useRef<HTMLElement>(null);
  const closeSheet = useCallback(() => setInspectorOpen(false), []);
  const sheet = useBottomSheet(sheetRef, showInspector, closeSheet);
  useBackClose(showInspector, closeSheet);
  const titleClass = header?.reader ? "topbar-title topbar-title--quiet" : "topbar-title";
  // The page's h1 already says it: the top bar shows the title once the h1 has scrolled away.
  const headingHidden = pageTitleInView && !header?.always && !header?.reader;

  const goto = useCallback(
    (to: string) => void navigate({ to } as Parameters<typeof navigate>[0]),
    [navigate],
  );

  const groups: CommandGroup[] = useMemo(() => {
    const pages: [string, string, ReactNode][] = [
      ["/", "Read", <BookOpen key="h" size={16} />],
      ["/words", "Words", <Languages key="w" size={16} />],
      ...(native
        ? [["/review", "Review", <Layers key="r" size={16} />] as [string, string, ReactNode]]
        : []),
      ["/practice", "Practice", <Dumbbell key="p" size={16} />],
      ["/progress", "Progress", <TrendingUp key="pr" size={16} />],
      ["/grammar", "Grammar", <BookText key="g" size={16} />],
      ["/exam", "Exam", <ClipboardCheck key="e" size={16} />],
      ["/courses", "Courses", <GraduationCap key="co" size={16} />],
      ...(talk
        ? [["/talk", "Talk", <MessagesSquare key="c" size={16} />] as [string, string, ReactNode]]
        : []),
      ["/settings", "Settings", <SettingsIcon key="s" size={16} />],
    ];
    const words = wordQuery.length >= 2 ? (paletteWords.data ?? []) : [];
    return [
      {
        heading: "Actions",
        entries: [
          {
            id: "action:add-text",
            label: "Add text",
            keywords: ["import", "paste", "web", "pdf", "photo", "story"],
            icon: <Plus size={16} />,
            onSelect: () => goto("/import"),
          },
          {
            id: "action:practice",
            label: "Start practice",
            keywords: ["practise", "exercises"],
            icon: <Dumbbell size={16} />,
            onSelect: () => void navigate({ to: "/practice", search: { start: "1" } }),
          },
        ],
      },
      {
        heading: "Words",
        entries: words.map((w) => ({
          id: `word:${w.key}`,
          label: [w.article ? `${w.article} ${w.key}` : w.key, w.gloss].filter(Boolean).join(" · "),
          keywords: [w.key],
          icon: <Languages size={16} />,
          onSelect: () => void navigate({ to: "/words/all", search: { word: w.key } }),
        })),
      },
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
  }, [texts.data, goto, navigate, native, talk, wordQuery, paletteWords.data]);

  return (
    <NativeModeContext.Provider value={native}>
      <ShellContext.Provider value={shell}>
        <div
          className="shell"
          data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
          data-inspector={showInspector ? "open" : "closed"}
        >
          <nav className="sidebar" aria-label="Main">
            <Link to="/" className="sidebar-brand" aria-label="Vuurtoren, Read">
              <Logo size={26} className="brand-logo" title="Vuurtoren" />
            </Link>
            {/* The two rooms, then the quieter places; on a phone: Read · Words · More. */}
            <NavLink to="/" label="Read" icon={<BookOpen size={18} />} active={room === "read"} />
            {/* Words opens on its home: Due today first, then the word lists and Practice. */}
            <NavLink
              to="/words"
              label="Words"
              icon={<Languages size={18} />}
              active={room === "words"}
              badge={wordsDue}
              badgeNoun={native ? "card" : "exercise"}
              badgeWhere={native ? "Review" : "Practice"}
            />
            <div className="nav-divider" role="separator" />
            <NavLink to="/grammar" label="Grammar" icon={<BookText size={18} />} secondary />
            <NavLink to="/exam" label="Exam" icon={<ClipboardCheck size={18} />} secondary />
            <NavLink to="/courses" label="Courses" icon={<GraduationCap size={18} />} secondary />
            {talk ? (
              <NavLink to="/talk" label="Talk" icon={<MessagesSquare size={18} />} secondary />
            ) : null}
            <div className="nav-spacer" />
            {/* Support: a plain link out, also in the phone's More sheet. */}
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="nav-link nav-link--secondary"
              title="Support Vuurtoren"
            >
              <Heart size={18} />
              <span className="nav-label">Support</span>
            </a>
            <NavLink to="/settings" label="Settings" icon={<SettingsIcon size={18} />} secondary />
            <button
              ref={moreButton}
              type="button"
              className="nav-link nav-more"
              aria-expanded={moreOpen}
              aria-controls="nav-more-sheet"
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <Ellipsis size={18} />
              <span className="nav-label">More</span>
            </button>
          </nav>
          {moreOpen ? (
            <>
              <div className="nav-more-scrim" onClick={dismissMore} aria-hidden />
              <div className="nav-more-sheet" id="nav-more-sheet" role="menu" aria-label="More">
                {(
                  [
                    ["/grammar", "Grammar", <BookText key="g" size={18} />],
                    ["/exam", "Exam", <ClipboardCheck key="e" size={18} />],
                    ["/courses", "Courses", <GraduationCap key="c" size={18} />],
                    ...(talk
                      ? [["/talk", "Talk", <MessagesSquare key="t" size={18} />] as const]
                      : []),
                    ["/progress", "Progress", <TrendingUp key="p" size={18} />],
                    ["/settings", "Settings", <SettingsIcon key="s" size={18} />],
                  ] as const
                ).map(([to, label, icon]) => (
                  <MoreLink
                    key={to}
                    to={to}
                    label={label}
                    icon={icon}
                    onSelect={() => setMoreOpen(false)}
                  />
                ))}
                <a
                  href={SUPPORT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="nav-more-item"
                  role="menuitem"
                  onClick={() => setMoreOpen(false)}
                >
                  <Heart size={18} />
                  <span>Support Vuurtoren</span>
                </a>
                <button
                  type="button"
                  className="nav-more-item"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    startTour();
                  }}
                >
                  <Compass size={18} />
                  <span>Show the tour</span>
                </button>
                {/* On phones the theme lives here: the top bar keeps its room for the page. */}
                <button
                  type="button"
                  className="nav-more-item"
                  role="menuitem"
                  onClick={() => setTheme(THEME_NEXT[theme])}
                >
                  {THEME_ICON[theme]}
                  <span>Theme: {THEME_LABEL[theme]}</span>
                </button>
              </div>
            </>
          ) : null}

          <div className="main">
            {desktop ? <DesktopSetup /> : null}
            <AnkiSyncLine />
            {notice || demo ? (
              <div className="shell-notices">
                {demo ? (
                  <div className="shell-notice shell-notice--demo" role="note">
                    <Chip tone="accent">Demo data</Chip>
                    <span className="shell-notice-text">
                      Nothing here is saved to your account.
                    </span>
                    {onLeaveDemo ? (
                      <button type="button" className="link-button" onClick={onLeaveDemo}>
                        Use my data
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {notice ? (
                  <div className="shell-notice" role="status">
                    <span>{notice}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            <header
              className="topbar"
              {...(header?.reader ? { "data-reader": "" } : {})}
              {...(headingHidden ? { "data-bare": "" } : {})}
            >
              <Button
                variant="ghost"
                size="sm"
                icon
                className="topbar-sidebar-toggle"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setSidebarCollapsed((c) => !c)}
              >
                <PanelLeft size={16} />
              </Button>
              <div className="topbar-heading" data-hidden={headingHidden || undefined}>
                {header?.parent ? (
                  <>
                    <a
                      className="topbar-crumb"
                      href={header.parent.to}
                      onClick={(e) => {
                        e.preventDefault();
                        goto(header.parent!.to);
                      }}
                    >
                      {header.parent.label}
                    </a>
                    <span className="topbar-crumb-sep" aria-hidden>
                      /
                    </span>
                  </>
                ) : null}
                {/* One h1 per page: the page's own heading, unless it asks the top bar for it. */}
                {header?.heading ? (
                  <h1 className={titleClass}>{title}</h1>
                ) : (
                  <span className={titleClass}>{title}</span>
                )}
              </div>
              {/* A reader page fills this with its own controls (the top bar is its reader bar). */}
              <div className="topbar-page" ref={setToolbarEl} hidden={!header?.reader} />
              {header?.reader ? null : <div className="topbar-spacer" />}
              <div className="topbar-group">
                <DegradedIndicator />
                <Button
                  variant="secondary"
                  size="sm"
                  className="topbar-palette"
                  aria-label="Open command palette"
                  onClick={() => setPaletteOpen(true)}
                >
                  <CommandIcon size={14} />
                  <kbd className="topbar-kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
                </Button>
                <Tooltip content={`Theme: ${theme}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    className="topbar-theme"
                    aria-label={`Theme: ${theme}. Switch theme`}
                    onClick={() => setTheme(THEME_NEXT[theme])}
                  >
                    {THEME_ICON[theme]}
                  </Button>
                </Tooltip>
              </div>
            </header>
            <div className="main-body">
              <main className="content" id="content" ref={setContentEl}>
                <Outlet />
              </main>
              {/* Over the content, not beside it: closed it takes no space, open it slides in and
                the reader column moves aside (transform only, no reflow). */}
              <aside
                ref={sheetRef}
                className="inspector-panel"
                aria-label="Inspector"
                hidden={!inspectorAvailable}
                inert={!showInspector}
                data-sheet={sheet.size}
              >
                {/* Phones and tablets: the grab handle of the bottom sheet (also a button). */}
                <button
                  type="button"
                  className="sheet-grip"
                  aria-label={
                    sheet.size === "peek"
                      ? "Show all of the word panel"
                      : "Show less of the word panel"
                  }
                  aria-expanded={sheet.size === "full"}
                  onClick={sheet.toggle}
                >
                  <span className="sheet-grip-bar" aria-hidden />
                </button>
                <div className="inspector-head">
                  <span className="k-overline">Word</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon
                    aria-label="Close the word panel (Esc)"
                    onClick={() => setInspectorOpen(false)}
                  >
                    <X size={16} />
                  </Button>
                </div>
                <div className="inspector-scroll">
                  <div className="inspector-body" ref={setInspectorEl} />
                </div>
              </aside>
            </div>
          </div>
        </div>
        <Tour />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={(o) => {
            setPaletteOpen(o);
            if (!o) setPaletteSearch("");
          }}
          groups={groups}
          placeholder="Search pages, texts and words"
          onSearchChange={setPaletteSearch}
        />
      </ShellContext.Provider>
    </NativeModeContext.Provider>
  );
}

/**
 * Whether the page's own title (the PageHeader h1) is visible in the scrolling content. Pages
 * render their header late (after loading), so the observed element is looked up again
 * whenever the content changes.
 */
function usePageTitleInView(contentEl: HTMLElement | null): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!contentEl || typeof IntersectionObserver === "undefined") return;
    let watched: Element | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries.at(-1);
        if (last) setInView(last.isIntersecting);
      },
      { root: contentEl },
    );
    const attach = () => {
      const h = contentEl.querySelector(".page-title");
      if (h === watched) return;
      if (watched) io.unobserve(watched);
      watched = h;
      if (h) io.observe(h);
      else setInView(false);
    };
    attach();
    const mo = new MutationObserver(attach);
    mo.observe(contentEl, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, [contentEl]);
  return inView;
}

type FixedRoute =
  | "/"
  | "/practice"
  | "/review"
  | "/courses"
  | "/talk"
  | "/words"
  | "/grammar"
  | "/exam"
  | "/progress"
  | "/settings";

function NavLink({
  to,
  label,
  icon,
  badge,
  badgeNoun = "exercise",
  badgeWhere = "Practice",
  active,
  secondary,
}: {
  to: FixedRoute;
  label: string;
  icon: ReactNode;
  badge?: number | undefined;
  /** What the badge counts ("exercise", "card") and where they are due. */
  badgeNoun?: string;
  badgeWhere?: string;
  /** Marked as the current place (a room spans several routes); else by its own route. */
  active?: boolean;
  /** Folded into the phone tab bar's More sheet. */
  secondary?: boolean;
}) {
  const className = secondary ? "nav-link nav-link--secondary" : "nav-link";
  return (
    <Link
      to={to}
      className={className}
      title={label}
      activeOptions={{ exact: active !== undefined, includeSearch: false }}
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span className="nav-label">{label}</span>
      {badge ? (
        <span
          className="nav-badge"
          aria-label={`${plural(badge, badgeNoun)} due`}
          title={`${plural(badge, badgeNoun)} due in ${badgeWhere}`}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function MoreLink({
  to,
  label,
  icon,
  onSelect,
}: {
  to: FixedRoute;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Link to={to} className="nav-more-item" role="menuitem" onClick={onSelect}>
      {icon}
      <span>{label}</span>
    </Link>
  );
}
