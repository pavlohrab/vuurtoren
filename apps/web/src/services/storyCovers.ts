/**
 * The bundled stories' covers (`content/stories/covers/<slug>.webp`): old paintings, prints and
 * photos from Wikimedia Commons, public domain or CC, each credited in `credits.json`. A story
 * finds its cover by its slug. The images stay separate files and load only when shown. A cover
 * the learner sets on an opened story still wins.
 */
import credits from "../../../../content/stories/covers/credits.json";

const FILES = import.meta.glob<string>("../../../../content/stories/covers/*.webp", {
  query: "?url",
  import: "default",
  eager: true,
});

const BY_SLUG = new Map(
  Object.entries(FILES).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -5), url]),
);

/** The cover image of a bundled story, or undefined when it has none. */
export function storyCoverUrl(slug: string | null | undefined): string | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

export interface CoverCredit {
  work: string;
  author: string;
  licence: string;
  licence_url?: string;
  source_url?: string;
}

/** Where a story's cover comes from, for its credit line. */
export function storyCoverCredit(slug: string | null | undefined): CoverCredit | undefined {
  return slug ? (credits as Record<string, CoverCredit>)[slug] : undefined;
}
