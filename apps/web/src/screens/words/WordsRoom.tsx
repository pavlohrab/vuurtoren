/**
 * The Words room: everything about vocabulary in one place. Its four pages (Your words, Review,
 * Practice, Progress) share one strip on top: the room's tabs and, beside them, where the
 * learner stands (the current starter level, known and learning words). Each tab is its own
 * route, so links, bookmarks and the back button keep working.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Skeleton, useNativeMode } from "@app/ui";
import { useServices } from "../../services/context.js";
import { loadStarterWords } from "../../services/starterWords.js";
import { plural } from "../../format.js";
import { type StarterIndex, currentLevel, levelProgress, starterIndex } from "./levels.js";
import "./wordsRoom.css";

/** With a level filter or grouping, every word is read and then narrowed. */
export const ALL_WORDS = 100_000;

let starterIndexCache: Promise<StarterIndex> | null = null;
/** The starter list's ranks by key (loaded on first use). */
export function loadStarterIndex(): Promise<StarterIndex> {
  starterIndexCache ??= loadStarterWords().then(starterIndex);
  return starterIndexCache;
}

/** Known and learning words per starter level (shared by Words, the room strip and Read). */
export function useLevelProgress(enabled = true) {
  const services = useServices();
  return useQuery({
    queryKey: ["words", "level-progress"],
    queryFn: async () => {
      const idx = await loadStarterIndex();
      const keys = [...idx.rank.keys()];
      return levelProgress(idx, await services.words({ keys, limit: ALL_WORDS }));
    },
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/** "Level 2 · 312 of 500 known": the level the learner is working on, or null while loading. */
export function useCurrentLevel(): { level: number; known: number; size: number } | null {
  const q = useLevelProgress();
  const l = q.data ? currentLevel(q.data) : null;
  return l ? { level: l.level, known: l.known, size: l.size } : null;
}

export type WordsTab = "words" | "review" | "practice" | "progress";

const fmt = (n: number) => n.toLocaleString("en");

/** The strip on top of every Words page: the tabs, and the level summary in one row. */
export function WordsRoom({ tab }: { tab: WordsTab }) {
  const services = useServices();
  const native = useNativeMode();
  const review = useQuery({
    queryKey: ["review", "overview"],
    queryFn: () => services.reviewOverview(),
    staleTime: 60_000,
    enabled: native,
  });
  const practice = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
    staleTime: 60_000,
  });
  const summary = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const level = useCurrentLevel();
  const s = summary.data;
  const reviews = review.data ? review.data.due + review.data.fresh : 0;
  return (
    <div className="words-room">
      <nav className="words-tabs" aria-label="Words">
        <RoomTab to="/words" current={tab === "words"}>
          Your words
        </RoomTab>
        {native ? (
          <RoomTab
            to="/review"
            current={tab === "review"}
            count={reviews}
            countLabel={plural(reviews, "review")}
          >
            Review
          </RoomTab>
        ) : null}
        <RoomTab
          to="/practice"
          current={tab === "practice"}
          count={practice.data?.due ?? 0}
          countLabel={plural(practice.data?.due ?? 0, "exercise")}
        >
          Practice
        </RoomTab>
        <RoomTab to="/progress" current={tab === "progress"}>
          Progress
        </RoomTab>
      </nav>
      <p className="words-room-summary" aria-label="Where you are">
        {level ? (
          <Link to="/words" search={{ group: "level" }} className="words-room-level">
            Level {level.level}
            <span className="words-room-quiet">
              {" "}
              · {fmt(level.known)} of {fmt(level.size)} known
            </span>
          </Link>
        ) : (
          <Skeleton style={{ height: 16, width: 140 }} />
        )}
        {s ? <span className="words-room-quiet"> · {fmt(s.learning)} learning</span> : null}
      </p>
    </div>
  );
}

function RoomTab({
  to,
  current,
  count,
  countLabel,
  children,
}: {
  to: "/words" | "/review" | "/practice" | "/progress";
  current: boolean;
  count?: number;
  countLabel?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="words-tab"
      aria-current={current ? "page" : undefined}
      data-current={current || undefined}
    >
      {children}
      {count ? (
        <span className="words-tab-count" aria-label={`, ${countLabel ?? count} due`}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}
