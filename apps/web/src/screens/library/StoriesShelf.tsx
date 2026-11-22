import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { Skeleton, useToast } from "@app/ui";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import { type StoryCover, storyRows } from "../../services/stories.js";
import { plural } from "../../format.js";

const KIND_LABEL: Record<StoryCover["kind"], string> = {
  legend: "Legend",
  classic: "Classic, retold",
  original: "New story",
};

/** The bundled stories with the learner's coverage (shared by the shelf and Today). */
export function useStoryShelf() {
  const services = useServices();
  return useQuery({ queryKey: ["stories"], queryFn: () => services.storyShelf() });
}

/** Open a bundled story: it joins Your texts (once) and the reader opens it. */
export function useOpenStory() {
  const services = useServices();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (slug: string) => services.openStory(slug),
    onSuccess: async (textId) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["texts"] }),
        qc.invalidateQueries({ queryKey: ["stories"] }),
      ]);
      void navigate({ to: "/read/$textId", params: { textId } });
    },
    onError: (e) => toast("Could not open the story", errorText(e)),
  });
}

/**
 * Stories for you: the graded stories that come with Vuurtoren, in a row per level, the
 * learner's level first. Each cover shows how much of the story the learner knows; a story
 * below the comfortable coverage stays visible, marked "A stretch".
 */
export function StoriesShelf() {
  const shelf = useStoryShelf();
  const rows = useMemo(() => storyRows(shelf.data ?? []), [shelf.data]);
  const open = useOpenStory();

  if (shelf.isError) return null;
  return (
    <section className="lib-stories" aria-labelledby="lib-stories-title">
      <header className="lib-stories-head">
        <h2 className="lib-stories-title" id="lib-stories-title">
          Stories for you
        </h2>
      </header>
      {shelf.isPending ? (
        <div className="lib-story-row" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 150, borderRadius: 12 }} />
          ))}
        </div>
      ) : (
        <>
          {rows[0] ? <StoryRow row={rows[0]} open={open} /> : null}
          {rows.length > 1 ? (
            <details className="k-disclosure lib-story-more">
              <summary>
                <ChevronRight size={16} className="k-disclosure-icon" aria-hidden />
                Other levels
                <span className="k-disclosure-hint">
                  {rows
                    .slice(1)
                    .map((r) => r.level)
                    .join(", ")}
                </span>
              </summary>
              <div className="k-disclosure-body">
                {rows.slice(1).map((row) => (
                  <StoryRow key={row.level} row={row} open={open} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

/** One level: its name and its stories, in a row that scrolls sideways. */
function StoryRow({
  row,
  open,
}: {
  row: ReturnType<typeof storyRows>[number];
  open: ReturnType<typeof useOpenStory>;
}) {
  // "A1 · Start here": the separator gets room of its own on both sides.
  const [level, tag] = row.name.split(" · ");
  return (
    <section className="lib-story-level" aria-label={row.name}>
      <h3 className="lib-story-level-title" id={`stories-${row.level}`}>
        <span>
          {level}
          {tag ? (
            <>
              {" "}
              <span className="lib-story-sep">·</span> {tag}
            </>
          ) : null}
        </span>
        <span className="lib-shelf-count">{plural(row.covers.length, "story", "stories")}</span>
      </h3>
      <ul className="lib-story-row">
        {row.covers.map((c) => (
          <li key={c.slug} className="lib-story" data-stretch={c.stretch ? "" : undefined}>
            <button
              type="button"
              className="lib-story-open"
              disabled={open.isPending}
              onClick={() => open.mutate(c.slug)}
            >
              <span className="lib-story-kind">
                {KIND_LABEL[c.kind]} · {c.words} words
              </span>
              <span className="lib-story-title">{c.title}</span>
              <span className="lib-story-summary">{c.summary}</span>
              <span className="lib-story-meta">
                <span className="lib-known">You know {Math.round(c.coverage * 100)}%</span>
                {c.stretch ? <span className="lib-story-stretch">A stretch</span> : null}
                {c.textId ? <span className="lib-story-added">In your texts</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
