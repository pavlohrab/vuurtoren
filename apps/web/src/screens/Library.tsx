import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Library as LibraryIcon, Plus } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, EmptyState, Skeleton, TextCard, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import type { TextListItem } from "../services/types.js";
import { CreateStoryButton } from "./StoryDialog.js";
import { PageHeader } from "../shell/PageHeader.js";
import { ErrorNotice } from "../shell/ErrorNotice.js";
import { pagesOf } from "../textPages.js";

/** Page to continue on for a text that is started and not finished; null otherwise. */
function inProgress(t: TextListItem): { page: number; pages: number } | null {
  const { page, pages } = pagesOf(t);
  return t.lastSegment > 0 && t.lastSegment < pages ? { page, pages } : null;
}

/** Library: a grid of texts with coverage, new-word count and difficulty band. */
export function Library() {
  const services = useServices();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<TextListItem | null>(null);

  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const summary = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });

  const remove = useMutation({
    mutationFn: (id: string) => services.deleteText(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["texts"] });
      toast("Text deleted");
    },
    onError: (e) =>
      toast("Could not delete the text", e instanceof Error ? e.message : "Try again."),
  });

  const needsAnki = summary.data != null && summary.data.lastSync === null;

  return (
    <div className="page">
      <PageHeader
        title="Library"
        lede="Your shelf of texts, with how much of each you already know. Pick up where you left off."
        actions={
          <>
            <CreateStoryButton />
            <Link to="/import" className="k-btn k-btn--primary">
              <Plus size={16} aria-hidden /> Import text
            </Link>
          </>
        }
      />

      {needsAnki ? (
        <div className="banner" role="note">
          <span>Connect Anki and Kenning can tell how much of each text you already know.</span>
          <Button variant="secondary" onClick={() => void navigate({ to: "/settings" })}>
            Connect Anki
          </Button>
        </div>
      ) : null}

      {texts.isPending ? (
        <div className="shelf" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ aspectRatio: "4 / 5", borderRadius: 12 }} />
          ))}
        </div>
      ) : texts.isError ? (
        <ErrorNotice
          title="The library could not be loaded."
          error={texts.error}
          onRetry={() => void texts.refetch()}
        />
      ) : texts.data.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon size={28} />}
          title="Your library is empty"
          description="Paste a text, add a web page, or upload a PDF or photo to start reading."
          action={
            <Button variant="primary" onClick={() => void navigate({ to: "/import" })}>
              Import a text
            </Button>
          }
        />
      ) : (
        <div className="shelf">
          {texts.data.map((t) => (
            <TextCard
              key={t.id}
              title={t.title}
              sourceKind={t.sourceKind}
              sourceRef={t.sourceRef}
              progress={inProgress(t)}
              wordCount={t.wordCount}
              coverage={t.coverage}
              newTypes={t.newTypes}
              onOpen={() => void navigate({ to: "/read/$textId", params: { textId: t.id } })}
              onWords={() => void navigate({ to: "/read/$textId/words", params: { textId: t.id } })}
              onDelete={() => setPendingDelete(t)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Delete this text"
        description={
          pendingDelete ? `"${pendingDelete.title}" will be removed from your library.` : ""
        }
      >
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              if (pendingDelete) remove.mutate(pendingDelete.id);
              setPendingDelete(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
