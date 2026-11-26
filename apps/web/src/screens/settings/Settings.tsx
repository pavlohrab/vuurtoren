/**
 * Settings: five sections with a sub-nav on the left (a list on phones), each saving itself a
 * moment after a change: Your words · Reading · Your devices · AI (optional) · Data (backups,
 * account and the advanced addresses). Old section names in links still open their new home.
 * The theme lives only in the top bar.
 */
import { speedReport } from "../../perf/speed.js";
import { FeedbackSettings } from "../../feedback/FeedbackSheet.js";
import { PracticeFeelSettings } from "./PracticeFeelSettings.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Database,
  Languages,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Input, Select, Skeleton, Slider, useNativeMode, useToast } from "@app/ui";
import { InstallApp } from "../../pwa/PwaControls.js";
import { UpdateSetting } from "../library/UpdateCard.js";
import { useServices } from "../../services/context.js";
import type { Settings as SettingsData } from "../../services/types.js";
import { PageHeader } from "../../shell/PageHeader.js";
import { useAppInfo } from "../../shell/AppInfo.js";
import { ENGLISH_VISIBILITY, type ReaderPrefs, useReaderPrefs } from "../reader/readerPrefs.js";
import { useTheme } from "../../theme.js";
import { AccountSettings } from "./AccountSettings.js";
import { AISettings } from "./AISettings.js";
import { ClaudeCodeSettings } from "./ClaudeCodeSettings.js";
import { AnkiConnection } from "./AnkiSettings.js";
import { DataSettings } from "./DataSettings.js";
import { LanguageDecksSettings } from "./LanguageDecksSettings.js";
import { DictionaryPack } from "./DictionaryPack.js";
import { ConnectPhone } from "./ConnectPhone.js";
import { RecordingsPack, VoiceTest } from "./RecordingsPack.js";
import { startTour } from "../../shell/Tour.js";
import { SavedNote } from "./SavedNote.js";
import { SyncSettings } from "./SyncSettings.js";
import { ServerStatus } from "./ServerStatus.js";
import { useAutosave } from "./useAutosave.js";
import "./settings.css";

/** Voice speeds, slowest first: 1 is normal, the same pace for the recordings and every voice. */
const AUDIO_RATES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

function audioRateOf(v: string): number {
  const n = Number(v);
  return AUDIO_RATES.find((r) => r === n) ?? 1;
}

export type SectionId = "words" | "reading" | "devices" | "ai" | "data";

const SECTIONS: { id: SectionId; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: "words",
    label: "Your words",
    hint: "Your cards, new words a day, and deck files.",
    icon: <Languages size={18} />,
  },
  {
    id: "reading",
    label: "Reading",
    hint: "Help while you read, the voice, and the dictionary.",
    icon: <BookOpen size={18} />,
  },
  {
    id: "devices",
    label: "Your devices",
    hint: "Your phone and your computer, with the same words and texts.",
    icon: <RefreshCw size={18} />,
  },
  {
    id: "ai",
    label: "AI (optional)",
    hint: "Stories, Talk and easier pages, with your own AI key.",
    icon: <Sparkles size={18} />,
  },
  {
    id: "data",
    label: "Data",
    hint: "Backups and your account.",
    icon: <Database size={18} />,
  },
];

/** Section names in older links and bookmarks, and where they live now. */
const OLD_SECTIONS: Record<string, SectionId> = {
  language: "words",
  sync: "devices",
  account: "data",
  advanced: "data",
};

function sectionOf(v: string | undefined): SectionId | null {
  if (!v) return null;
  if (SECTIONS.some((s) => s.id === v)) return v as SectionId;
  return OLD_SECTIONS[v] ?? null;
}

