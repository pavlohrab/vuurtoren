import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type LanguageProfile, defaultProfile, profileMode } from "@app/core";
import { Button, Skeleton, Spinner, useToast } from "@app/ui";
import { useServices } from "../../services/context.js";
import {
  DeckChecklist,
  DestinationFields,
  LanguageChoice,
  deckRows,
} from "../onboarding/deckParts.js";

import { CardsSettings } from "./CardsSettings.js";
import { SavedNote } from "./SavedNote.js";
import { useAutosave } from "./useAutosave.js";
import { errorText } from "../../services/errors.js";

/** Settings → Language & decks: the language profile. */
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
  // Saved a moment after each change; an empty default deck is not saved.
  const save = useAutosave(
    draft,
    async (p) => {
      const sourcesChanged =
        JSON.stringify(p.sources) !== JSON.stringify(saved.data?.sources ?? []);
      // The mode is changed only by the move to Vuurtoren, never by this form.
      await services.saveLanguageProfile({ ...p, mode: saved.data?.mode ?? p.mode ?? "connected" });
      await qc.invalidateQueries({ queryKey: ["languageProfile"] });
      await qc.invalidateQueries({ queryKey: ["deckChoices"] });
      if (sourcesChanged) toast("Decks saved", "Sync from Anki to read the chosen decks.");
    },
    { valid: Boolean(draft?.destinations.default.trim()) },
  );

  if (!profile) return <Skeleton style={{ height: 160 }} />;
  const rows = deckRows(detect.data ?? [], profile.sources);
  // The saved mode decides (a move to Vuurtoren changes it outside this form).
  const native = profileMode(saved.data ?? profile) === "native";

  return (
    <section className="stack" aria-label="Your words">
      <SavedNote status={save.status} error={save.error} />
      {saved.data === null ? (
        <p className="ob-note">
          Vuurtoren does not know your decks yet. <Link to="/welcome">Set up step by step</Link>, or
          choose them here.
        </p>
      ) : null}
      <LanguageChoice value={profile.lang} onChange={(lang) => setDraft({ ...profile, lang })} />

      <CardsSettings native={native} />

      {native ? null : (
        <>
          <h3 className="settings-h3">Decks Vuurtoren reads</h3>
          <p className="k-hint" style={{ margin: 0 }}>
            Words in these decks count as known or learning. Vuurtoren&rsquo;s own decks are always
            read.
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
              Could not look at your decks. {errorText(detect.error)}
            </p>
          ) : null}
        </>
      )}

      <h3 className="settings-h3">Where new words go</h3>
      <p className="k-hint" style={{ margin: 0 }}>
        The deck a word joins when you add it, by where you found it.
      </p>
      <DestinationFields profile={profile} onChange={setDraft} />
      {draft && !profile.destinations.default.trim() ? (
        <p className="error-text" role="alert" style={{ margin: 0 }}>
          Name a default deck to save.
        </p>
      ) : null}
    </section>
  );
}
