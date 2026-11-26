import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Popover, Select, Slider } from "@app/ui";
import {
  ENGLISH_VISIBILITY,
  LEADINGS,
  READING_THEMES,
  type ReaderPrefs,
  TEXT_SIZES,
  WIDTHS,
} from "./readerPrefs.js";

const FONT_LABEL: Record<ReaderPrefs["font"], string> = {
  literata: "Literata",
  inter: "Inter",
  atkinson: "Atkinson",
};
const THEME_LABEL: Record<ReaderPrefs["theme"], string> = {
  app: "App",
  paper: "Paper",
  sepia: "Sepia",
  night: "Night",
};
const LEADING_LABEL: Record<ReaderPrefs["leading"], string> = {
  compact: "Compact",
  normal: "Normal",
  relaxed: "Relaxed",
};
const ENGLISH_LABEL: Record<ReaderPrefs["english"], string> = {
  always: "Always",
  hard: "Hard sentences",
  tap: "Tap to show",
};
const WIDTH_LABEL: Record<ReaderPrefs["width"], string> = {
  narrow: "Narrow",
  normal: "Normal",
  wide: "Wide",
};

/** One row of mutually exclusive choices (radio semantics, segmented look). */
function Choice<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
  swatch,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
  swatch?: boolean;
}) {
  return (
    <div className="aa-row" role="radiogroup" aria-label={label}>
      <span className="aa-label">{label}</span>
      <div className="aa-seg">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            className="aa-opt"
            {...(swatch ? { "data-swatch": o } : {})}
            {...(label === "Font" ? { "data-font": o } : {})}
            onClick={() => onChange(o)}
          >
            {labels[o]}
          </button>
        ))}
      </div>
    </div>
  );
}

const NEW_WORD_OPTIONS = [
  { value: "auto", label: "Auto" },
  ...[0, 1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: String(n) })),
];

/** An on/off setting: a label and a quiet toggle chip. */
function Toggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="aa-line">
      <span className="aa-line-text">
        <span className="aa-label">{label}</span>
        {hint ? <span className="aa-line-hint">{hint}</span> : null}
      </span>
      <button
        type="button"
        className="k-toggle k-toggle--sm"
        aria-pressed={on}
        aria-label={label}
        onClick={onToggle}
      >
        {on ? <Check size={14} aria-hidden /> : null}
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

/** What the reading-help half of the popover offers in the current mode. */
export interface ModeSettings {
  mode: "read" | "cloze" | "gloss" | "side";
  /** Gloss: the translations dial (0–100) and its current label. */
  help?: {
    value: number;
    label: string;
    onChange: (v: number) => void;
    onCommit: (v: number) => void;
  };
  /** Gloss: also show blanks (only offered when the page has some). */
  blanks?: { on: boolean; onToggle: () => void };
  newWords: { value: string; onChange: (v: string) => void };
  marks: { on: boolean; onToggle: () => void };
  /** Side by side: an AI provider is set up, so its English can be chosen. */
  aiReady?: boolean;
}

const MODE_TITLE: Record<ModeSettings["mode"], string> = {
  read: "Read mode",
  cloze: "Cloze mode",
  gloss: "Gloss mode",
  side: "Side by side",
};

/**
 * The reader's "Aa" popover: the current mode's reading help (translations, blanks, hints, the
 * word budget, grammar marks), then the reading comforts (size, spacing, width, font, theme).
 */
