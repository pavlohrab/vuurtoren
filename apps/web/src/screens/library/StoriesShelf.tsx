import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
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

/**
 * Stories: the graded stories that come with Vuurtoren, in a row per level (A1 first). Each
 * cover shows how much of the story the learner knows; a story below the comfortable coverage
 * stays visible, marked "A stretch". Opening one adds it to the Library (once) and reads it.
 */
export function StoriesShelf() {
  const services = useServices();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const shelf = useQuery({ queryKey: ["stories"], queryFn: () => services.storyShelf() });
  const rows = useMemo(() => storyRows(shelf.data ?? []), [shelf.data]);

  const open = useMutation({
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

  if (shelf.isError) return null;
  return (
    <section className="lib-stories" aria-labelledby="lib-stories-title">
      <header className="lib-stories-head">
        <h2 className="lib-stories-title" id="lib-stories-title">
          Stories
        </h2>
        <p className="lib-stories-lede">
          Graded stories that come with Vuurtoren: Dutch legends, retold classics and new stories.
        </p>
      </header>
      {shelf.isPending ? (
        <div className="lib-story-row" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 150, borderRadius: 12 }} />
          ))}
        </div>
      ) : (
        rows.map((row) => (
          <section
            key={row.level}
            className="lib-story-level"
            aria-labelledby={`stories-${row.level}`}
          >
            <h3 className="lib-story-level-title" id={`stories-${row.level}`}>
              {row.name}
              <span className="lib-shelf-count">
                {plural(row.covers.length, "story", "stories")}
              </span>
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
                      {c.textId ? <span className="lib-story-added">In your Library</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
