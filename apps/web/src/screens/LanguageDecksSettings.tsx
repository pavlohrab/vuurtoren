import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type LanguageProfile, defaultProfile } from "@app/core";
import { Button, Skeleton, Spinner, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import {
  DeckChecklist,
  DestinationFields,
  LanguageChoice,
  deckRows,
} from "./onboarding/deckParts.js";

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");

/** Settings → Language & decks: the language profile (ADR 0010). */
export function LanguageDecksSettings() {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const saved = useQuery({
    queryKey: ["languageProfile"],
    queryFn: () => services.languageProfile(),
  });
  const [draft, setDraft] = useState<LanguageProfile | null>(null);
  const profile = draft ?? saved.data ?? (saved.isSuccess ? defaultProfile("nl") : null);
  const detect = useMutation({ mutationFn: () => services.suggestDecks() });
  const save = useMutation({
    mutationFn: (p: LanguageProfile) => services.saveLanguageProfile(p),
    onSuccess: async () => {
      toast("Decks saved", "Sync from Anki to read the chosen decks.");
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ["languageProfile"] });
      await qc.invalidateQueries({ queryKey: ["deckChoices"] });
    },
    onError: (e) => toast("Could not save the decks", message(e)),
  });

  if (!profile) return <Skeleton style={{ height: 160 }} />;
  const rows = deckRows(detect.data ?? [], profile.sources);

  return (
    <section className="stack" aria-labelledby="lang-decks" style={{ marginTop: 40 }}>
      <h2 id="lang-decks" style={{ fontSize: 19 }}>
        Language &amp; decks
      </h2>
      {saved.data === null ? (
        <p className="ob-note">
          Kenning does not know your decks yet. <Link to="/welcome">Set up step by step</Link>, or
          choose them here.
        </p>
      ) : null}
      <LanguageChoice value={profile.lang} onChange={(lang) => setDraft({ ...profile, lang })} />

      <h3 style={{ fontSize: 16, margin: "8px 0 0" }}>Decks Kenning reads</h3>
      <p className="k-hint" style={{ margin: 0 }}>
        Words in these decks count as known or learning. Kenning&rsquo;s own decks are always read.
      </p>
      {rows.length ? (
        <DeckChecklist
          rows={rows}
          chosen={profile.sources}
          onChange={(sources) => setDraft({ ...profile, sources })}
        />
      ) : (
        <p style={{ margin: 0 }}>No decks chosen. Detect your decks to see suggestions.</p>
      )}
      <div className="row">
        <Button onClick={() => detect.mutate()} disabled={detect.isPending}>
          {detect.isPending ? <Spinner label="Looking at your decks" /> : null}
          {detect.data ? "Detect again" : "Detect decks"}
        </Button>
        {detect.data && detect.data.length === 0 ? (
          <span className="k-hint">No Dutch vocabulary decks found.</span>
        ) : null}
      </div>
      {detect.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          Could not look at your decks. {message(detect.error)}
        </p>
      ) : null}

      <h3 style={{ fontSize: 16, margin: "8px 0 0" }}>Where new words go</h3>
      <DestinationFields profile={profile} onChange={setDraft} />
      <div className="row">
        <Button
          variant="primary"
          disabled={save.isPending || !draft || !profile.destinations.default.trim()}
          onClick={() => save.mutate(profile)}
        >
          Save decks
        </Button>
        {draft ? (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Discard changes
          </Button>
        ) : null}
      </div>
    </section>
  );
}
