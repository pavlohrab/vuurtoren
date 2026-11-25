/**
 * Words: what is due today first (Start opens the review in focus mode), then the word lists,
 * Practice and the level check. With Vuurtoren's own cards the day's work is the review queue,
 * as in Anki: due cards first, then new words up to the daily limit (Settings → Your words).
 * Connected to Anki, the reviews happen in Anki and Words shows the lists.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { BookOpenCheck, ChevronRight, Dumbbell, Gauge, Layers } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton, useNativeMode } from "@app/ui";
import { plural } from "../../format.js";
import { useServices } from "../../services/context.js";
import { PageHeader } from "../../shell/PageHeader.js";
import { usePageHeader } from "../../shell/ShellContext.js";
import { useCurrentLevel } from "./WordsRoom.js";
import { currentDevice } from "../../platform/index.js";
import "./wordsHome.css";
import { progressText } from "./levels.js";
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

export function WordsHome() {
  usePageHeader("Words");
  // On a wide computer window Words is one screen: the list with Today beside it (mock A, UI1).
  if (wideDesk()) return <Navigate to="/words/all" search={{ layout: "list" }} replace />;
  return (
    <div className="page page--list words-home">
      <PageHeader title="Words" />
      <WordsAside />
    </div>
  );
}

/** Due today, then the word lists, Practice and the level check: Words home, and the desktop's left column. */
export function WordsAside() {
  const services = useServices();
  const native = useNativeMode();
  const today = useQuery({
    queryKey: ["review", "overview"],
    queryFn: () => services.reviewOverview(),
    enabled: native,
  });
  const summary = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const practice = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
    staleTime: 60_000,
  });
  const level = useCurrentLevel();

  return (
    <>
      {native ? <DueToday due={today.data?.due} fresh={today.data?.fresh} /> : <AnkiNote />}

      <nav className="words-home-list" aria-label="Your words">
        <Row
          to="/words/all"
          search={{ state: "learning", layout: "list" }}
          icon={<Layers size={18} />}
          title="Learning"
          detail={summary.data ? `${fmt(summary.data.learning)} words` : null}
        />
        <Row
          to="/words/all"
          search={{ layout: "list" }}
          icon={<BookOpenCheck size={18} />}
          title="Met while reading"
          detail="New words from your texts"
        />
        <Row
          to="/practice"
          icon={<Dumbbell size={18} />}
          title="Practice"
          detail={
            practice.data
              ? practice.data.due
                ? `${plural(practice.data.due, "exercise")} due`
                : "Exercises with your words"
              : null
          }
        />
        <Row
          to="/words/all"
          search={level ? { layout: "cards", level: String(level.level) } : { layout: "cards" }}
          icon={<Gauge size={18} />}
          title="Check your level"
          detail={level ? `${starterBand(level.level)} · ${progressText(level)}` : null}
        />
      </nav>
    </>
  );
}

/** The day's work: one number, what it is made of, and Start. */
function DueToday({ due, fresh }: { due: number | undefined; fresh: number | undefined }) {
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
        </>
      ) : (
        <>
          <p className="due-today-count">All done</p>
          <p className="due-today-parts">Cards come back when they are due. Want more?</p>
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
        Your cards are reviewed in Anki. Words you add while reading go to your Anki deck.
      </p>
    </section>
  );
}

function Row({
  to,
  search,
  icon,
  title,
  detail,
}: {
  to: "/words/all" | "/practice";
  search?: Record<string, string>;
  icon: ReactNode;
  title: string;
  detail: string | null;
}) {
  return (
    <Link to={to} search={search ?? {}} className="words-home-row">
      <span className="words-home-icon" aria-hidden>
        {icon}
      </span>
      <span className="words-home-text">
        <span className="words-home-title">{title}</span>
        {detail ? <span className="words-home-detail">{detail}</span> : null}
      </span>
      <ChevronRight size={18} aria-hidden className="words-home-chevron" />
    </Link>
  );
}
