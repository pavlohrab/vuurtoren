/**
 * Pieces shared by onboarding and Settings → Language & decks: the language choice, the list of
 * decks Kenning reads, and where new words go.
 */
import {
  type CourseDeckMode,
  type LanguageProfile,
  type ProfileDestinations,
  type ProfileSource,
  PROFILE_LANGUAGES,
  defaultProfile,
  rootDeck,
} from "@app/core";
import { Input } from "@app/ui";
import type { DeckSuggestion } from "../../services/profileTypes.js";
import "./onboarding.css";

/** Dutch, with the languages that are coming shown disabled. */
export function LanguageChoice({
  value,
  onChange,
}: {
  value: string;
  onChange: (lang: string) => void;
}) {
  return (
    <fieldset className="ob-choices">
      <legend className="k-label">Language you are learning</legend>
      {PROFILE_LANGUAGES.map((l) => (
        <label key={l.code} className="ob-choice" data-disabled={!l.enabled || undefined}>
          <input
            type="radio"
            name="lang"
            value={l.code}
            checked={value === l.code}
            disabled={!l.enabled}
            onChange={() => onChange(l.code)}
          />
          <span>
            <span className="ob-choice-title" lang={l.code}>
              {l.name}
            </span>
            <span className="ob-choice-sub">
              {l.english}
              {l.enabled ? "" : " · coming"}
            </span>
          </span>
        </label>
      ))}
      <p className="ob-choice-sub">More languages coming soon.</p>
    </fieldset>
  );
}

/** One row of the deck list: a detected deck, or a confirmed one detection has not seen. */
interface DeckRow {
  deck: string;
  modelName?: string;
  noteCount?: number;
  examples: string[];
  suggested: boolean;
  source: ProfileSource;
}

/** Rows for the checklist: detected decks first (suggested ones first), then confirmed others. */
export function deckRows(suggestions: DeckSuggestion[], confirmed: ProfileSource[]): DeckRow[] {
  const rows: DeckRow[] = [...suggestions]
    .sort((a, b) => Number(b.suggested) - Number(a.suggested) || b.noteCount - a.noteCount)
    .map((s) => ({
      deck: s.deck,
      modelName: s.modelName,
      noteCount: s.noteCount,
      examples: s.examples,
      suggested: s.suggested,
      source: {
        deck: s.deck,
        modelName: s.modelName,
        wordField: s.wordField,
        ...(s.sentenceField ? { sentenceField: s.sentenceField } : {}),
        ...(s.glossField ? { glossField: s.glossField } : {}),
      },
    }));
  for (const c of confirmed) {
    if (rows.some((r) => r.deck === c.deck && (!c.modelName || r.modelName === c.modelName)))
      continue;
    rows.push({
      deck: c.deck,
      ...(c.modelName ? { modelName: c.modelName } : {}),
      examples: [],
      suggested: false,
      source: c,
    });
  }
  return rows;
}

const rowKey = (r: { deck: string; modelName?: string | undefined }) =>
  `${r.deck}\u0000${r.modelName ?? ""}`;

/** True if `row` is among the confirmed sources (a deck-only source matches every note type). */
function isChosen(row: DeckRow, chosen: ProfileSource[]): boolean {
  return chosen.some((c) => c.deck === row.deck && (!c.modelName || c.modelName === row.modelName));
}

