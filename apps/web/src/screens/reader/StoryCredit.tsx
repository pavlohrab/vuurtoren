import { useQuery } from "@tanstack/react-query";
import { loadStories, storySlugOf } from "../../services/stories.js";

/**
 * "About this story" under a text that came from a bundled story: the original work and author
 * of a retelling, and the licence. Nothing for any other text.
 */
export function StoryCredit({ sourceRef }: { sourceRef?: string | undefined }) {
  const slug = storySlugOf(sourceRef);
  const story = useQuery({
    queryKey: ["story", slug],
    queryFn: async () => (await loadStories()).find((s) => s.slug === slug) ?? null,
    enabled: slug !== null,
    staleTime: Infinity,
  });
  const s = story.data;
  if (!s) return null;
  return (
    <p className="reader-story-credit">
      <span className="reader-story-credit-label">About this story:</span>{" "}
      {s.credit ? `${s.credit}, retold for Vuurtoren.` : "Written for Vuurtoren."} Licence{" "}
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
        {s.licence}
      </a>
      .
    </p>
  );
}