/** Settings: a section list and the chosen section. */
export function SettingsScreen() {
  const { section: raw }: { section?: string } = useSearch({ from: "/settings" });
  const chosen = sectionOf(raw);
  // Wide screens always show a section; phones show the list until one is picked.
  const section = chosen ?? "words";
  const meta = SECTIONS.find((s) => s.id === section)!;
  // Native mode has no Anki connection: Move to Anki and deck files live in Your words.
  const native = useNativeMode();
  return (
    <div className="page page--list settings-page" data-picked={chosen ? "" : undefined}>
      <PageHeader
        title="Settings"
        lede="Everything stays on your device unless you choose otherwise. Changes save themselves."
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
          {section === "words" ? (
            <div className="stack settings-stack">
              {native ? null : <AnkiConnection />}
              <LanguageDecksSettings />
              <PracticeFeelSettings />
            </div>
          ) : section === "reading" ? (
            <ReadingSettings />
          ) : section === "ai" ? (
            <div className="stack settings-stack">
              <AISettings />
              <ClaudeCodeSettings />
            </div>
          ) : section === "devices" ? (
            <>
              <ConnectPhone />
              <SyncSettings />
            </>
          ) : (
            <DataSection />
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

/** Data: backups, then the account (on a server), then the technical details folded away. */
function DataSection() {
  const { account } = useAppInfo();
  return (
    <div className="stack settings-stack">
      <DataSettings />
      {account ? (
        <section className="stack" aria-labelledby="account-h">
          <h3 className="settings-h3" id="account-h">
            Account
          </h3>
          <AccountSettings />
        </section>
      ) : null}
      <FeedbackSettings />
      <details className="k-disclosure">
        <summary>
          <ChevronRight size={16} className="k-disclosure-icon" aria-hidden />
          Advanced
          <span className="k-disclosure-hint">Addresses, server status, install the app</span>
        </summary>
        <div className="k-disclosure-body">
          <AdvancedSettings />
        </div>
      </details>
    </div>
  );
}

const ENGLISH_LABEL: Record<ReaderPrefs["english"], string> = {
  always: "Under every sentence",
  hard: "Only under hard sentences",
  tap: "Only when I tap",
};

const NEW_WORD_OPTIONS = [
  { value: "auto", label: "Auto (adapts to how you read)" },
  ...[0, 1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: String(n) })),
];

function ReadingSettings() {
  const navigate = useNavigate();
  const { form, set, save } = useSettingsDraft();
  // Per device, shared with the reader's Aa menu.
  const [prefs, setPrefs] = useReaderPrefs();
  if (!form) return <Skeleton style={{ height: 160 }} />;
  return (
    <div className="stack settings-stack">
      <SavedNote status={save.status} error={save.error} />
      <div className="settings-field">
        <span className="k-label">The tour</span>
        <div className="row">
          <Button
            onClick={() => {
              startTour();
              void navigate({ to: "/" });
            }}
          >
            Show the tour again
          </Button>
        </div>
        <p className="k-hint">A short tour of the app.</p>
      </div>
      <div className="settings-field">
        <span className="k-label" id="help-dial">
          Help while reading
        </span>
        <Slider
          aria-label="Help while reading"
          value={Math.round(form.help * 100)}
          onValueChange={(v) => set({ help: v / 100 })}
        />
        <p className="k-hint">
          In Gloss: left shows English only for new words, right for most words.
        </p>
      </div>
      <div style={{ maxWidth: 320 }}>
        <Select
          label="New words to learn per page"
          value={String(form.newWords)}
          options={NEW_WORD_OPTIONS}
          onValueChange={(v) => set({ newWords: v === "auto" ? "auto" : Number(v) })}
        />
        <p className="k-hint">The words marked to learn on each page of a text.</p>
      </div>
      <div style={{ maxWidth: 320 }}>
        <Select
          label="English under sentences"
          value={prefs.english}
          options={ENGLISH_VISIBILITY.map((v) => ({ value: v, label: ENGLISH_LABEL[v] }))}
          onValueChange={(v) =>
            setPrefs({ english: ENGLISH_VISIBILITY.find((x) => x === v) ?? "hard" })
          }
        />
        <p className="k-hint">
          In Side by side: English only for sentences where you know less than 85% of the words.
        </p>
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={form.glossClozes}
          onChange={(e) => set({ glossClozes: e.target.checked })}
        />
        <span>
          Fill-in blanks while you read
          <small>In Gloss mode, a few known words become blanks for you to fill in.</small>
        </span>
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={prefs.clozeMeaning}
          onChange={(e) => setPrefs({ clozeMeaning: e.target.checked })}
        />
        <span>
          Show the meaning above blanks
          <small>In Cloze mode, the English of each missing word. Saved on this device.</small>
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
          <small>A thin line beside sentences with grammar worth noticing at your level.</small>
        </span>
      </label>
      <h3 className="settings-h3">Voice</h3>
      <p className="k-hint" style={{ margin: 0 }}>
        Choose the voice of the recordings. Words without a recording use your device&rsquo;s voice.
      </p>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 160 }}>
          <Select
            label="Recordings"
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
            options={AUDIO_RATES.map((r) => ({ value: String(r), label: `${r}×` }))}
            onValueChange={(v) => set({ audioRate: audioRateOf(v) })}
          />
        </div>
      </div>
      <VoiceTest rate={form.audioRate} />
      {/* The phone's downloads, together and easy to find (m5): the dictionary, then the recordings. */}
      <DictionaryPack />
      <RecordingsPack />
      <label className="settings-check">
        <input
          type="checkbox"
          checked={form.autoplayWord}
          onChange={(e) => set({ autoplayWord: e.target.checked })}
        />
        <span>
          Say the word when a card shows
          <small>
            Starter words have a recording; other words use your device&rsquo;s Dutch voice.
          </small>
        </span>
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={form.autoplaySentence}
          onChange={(e) => set({ autoplaySentence: e.target.checked })}
        />
        <span>
          Then say its sentence
          <small>
            After the word, with a short pause. Press R during review to hear the word again.
          </small>
        </span>
      </label>
    </div>
  );
}