/** Checkbox list of decks with note counts and a three-word preview. */
export function DeckChecklist({
  rows,
  chosen,
  onChange,
}: {
  rows: DeckRow[];
  chosen: ProfileSource[];
  onChange: (sources: ProfileSource[]) => void;
}) {
  const toggle = (row: DeckRow, on: boolean) => {
    const rest = chosen.filter(
      (c) => !(c.deck === row.deck && (!c.modelName || c.modelName === row.modelName)),
    );
    onChange(on ? [...rest, row.source] : rest);
  };
  return (
    <ul className="ob-decks" aria-label="Anki decks">
      {rows.map((r) => (
        <li key={rowKey(r)}>
          <label className="ob-deck">
            <input
              type="checkbox"
              checked={isChosen(r, chosen)}
              onChange={(e) => toggle(r, e.target.checked)}
            />
            <span className="ob-deck-body">
              <span className="ob-deck-name">{r.deck}</span>
              <span className="ob-deck-meta">
                {r.noteCount !== undefined
                  ? `${r.noteCount.toLocaleString("en")} notes`
                  : "Not checked yet"}
                {r.modelName ? ` · ${r.modelName}` : ""}
                {r.source.wordField ? ` · word field “${r.source.wordField}”` : ""}
                {r.suggested ? " · looks like Dutch vocabulary" : ""}
              </span>
              {r.examples.length ? (
                <span className="ob-deck-examples" lang="nl">
                  {r.examples.join(" · ")}
                </span>
              ) : null}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

const COURSE_MODES: { value: CourseDeckMode; label: string }[] = [
  { value: "unit", label: "One subdeck per unit" },
  { value: "course", label: "One deck per course" },
  { value: "default", label: "The default deck" },
];

const DEST_FIELDS: { key: Exclude<keyof ProfileDestinations, "default">; label: string }[] = [
  { key: "reading", label: "Reader and Words from this text" },
  { key: "converse", label: "Talk" },
  { key: "ai", label: "AI stories" },
  { key: "mcp", label: "Claude (MCP)" },
];

/** Default deck, per-source decks and the course rule. */
export function DestinationFields({
  profile,
  onChange,
  compact = false,
}: {
  profile: LanguageProfile;
  onChange: (p: LanguageProfile) => void;
  /** Onboarding: one switch for "subdecks per source" instead of every field. */
  compact?: boolean;
}) {
  const d = profile.destinations;
  const setDest = (patch: Partial<ProfileDestinations>) => {
    const next: ProfileDestinations = { ...d, ...patch };
    for (const k of Object.keys(next) as (keyof ProfileDestinations)[]) {
      if (k !== "default" && !next[k]?.trim()) delete next[k];
    }
    onChange({ ...profile, destinations: next });
  };
  const split = !!(d.reading || d.converse || d.ai);
  const root = rootDeck(profile.lang);
  const example = `${root}::<Course>${profile.courseDecks === "unit" ? "::<Unit>" : ""}`;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <Input
        label="Default deck"
        value={d.default}
        hint={`Anything without its own deck goes here. ${
          profile.mode === "native" ? "The deck is made" : "Anki creates it"
        } with the first word.`}
        onChange={(e) => setDest({ default: e.target.value })}
      />
      {compact ? (
        <label className="ob-check">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => {
              const fresh = defaultProfile(profile.lang).destinations;
              onChange({
                ...profile,
                destinations: e.target.checked
                  ? { ...fresh, default: d.default }
                  : { default: d.default },
              });
            }}
          />
          <span>
            Separate subdecks for reading, Talk and AI stories
            <span className="ob-choice-sub">
              {split
                ? [d.reading, d.converse, d.ai].filter(Boolean).join(", ")
                : "Everything goes to the default deck"}
            </span>
          </span>
        </label>
      ) : (
        DEST_FIELDS.map((f) => (
          <Input
            key={f.key}
            label={f.label}
            value={d[f.key] ?? ""}
            placeholder={d.default}
            onChange={(e) => setDest({ [f.key]: e.target.value })}
          />
        ))
      )}
      <fieldset className="ob-choices ob-choices--row">
        <legend className="k-label">Words from a course go to</legend>
        {COURSE_MODES.map((m) => (
          <label key={m.value} className="ob-choice">
            <input
              type="radio"
              name="courseDecks"
              checked={profile.courseDecks === m.value}
              onChange={() => onChange({ ...profile, courseDecks: m.value })}
            />
            <span className="ob-choice-title">{m.label}</span>
          </label>
        ))}
        <span className="ob-choice-sub">
          {profile.courseDecks === "default" ? d.default : example}
        </span>
      </fieldset>
    </div>
  );
}
