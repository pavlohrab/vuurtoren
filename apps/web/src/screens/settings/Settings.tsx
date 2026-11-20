/**
 * Settings: sections with a sub-nav on the left (a list on phones), each saving itself a
 * moment after a change. Account · Language & decks · Reading & audio · AI · Data & backup · Sync ·
 * Advanced.
 * The theme lives only in the top bar.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Database,
  Languages,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Input, Select, Skeleton, Slider, useNativeMode } from "@app/ui";
import { InstallApp } from "../../pwa/PwaControls.js";
import { useServices } from "../../services/context.js";
import type { Settings as SettingsData } from "../../services/types.js";
import { PageHeader } from "../../shell/PageHeader.js";
import { useTheme } from "../../theme.js";
import { AccountSettings } from "./AccountSettings.js";
import { AISettings } from "./AISettings.js";
import { ClaudeCodeSettings } from "./ClaudeCodeSettings.js";
import { AnkiConnection } from "./AnkiSettings.js";
import { DataSettings } from "./DataSettings.js";
import { LanguageDecksSettings } from "./LanguageDecksSettings.js";
import { SavedNote } from "./SavedNote.js";
import { SyncSettings } from "./SyncSettings.js";
import { ServerStatus } from "./ServerStatus.js";
import { useAutosave } from "./useAutosave.js";
import "./settings.css";

export type SectionId = "language" | "reading" | "ai" | "data" | "sync" | "account" | "advanced";

const SECTIONS: { id: SectionId; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: "account",
    label: "Account",
    hint: "Who is signed in on this server.",
    icon: <UserRound size={18} />,
  },
  {
    id: "language",
    label: "Language & decks",
    hint: "Anki, the decks Vuurtoren reads and where new words go.",
    icon: <Languages size={18} />,
  },
  {
    id: "reading",
    label: "Reading & audio",
    hint: "Translations, words to learn per page, blanks, grammar and the voice.",
    icon: <BookOpen size={18} />,
  },
  {
    id: "ai",
    label: "AI",
    hint: "Your own provider, or Claude Code with your subscription.",
    icon: <Sparkles size={18} />,
  },
  {
    id: "data",
    label: "Data & backup",
    hint: "Where your data lives; download and restore a backup.",
    icon: <Database size={18} />,
  },
  {
    id: "sync",
    label: "Sync",
    hint: "Your data on every device, encrypted with your passphrase.",
    icon: <RefreshCw size={18} />,
  },
  {
    id: "advanced",
    label: "Advanced",
    hint: "Server status, version, language server and AnkiConnect addresses, install the app.",
    icon: <SlidersHorizontal size={18} />,
  },
];

const isSection = (v: string | undefined): v is SectionId => SECTIONS.some((s) => s.id === v);

/** Settings: a section list and the chosen section. */
export function SettingsScreen() {
  const { section: raw }: { section?: string } = useSearch({ from: "/settings" });
  const chosen = isSection(raw) ? raw : null;
  // Wide screens always show a section; phones show the list until one is picked.
  const section = chosen ?? "language";
  const meta = SECTIONS.find((s) => s.id === section)!;
  // Native mode has no Anki connection: Move to Anki and deck files live in Language & decks.
  const native = useNativeMode();
  return (
    <div className="page page--list settings-page" data-picked={chosen ? "" : undefined}>
      <PageHeader
        title="Settings"
        lede="Everything stays on your device unless you point it elsewhere. Changes save themselves."
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to="/settings"
              search={{ section: s.id }}
              className="settings-nav-item"
              aria-current={s.id === section ? "page" : undefined}
            >
              <span className="settings-nav-icon" aria-hidden>
                {s.icon}
              </span>
              <span className="settings-nav-text">
                {s.label}
                <small>{s.hint}</small>
              </span>
              <ChevronRight size={16} className="settings-nav-go" aria-hidden />
            </Link>
          ))}
        </nav>
        <section className="settings-panel" aria-labelledby="settings-section-h">
          <Link to="/settings" className="settings-back">
            <ArrowLeft size={16} aria-hidden /> All settings
          </Link>
          <header className="settings-panel-head">
            <h2 id="settings-section-h">{meta.label}</h2>
            <p className="k-hint">{meta.hint}</p>
          </header>
          {section === "language" ? (
            <div className="stack settings-stack">
              {native ? null : <AnkiConnection />}
              <LanguageDecksSettings />
            </div>
          ) : section === "reading" ? (
            <ReadingSettings />
          ) : section === "ai" ? (
            <div className="stack settings-stack">
              <AISettings />
              <ClaudeCodeSettings />
            </div>
          ) : section === "data" ? (
            <DataSettings />
          ) : section === "sync" ? (
            <SyncSettings />
          ) : section === "account" ? (
            <AccountSettings />
          ) : (
            <AdvancedSettings />
          )}
        </section>
      </div>
    </div>
  );
}

