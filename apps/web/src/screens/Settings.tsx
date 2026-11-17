import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input, Select, Skeleton, Spinner, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import type { LearnerSummary, Settings as SettingsData } from "../services/types.js";
import { AnkiSettings } from "./AnkiSettings.js";
import { useTheme, type ThemeChoice } from "../theme.js";

const THEMES = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Settings: Anki and NLP endpoints, target deck, theme and sync. */
export function SettingsScreen() {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const [theme, setTheme] = useTheme();

  const saved = useQuery({ queryKey: ["settings"], queryFn: () => services.getSettings() });
  // Edits live in `draft`; until the first edit the saved values are shown.
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const form = draft ?? saved.data ?? null;
  const setForm = setDraft;

  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [result, setResult] = useState<LearnerSummary | null>(null);

  const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");
  const persist = async (s: SettingsData) => {
    await services.saveSettings({ ...s, theme });
    await qc.invalidateQueries({ queryKey: ["settings"] });
  };
  const save = useMutation({
    mutationFn: persist,
    onSuccess: () => toast("Settings saved"),
    onError: (e) => toast("Could not save the settings", message(e)),
  });
  // Syncing uses the address and key on screen, so they are saved first.
  const sync = useMutation({
    mutationFn: async (s: SettingsData) => {
      setSyncLog([]);
      await persist(s);
      return services.syncAnki((m) => setSyncLog((l) => [...l, m]));
    },
    onSuccess: async (s) => {
      setResult(s);
      await qc.invalidateQueries({ queryKey: ["learner"] });
      await qc.invalidateQueries({ queryKey: ["texts"] });
    },
  });

  if (!form)
    return (
      <div className="page page--narrow">
        <Skeleton style={{ height: 200 }} />
      </div>
    );
  const set = <K extends keyof SettingsData>(k: K, v: SettingsData[K]) =>
    setForm({ ...form, [k]: v });
  const clearAnkiKey = () => {
    const { ankiKey: _drop, ...rest } = form;
    void _drop;
    setForm(rest);
  };

  return (
    <div className="page page--narrow">
      <h1>Settings</h1>
      <p className="page-lede">Everything stays on your device unless you point it elsewhere.</p>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(form);
        }}
      >
        <AnkiSettings form={form} set={set} persist={persist} clearKey={clearAnkiKey} />

        <h2 style={{ fontSize: 19, marginTop: 16 }}>Language server</h2>
        <Input
          label="NLP server address"
          value={form.nlpUrl}
          onChange={(e) => set("nlpUrl", e.target.value)}
        />

        <h2 style={{ fontSize: 19, marginTop: 16 }}>Appearance</h2>
        <div style={{ maxWidth: 240 }}>
          <Select
            label="Theme"
            value={theme}
            options={THEMES}
            onValueChange={(v) => setTheme(v as ThemeChoice)}
          />
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Save settings
          </Button>
        </div>
      </form>

      <section className="stack" style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 19 }}>Sync</h2>
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          Read your decks to learn which words you know.
        </p>
        <div className="row">
          <Button variant="primary" onClick={() => sync.mutate(form)} disabled={sync.isPending}>
            {sync.isPending ? <Spinner label="Syncing" /> : null}
            Sync from Anki
          </Button>
          <span className="k-hint">Uses the addresses above and saves them first.</span>
        </div>
        {sync.isPending || syncLog.length > 0 ? (
          <ul className="progress-log" aria-live="polite">
            {syncLog.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        ) : null}
        {sync.isError ? (
          <p className="error-text" role="alert">
            The sync did not finish. {message(sync.error)}
          </p>
        ) : null}
        {result ? (
          <p role="status" style={{ margin: 0 }}>
            Synced. {result.known.toLocaleString("en")} words known,{" "}
            {result.learning.toLocaleString("en")} in progress, about{" "}
            {result.vocabEstimate.toLocaleString("en")} in your vocabulary.
          </p>
        ) : null}
      </section>
    </div>
  );
}
