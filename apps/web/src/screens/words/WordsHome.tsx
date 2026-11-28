/**
 * Words: what is due today first (Start opens the review in focus mode), then your level and
 * your list. With Vuurtoren's own cards the day's work is the review queue,
 * as in Anki: due cards first, then new words up to the daily limit (Settings → Your words).
 * Connected to Anki, the reviews happen in Anki and Words shows the lists.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type CSSProperties, useState, useSyncExternalStore } from "react";
import { Skeleton, useNativeMode } from "@app/ui";
import { plural } from "../../format.js";
import { useServices } from "../../services/context.js";
import { PageHeader } from "../../shell/PageHeader.js";
import { usePageHeader } from "../../shell/ShellContext.js";
import { loadStarterIndex, useLevelProgress, useRarerWords } from "./WordsRoom.js";
import { type LevelFilter, currentLevel, levelLabel } from "./levels.js";
import { currentDevice } from "../../platform/index.js";
import "./wordsHome.css";
import { starterBand } from "@app/anki";

const fmt = (n: number) => n.toLocaleString("en");

/** A computer with room for the three columns (Today and the levels · the list · the word). */
export function wideDesk(): boolean {
  return (
    currentDevice().kind !== "android" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 1100px)").matches
  );
}

/** wideDesk() that follows the window: a computer window made narrow gets the phone's page. */
export function useWideDesk(): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const q = window.matchMedia("(min-width: 1100px)");
      q.addEventListener?.("change", changed);
      return () => q.removeEventListener?.("change", changed);
    },
    wideDesk,
    () => false,
  );
}

export function WordsHome() {
  usePageHeader("Words");
  const wide = useWideDesk();
  // On a wide computer window Words is one screen: the list with Today beside it (mock A, UI1).
  if (wide) return <Navigate to="/words/all" search={{ layout: "list" }} replace />;
  return (
    <div className="page page--list words-home">
      <PageHeader title="Words" />
      <WordsAside />
    </div>
  );
}

/** The phone's Words home (mock-practice-words A): the review, your level, then your list. */
export function WordsAside() {
  const services = useServices();
  const native = useNativeMode();
  const today = useQuery({
    queryKey: ["review", "overview"],
    queryFn: () => services.reviewOverview(),
    enabled: native,
  });

  return (
    <>
      {native ? <DueToday due={today.data?.due} fresh={today.data?.fresh} /> : <AnkiNote />}
      <LevelRing />
      <WordsPeek />
    </>
  );
}

/** The bands of the starter levels (starterBand), in order. */
const BANDS = ["A1", "A2", "B1", "B2"] as const;

/**
 * Your level, moving (mock progress-words-practice.html A): a ring for the band you're in,
 * "640 of 1,000", what changed this week and what's left to the next band. Opens Check your level.
 */
export function LevelRing() {
  const services = useServices();
  const progress = useLevelProgress();
  const week = useQuery({
    queryKey: ["progress", "known", 2],
    queryFn: () => services.knownOverTime(2),
    staleTime: 60_000,
  });
  const levels = progress.data ?? [];
  const current = currentLevel(levels);
  if (!current) return null;
  const band = starterBand(current.level);
  const inBand = levels.filter((p) => starterBand(p.level) === band);
  const known = inBand.reduce((n, p) => n + Math.min(p.known, p.size), 0);
  const size = inBand.reduce((n, p) => n + p.size, 0);
  const share = size ? known / size : 0;
  const next = BANDS[BANDS.indexOf(band) + 1];
  const pts = week.data ?? [];
  const up = pts.length >= 2 ? pts.at(-1)!.known - pts.at(-2)!.known : 0;
  return (
    <Link
      to="/words/all"
      search={{ layout: "cards", level: String(current.level) }}
      className="level-ring"
      aria-label={`Your level: ${band}, ${fmt(known)} of ${fmt(size)} words. Check your level`}
    >
      <span className="level-ring-dial" style={{ "--share": `${share * 100}%` } as CSSProperties}>
        <span>{band}</span>
      </span>
      <span className="level-ring-text">
        <b>
          {fmt(known)} of {fmt(size)} words
        </b>
        {up > 0 ? (
          <span>
            <span className="stages-up">+{fmt(up)}</span> known this week
          </span>
        ) : null}
        {next && size > known ? (
          <span>
            {fmt(size - known)} to {next}
          </span>
        ) : null}
      </span>
      <ChevronRight size={18} aria-hidden className="words-home-chevron" />
    </Link>
  );
}

