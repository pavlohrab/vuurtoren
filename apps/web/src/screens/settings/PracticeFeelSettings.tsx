/**
 * Settings → Your words → Practice: how Practice reacts (mock-practice-polish.html). All on by
 * default except the buzz; remembered on this device.
 */
import { useState } from "react";
import { type PracticeFeel, play, readFeel, writeFeel } from "../../practice/feel.js";

const ROWS: { key: keyof PracticeFeel; label: string; hint: string }[] = [
  {
    key: "sayDutch",
    label: "Say Dutch words and sentences by themselves",
    hint: "You hear the Dutch without pressing the speaker.",
  },
  {
    key: "sounds",
    label: "Sounds",
    hint: "Short, quiet sounds when you answer.",
  },
  {
    key: "movement",
    label: "Movement",
    hint: "Tiles fly and a wrong answer shakes.",
  },
  {
    key: "sayOnCard",
    label: "Say the word when a word card opens",
    hint: "In the reader's word card and in Words.",
  },
  { key: "vibrate", label: "Buzz on a miss", hint: "On a phone." },
];

export function PracticeFeelSettings({ title = "Practice" }: { title?: string }) {
  const [feel, setFeel] = useState(readFeel);
  const set = (key: keyof PracticeFeel, on: boolean) => {
    const next = { ...feel, [key]: on };
    setFeel(next);
    writeFeel(next);
    if (key === "sounds" && on) play("right", next);
  };
  return (
    <section className="stack" aria-labelledby="practice-feel-h" style={{ gap: 10 }}>
      <h3 className="settings-h3" id="practice-feel-h">
        {title}
      </h3>
      {ROWS.map((r) => (
        <label key={r.key} className="feel-row">
          <input
            type="checkbox"
            checked={feel[r.key]}
            onChange={(e) => set(r.key, e.target.checked)}
          />
          <span>
            {r.label}
            <small className="k-hint">{r.hint}</small>
          </span>
        </label>
      ))}
    </section>
  );
}