export function ReadingSettings({
  prefs,
  onChange,
  settings,
}: {
  prefs: ReaderPrefs;
  onChange: (patch: Partial<ReaderPrefs>) => void;
  settings: ModeSettings;
}) {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  const section = (title: string, children: ReactNode) => (
    <section className="aa-section" aria-label={title}>
      <h2 className="aa-heading">{title}</h2>
      {children}
    </section>
  );
  return (
    <Popover
      label="Reading settings"
      className="aa-pop"
      align="end"
      trigger={
        <button
          type="button"
          className="rbar-btn"
          aria-label="Reading settings"
          title="Reading settings"
        >
          <span className="aa-glyph" aria-hidden>
            Aa
          </span>
        </button>
      }
    >
      {section(
        MODE_TITLE[settings.mode],
        <>
          {settings.help ? (
            <div className="aa-row">
              <span className="aa-line">
                <span className="aa-label">Translations</span>
                <span className="aa-line-hint">{settings.help.label}</span>
              </span>
              <Slider
                aria-label="Translations"
                value={settings.help.value}
                onValueChange={settings.help.onChange}
                onValueCommit={settings.help.onCommit}
              />
              <span className="aa-ends" aria-hidden>
                <span>Fewer</span>
                <span>More</span>
              </span>
            </div>
          ) : null}
          {settings.blanks ? (
            <Toggle label="Blanks" on={settings.blanks.on} onToggle={settings.blanks.onToggle} />
          ) : null}
          {settings.mode === "side" ? (
            <>
              <Choice
                label="English"
                value={prefs.english}
                options={ENGLISH_VISIBILITY}
                labels={ENGLISH_LABEL}
                onChange={(english) => onChange({ english })}
              />

              {settings.aiReady ? (
                <Toggle
                  label="English from AI"

                  on={prefs.englishAI}
                  onToggle={() => onChange({ englishAI: !prefs.englishAI })}
                />
              ) : null}
            </>
          ) : null}
          {settings.mode === "cloze" ? (
            <Toggle
              label="Meaning above blanks"
              hint="Press ? in a blank to see its first letter."
              on={prefs.clozeMeaning}
              onToggle={() => onChange({ clozeMeaning: !prefs.clozeMeaning })}
            />
          ) : null}
          <div className="aa-select">
            <Select
              label="Words to learn per page"
              value={settings.newWords.value}
              onValueChange={settings.newWords.onChange}
              options={NEW_WORD_OPTIONS}
            />
          </div>
          <Toggle
            label="Grammar marks"

            on={settings.marks.on}
            onToggle={settings.marks.onToggle}
          />
        </>,
      )}
      {section(
        "Text",
        <>
          <div className="aa-row">
            <span className="aa-label">Text size</span>
            <div className="aa-size">
              <button
                type="button"
                className="aa-opt"
                aria-label="Smaller text"
                disabled={prefs.size <= 0}
                onClick={() => onChange({ size: prefs.size - 1 })}
              >
                A−
              </button>
              <span
                className="aa-size-dots"
                role="status"
                aria-label={`Size ${prefs.size + 1} of 5`}
              >
                {TEXT_SIZES.map((_, k) => (
                  <span key={k} data-on={k <= prefs.size} />
                ))}
              </span>
              <button
                type="button"
                className="aa-opt"
                aria-label="Larger text"
                disabled={prefs.size >= TEXT_SIZES.length - 1}
                onClick={() => onChange({ size: prefs.size + 1 })}
              >
                A+
              </button>
            </div>
          </div>
          <Choice
            label="Line spacing"
            value={prefs.leading}
            options={Object.keys(LEADINGS) as ReaderPrefs["leading"][]}
            labels={LEADING_LABEL}
            onChange={(leading) => onChange({ leading })}
          />
          <Choice
            label="Line width"
            value={prefs.width}
            options={Object.keys(WIDTHS) as ReaderPrefs["width"][]}
            labels={WIDTH_LABEL}
            onChange={(width) => onChange({ width })}
          />
          <Choice
            label="Font"
            value={prefs.font}
            options={["literata", "inter", "atkinson"] as const}
            labels={FONT_LABEL}
            onChange={(font) => onChange({ font })}
          />
          <Choice
            label="Theme"
            value={prefs.theme}
            options={READING_THEMES}
            labels={THEME_LABEL}
            onChange={(theme) => onChange({ theme })}
            swatch
          />
          <p className="aa-hint">
            {mod} + / − changes the size while reading. Saved on this device.
          </p>
        </>,
      )}
    </Popover>
  );
}
