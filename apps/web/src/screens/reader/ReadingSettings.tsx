import { Popover } from "@app/ui";
import { LEADINGS, READING_THEMES, type ReaderPrefs, TEXT_SIZES, WIDTHS } from "./readerPrefs.js";

const FONT_LABEL: Record<ReaderPrefs["font"], string> = {
  literata: "Literata",
  inter: "Inter",
  atkinson: "Atkinson",
};
const THEME_LABEL: Record<ReaderPrefs["theme"], string> = {
  app: "Match app",
  paper: "Paper",
  sepia: "Sepia",
  night: "Night",
};
const LEADING_LABEL: Record<ReaderPrefs["leading"], string> = {
  compact: "Compact",
  normal: "Normal",
  relaxed: "Relaxed",
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

/** The reader's "Aa" popover: size, spacing, width, font and reading theme, per device. */
export function ReadingSettings({
  prefs,
  onChange,
}: {
  prefs: ReaderPrefs;
  onChange: (patch: Partial<ReaderPrefs>) => void;
}) {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  return (
    <Popover
      label="Reading settings"
      className="aa-pop"
      align="end"
      trigger={
        <button type="button" className="reader-chip" aria-label="Reading settings">
          <span className="aa-glyph" aria-hidden>
            Aa
          </span>
        </button>
      }
    >
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
          <span className="aa-size-dots" role="status" aria-label={`Size ${prefs.size + 1} of 5`}>
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
        {mod} + / − changes the size while reading · F for focus mode. Saved on this device.
      </p>
    </Popover>
  );
}
