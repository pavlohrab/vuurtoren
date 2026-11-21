/**
 * The Words room: everything about vocabulary. Its home (WordsHome) shows what is due today;
 * its sub-pages (the lists, Practice, Progress) share one strip on top with the way back and
 * where the learner stands (the current starter level). Shared level helpers live here.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "@app/ui";
import { useServices } from "../../services/context.js";
import { loadStarterWords } from "../../services/starterWords.js";
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


const fmt = (n: number) => n.toLocaleString("en");

/**
 * The strip on top of the Words sub-pages (the lists, Practice, Progress): the way back to the
 * Words home, and where the learner stands.
 */
export function WordsRoom() {
  const level = useCurrentLevel();
  return (
    <div className="words-room">
      <Link to="/words" className="words-room-back">
        <ChevronLeft size={16} aria-hidden /> Words
      </Link>
      <p className="words-room-summary" aria-label="Where you are">
        {level ? (
          <Link to="/words/all" search={{ group: "level" }} className="words-room-level">
            Level {level.level}
            <span className="words-room-quiet">
              {" "}
              · {fmt(level.known)} of {fmt(level.size)} known
            </span>
          </Link>
        ) : (
          <Skeleton style={{ height: 16, width: 140 }} />
        )}
      </p>
    </div>
  );
}