/** The app settings (addresses, reading) as an autosaved draft. */
function useSettingsDraft() {
  const services = useServices();
  const qc = useQueryClient();
  const [theme] = useTheme();
  const saved = useQuery({ queryKey: ["settings"], queryFn: () => services.getSettings() });
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const form = draft ?? saved.data ?? null;
  const save = useAutosave(draft, async (s) => {
    await services.saveSettings({ ...s, theme });
    await qc.invalidateQueries({ queryKey: ["settings"] });
    // A changed address may connect (or disconnect) Anki.
    void qc.invalidateQueries({ queryKey: ["anki-status"] });
  });
  const set = (patch: Partial<SettingsData>) => {
    if (form) setDraft({ ...form, ...patch });
  };
  return { form, set, setDraft, save };
}

const NEW_WORD_OPTIONS = [
  { value: "auto", label: "Auto (adapts to how you read)" },
  ...[0, 1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: String(n) })),
];

function ReadingSettings() {
  const { form, set, save } = useSettingsDraft();
  if (!form) return <Skeleton style={{ height: 160 }} />;
  return (
    <div className="stack settings-stack">
      <SavedNote status={save.status} error={save.error} />
      <div className="settings-field">
        <span className="k-label" id="help-dial">
          Translations in Gloss mode
        </span>
        <Slider
          aria-label="Translations in Gloss mode"
          value={Math.round(form.help * 100)}
          onValueChange={(v) => set({ help: v / 100 })}
        />
        <p className="k-hint">
          Left: only new words get a translation. Right: most words do. The reader has the same
          dial.
        </p>
      </div>
      <div style={{ maxWidth: 320 }}>
        <Select
          label="Words to learn per page"
          value={String(form.newWords)}
          options={NEW_WORD_OPTIONS}
          onValueChange={(v) => set({ newWords: v === "auto" ? "auto" : Number(v) })}
        />
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={form.glossClozes}
          onChange={(e) => set({ glossClozes: e.target.checked })}
        />
        <span>
          Blanks in Gloss mode
          <small>Also ask for a few words while translations are shown.</small>
        </span>
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={form.grammarMarks}
          onChange={(e) => set({ grammarMarks: e.target.checked })}
        />
        <span>
          Grammar marks
          <small>
            A quiet mark in the margin beside sentences with grammar worth noticing at your level.
          </small>
        </span>
      </label>
      <h3 className="settings-h3">Audio</h3>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 160 }}>
          <Select
            label="Voice"
            value={form.voice}
            options={[
              { value: "female", label: "Female" },
              { value: "male", label: "Male" },
            ]}
            onValueChange={(v) => set({ voice: v === "male" ? "male" : "female" })}
          />
        </div>
        <div style={{ minWidth: 160 }}>
          <Select
            label="Speed"
            value={String(form.audioRate)}
            options={[
              { value: "0.8", label: "0.8×" },
              { value: "1", label: "1×" },
            ]}
            onValueChange={(v) => set({ audioRate: v === "0.8" ? 0.8 : 1 })}
          />
        </div>
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={form.autoplayWord}
          onChange={(e) => set({ autoplayWord: e.target.checked })}
        />
        <span>
          Say the word when a card shows
          <small>Recorded starter words; other words use your system's Dutch voice.</small>
        </span>
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={form.autoplaySentence}
          onChange={(e) => set({ autoplaySentence: e.target.checked })}
        />
        <span>
          Say the sentence when the answer shows
          <small>R replays the word during review.</small>
        </span>
      </label>
    </div>
  );
}

function AdvancedSettings() {
  const { form, set, setDraft, save } = useSettingsDraft();
  if (!form) return <Skeleton style={{ height: 160 }} />;
  return (
    <div className="stack settings-stack">
      <SavedNote status={save.status} error={save.error} />
      <Input
        label="Language server address"
        value={form.nlpUrl}
        hint="The Dutch analysis, dictionary and translation server."
        onChange={(e) => set({ nlpUrl: e.target.value })}
      />
      <Input
        label="AnkiConnect address"
        value={form.ankiUrl}
        onChange={(e) => set({ ankiUrl: e.target.value })}
      />
      <Input
        label="AnkiConnect key"
        type="password"
        value={form.ankiKey ?? ""}
        hint="Only needed if you set an API key in the AnkiConnect add-on."
        onChange={(e) => {
          if (e.target.value) set({ ankiKey: e.target.value });
          else {
            const { ankiKey: _drop, ...rest } = form;
            void _drop;
            setDraft(rest);
          }
        }}
      />
      <ServerStatus nlpUrl={form.nlpUrl} />
      <InstallApp />
    </div>
  );
}