/** How many words the phone's home shows before All words. */
const PEEK = 12;

/** Your words on the phone's home: Learning or Known, the first few, and All words. */
function WordsPeek() {
  const services = useServices();
  const [state, setState] = useState<"learning" | "known">("learning");
  const summary = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const words = useQuery({
    queryKey: ["words", "peek", state],
    queryFn: () => services.words({ state, limit: PEEK }),
    staleTime: 30_000,
  });
  const count = (n: number | undefined) => (n === undefined ? "" : ` ${fmt(n)}`);
  return (
    <section className="words-peek" aria-labelledby="words-peek-h">
      <h2 id="words-peek-h" className="due-today-label">
        Your words
      </h2>
      <div className="words-peek-chips" role="radiogroup" aria-label="Show">
        {(
          [
            ["learning", "Learning", summary.data?.learning],
            ["known", "Known", summary.data?.known],
          ] as const
        ).map(([value, label, n]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={state === value}
            className="words-peek-chip"
            onClick={() => setState(value)}
          >
            {label}
            {count(n)}
          </button>
        ))}
      </div>
      {words.data === undefined ? (
        <Skeleton style={{ height: 160 }} />
      ) : words.data.length === 0 ? (
        <p className="due-today-parts">
          {state === "learning" ? "Words you add while reading show here." : "None yet."}
        </p>
      ) : (
        <ul className="words-peek-list">
          {words.data.map((w) => (
            <li key={w.key}>
              <Link to="/words/all" search={{ word: w.key }} className="words-peek-row">
                <span className="words-peek-word">
                  {w.article ? `${w.article} ${w.key}` : w.key}
                </span>
                {w.gloss ? <span className="words-peek-gloss">{w.gloss}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/words/all" search={{ state, layout: "list" }} className="words-aside-link">
        All words →
      </Link>
    </section>
  );
}

/**
 * The computer's left column (mock MK2 A): Due today with Practise, the levels with progress
 * (each one a filter of the list beside it, with Check your level), and From your texts.
 */
export function WordsDeskAside({
  level,
  onLevel,
}: {
  level: LevelFilter | null;
  onLevel: (level: number | null) => void;
}) {
  const services = useServices();
  const native = useNativeMode();
  const today = useQuery({
    queryKey: ["review", "overview"],
    queryFn: () => services.reviewOverview(),
    enabled: native,
  });
  const index = useQuery({
    queryKey: ["starter-index"],
    queryFn: loadStarterIndex,
    staleTime: Infinity,
  });
  const progress = useLevelProgress();
  const rarer = useRarerWords();
  const anki = progress.data?.some((p) => p.fromAnki) ?? false;
  const most = Math.max(1, ...(rarer.data ?? []).map((g) => g.count));
  const decide = useQuery({
    queryKey: ["words", "to-decide-count"],
    queryFn: async () => (await services.wordsToDecide({ limit: DECIDE_CAP })).length,
    staleTime: 30_000,
  });
  const current = progress.data ? currentLevel(progress.data) : null;
  return (
    <>
      {native ? (
        <DueToday due={today.data?.due} fresh={today.data?.fresh} practise />
      ) : (
        <AnkiNote />
      )}
      <LevelRing />
      {index.data && progress.data?.length ? (
        <section className="words-levels" aria-labelledby="words-levels-h">
          <h2 id="words-levels-h" className="due-today-label">
            Levels
          </h2>
          <ul data-anki={anki || undefined}>
            {progress.data.map((p) => (
              <li key={p.level}>
                <button
                  type="button"
                  className="words-level-row"
                  aria-pressed={level === p.level}
                  onClick={() => onLevel(level === p.level ? null : p.level)}
                >
                  <span className="words-level-name">{levelLabel(index.data, p.level)}</span>
                  <span className="words-level-count">
                    {fmt(p.known)} / {fmt(p.size)}
                  </span>
                  <span className="words-level-bar" aria-hidden>
                    {p.fromAnki ? (
                      <span
                        className="words-level-bar-anki"
                        style={{ width: `${(100 * p.fromAnki) / Math.max(1, p.size)}%` }}
                      />
                    ) : null}
                    <span
                      style={{
                        width: `${(100 * (p.known - (p.fromAnki ?? 0))) / Math.max(1, p.size)}%`,
                      }}
                    />
                    <span
                      className="words-level-bar-learning"
                      style={{ width: `${(100 * p.learning) / Math.max(1, p.size)}%` }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {rarer.data?.length ? (
            <>
              <h3 className="due-today-label">Rarer words</h3>
              <ul data-anki>
                {rarer.data.map((g) => (
                  <li key={g.label} className="words-level-row words-level-row--static">
                    <span className="words-level-name">{g.label}</span>
                    <span className="words-level-count">{fmt(g.count)}</span>
                    <span className="words-level-bar" aria-hidden>
                      <span
                        className="words-level-bar-anki"
                        style={{ width: `${(100 * g.count) / most}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {anki ? (
            <p className="words-level-legend">
              <span>
                <i className="words-level-bar-anki" /> from Anki
              </span>
              <span>
                <i /> learned in Vuurtoren
              </span>
            </p>
          ) : null}
          <Link
            to="/words/all"
            search={
              current ? { layout: "cards", level: String(current.level) } : { layout: "cards" }
            }
            className="words-aside-link"
          >
            Check your level
          </Link>
        </section>
      ) : null}
      <section className="words-from-texts" aria-labelledby="words-from-texts-h">
        <h2 id="words-from-texts-h" className="due-today-label">
          From your texts
        </h2>
        <p className="due-today-parts">
          {decide.data === undefined
            ? "…"
            : decide.data === 0
              ? "Nothing to decide."
              : `${decide.data >= DECIDE_CAP ? `${DECIDE_CAP}+` : fmt(decide.data)} new ${decide.data === 1 ? "word" : "words"} to decide`}
        </p>
        {decide.data ? (
          <Link
            to="/words/all"
            search={{ state: "decide", layout: "list" }}
            className="words-aside-link"
          >
            Decide →
          </Link>
        ) : null}
      </section>
    </>
  );
}

/** At most this many words to decide are counted ("100+"). */
const DECIDE_CAP = 100;

/** The day's work: one number, what it is made of, and Start. */
function DueToday({
  due,
  fresh,
  practise = false,
}: {
  due: number | undefined;
  fresh: number | undefined;
  /** The computer's column: Practise these words under Start (mock MK2 A). */
  practise?: boolean;
}) {
  if (due === undefined || fresh === undefined)
    return <Skeleton className="due-today" style={{ height: 156 }} />;
  const total = due + fresh;
  return (
    <section className="due-today" aria-labelledby="due-today-title">
      <h2 id="due-today-title" className="due-today-label">
        Due today
      </h2>
      {total > 0 ? (
        <>
          <p className="due-today-count">{plural(total, "card")}</p>
          <p className="due-today-parts">
            {fmt(due)} to review · {fmt(fresh)} new
          </p>
          <Link to="/review" className="k-btn k-btn--primary due-today-start">
            Start
          </Link>
          {practise ? (
            <Link to="/practice" className="k-btn k-btn--secondary due-today-start">
              Practise these words
            </Link>
          ) : null}
        </>
      ) : (
        <>
          <p className="due-today-count">All done</p>
          <p className="due-today-parts">All done for today. Want more?</p>
          <div className="due-today-more">
            <Link to="/review" search={{ more: "new" }} className="k-btn k-btn--secondary">
              Continue with new words
            </Link>
            <Link to="/review" search={{ more: "learning" }} className="k-btn k-btn--ghost">
              Continue with learning words
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

function AnkiNote() {
  return (
    <section className="due-today due-today--anki">
      <h2 className="due-today-label">Reviews</h2>
      <p className="due-today-parts">
        You review your cards in Anki. Words you add go to your Anki deck.
      </p>
    </section>
  );
}
