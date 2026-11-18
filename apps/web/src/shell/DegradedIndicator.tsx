import { CloudOff } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button, Popover } from "@app/ui";
import {
  type DegradedEntry,
  degradedEntries,
  retryDegraded,
  subscribeDegraded,
} from "../services/degraded.js";

const SOURCE_LABEL: Record<DegradedEntry["source"], string> = {
  nlp: "Language server",
  translate: "Translation",
  anki: "Anki",
  ai: "AI provider",
  storage: "Kenning server",
};

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** The shared degraded signal (review A17): a quiet top-bar button with a details popover. */
export function DegradedIndicator() {
  const entries = useSyncExternalStore(subscribeDegraded, degradedEntries, degradedEntries);
  const first = entries[0];
  if (!first) return null;
  const label = entries.length > 1 ? `${first.message} (+${entries.length - 1})` : first.message;
  return (
    <Popover
      label="Limited features"
      className="degraded-pop"
      align="end"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="topbar-degraded"
          aria-label={`Some features limited: ${label}. Details`}
        >
          <CloudOff size={14} />
          <span className="topbar-degraded-text">{label}</span>
        </Button>
      }
    >
      <ul className="degraded-list">
        {entries.map((e) => (
          <li key={e.source}>
            <strong>{SOURCE_LABEL[e.source]}</strong>
            <span>{e.message}</span>
            <span className="degraded-meta">
              since {time(e.since)}
              {e.detail ? ` · ${e.detail}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" onClick={retryDegraded}>
        Retry
      </Button>
    </Popover>
  );
}