/** How long the start took and the slowest calls (perf/speed.ts), to copy into feedback. */
function SpeedReport() {
  const [text, setText] = useState<string | null>(null);
  const toast = useToast();
  return (
    <section className="stack" style={{ gap: 6 }}>
      <span className="k-label">Speed report</span>
      <p className="k-hint" style={{ margin: 0 }}>
        How long the start took and which steps are slow, on this device. Nothing is sent.
      </p>
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" onClick={() => setText(speedReport())}>
          {text ? "Refresh" : "Show"}
        </Button>
        {text ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard
                .writeText(text)
                .then(() => toast("Copied"))
                .catch(() => toast("Could not copy", "Select the text and copy it."))
            }
          >
            Copy
          </Button>
        ) : null}
      </div>
      {text ? (
        <pre style={{ fontSize: 12, overflowX: "auto", whiteSpace: "pre", margin: 0 }}>{text}</pre>
      ) : null}
    </section>
  );
}

function AdvancedSettings() {
  const { form, set, setDraft, save } = useSettingsDraft();
  if (!form) return <Skeleton style={{ height: 160 }} />;
  return (
    <div className="stack settings-stack">
      <SavedNote status={save.status} error={save.error} />
      <SpeedReport />
      <Input
        label="Language server address"
        value={form.nlpUrl}
        hint="The server that reads Dutch grammar and looks up words. Change it only if you run your own."
        onChange={(e) => set({ nlpUrl: e.target.value })}
      />
      <Input
        label="AnkiConnect address"
        value={form.ankiUrl}
        hint="Where Anki listens on this computer (the AnkiConnect add-on)."
        onChange={(e) => set({ ankiUrl: e.target.value })}
      />
      <Input
        label="AnkiConnect key"
        type="password"
        value={form.ankiKey ?? ""}
        hint="Only if you set a key in the AnkiConnect add-on."
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
      <UpdateSetting />
      <InstallApp />
    </div>
  );
}
