/**
 * The reading mode on a phone: one button in the reader bar ("Read ▾") opens the four modes as
 * large choices, each with one line on what it does. Wider screens keep the segmented control.
 */
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Popover } from "@app/ui";

export interface ModeOption {
  value: string;
  label: string;
}

const DESCRIPTION: Record<string, string> = {
  read: "The text, with the words worth learning marked.",
  cloze: "Fill in the words you are learning.",
  gloss: "English above the words you may not know.",
  side: "Dutch and English, sentence by sentence.",
};

export function ModeMenu({
  modes,
  value,
  onChange,
}: {
  modes: readonly ModeOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = modes.find((m) => m.value === value) ?? modes[0]!;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      label="Reading mode"
      className="mode-pop"
      trigger={
        <button type="button" className="rbar-mode" aria-label={`Reading mode: ${current.label}`}>
          {current.label}
          <ChevronDown size={14} aria-hidden />
        </button>
      }
    >
      <div role="radiogroup" aria-label="Reading mode" className="mode-list">
        {modes.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={m.value === value}
            className="mode-opt"
            onClick={() => {
              onChange(m.value);
              setOpen(false);
            }}
          >
            <span className="mode-opt-title">{m.label}</span>
            <span className="mode-opt-sub">{DESCRIPTION[m.value]}</span>
            {m.value === value ? <Check size={16} className="mode-opt-check" aria-hidden /> : null}
          </button>
        ))}
      </div>
    </Popover>
  );
}
