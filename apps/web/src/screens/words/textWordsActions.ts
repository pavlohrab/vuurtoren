/**
 * Pure logic of the "Words from this text" review: which action each Anki state starts with,
 * which others it offers, and how a batch of actions is run and summarised.
 */
import { deckName } from "@app/ui";
import { plural } from "../../format.js";
import type { AppServices, InspectorEntry, TextWordItem } from "../../services/types.js";

export type WordAction = "add" | "learn" | "known" | "skip";
export type AnkiStatus = InspectorEntry["anki"]["status"];
type Writes = Pick<AppServices, "addToAnki" | "learnNext" | "markKnown">;

/** What happened to one row when the batch ran. */
export interface RowResult {
  ok: boolean;
  /** Shown on the row: what was done, or the real error message. */
  message: string;
  /** Which kind of success, for the summary. */
  kind?: "added" | "moved" | "known";
  /** Deck involved, for the summary. */
  deck?: string;
}

/** Tooltip for "Study first" (the service calls it `learnNext`). */
export const STUDY_FIRST_HINT = "Moves the new card to the front of the queue, so it comes next.";

/**
 * The action a row starts with, by the word's card state. A word that was only translated (a
 * rare word, not highlighted or looked up) starts as Skip.
 */
export function defaultAction(status: AnkiStatus, source?: TextWordItem["source"]): WordAction {
  if (status === "absent") return source === "gloss" ? "skip" : "add";
  if (status === "new" || status === "suspended") return "learn";
  return "skip";
}

const LABEL: Record<WordAction, string> = {
  add: "Add to Anki",
  learn: "Study first in Anki",
  known: "I know it",
  skip: "Skip",
};

const NATIVE_LABEL: Record<WordAction, string> = {
  ...LABEL,
  add: "Add to my words",
  learn: "Study first",
};

/** Actions offered for a state, the default first. Every row can be marked known or skipped. */
export function actionOptions(
  status: AnkiStatus,
  source?: TextWordItem["source"],
  native = false,
): { value: WordAction; label: string }[] {
  const first = defaultAction(status, source);
  const order: WordAction[] =
    first === "skip"
      ? status === "absent"
        ? ["skip", "add", "known"]
        : ["skip", "known"]
      : [first, "known", "skip"];
  const labels = native ? NATIVE_LABEL : LABEL;
  return order.map((value) => ({
    value,
    label: value === "learn" && status === "suspended" ? "Unsuspend & study first" : labels[value],
  }));
}

export interface Job {
  item: TextWordItem;
  action: Exclude<WordAction, "skip">;
}

const messageOf = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : "Something went wrong";

/** Run one action through the services; never throws, a failure becomes a failed result. */
async function runOne(services: Writes, { item, action }: Job): Promise<RowResult> {
  try {
    if (action === "add") {
      const { deck } = await services.addToAnki(item.entry);
      return { ok: true, kind: "added", deck, message: `Added to ${deckName(deck)}` };
    }
    if (action === "learn") {
      const { deck } = await services.learnNext(item.entry);
      return {
        ok: true,
        kind: "moved",
        deck,
        message: "Moved to the front",
      };
    }
    const { addedToDeck } = await services.markKnown(item.entry);
    return {
      ok: true,
      kind: "known",
      message: addedToDeck ? `Added to ${deckName(addedToDeck)} as known` : "Marked known",
    };
  } catch (e) {
    return { ok: false, message: messageOf(e) };
  }
}

/**
 * Run the jobs one after another. A failure is recorded and the batch goes on.
 * `onProgress` is called before each job, `onResult` after it.
 */
export async function applyActions(
  jobs: Job[],
  services: Writes,
  hooks: {
    onProgress?: (done: number, total: number, item: TextWordItem) => void;
    onResult?: (key: string, result: RowResult) => void;
  } = {},
): Promise<Map<string, RowResult>> {
  const results = new Map<string, RowResult>();
  for (const [n, job] of jobs.entries()) {
    hooks.onProgress?.(n, jobs.length, job.item);
    const result = await runOne(services, job);
    results.set(job.item.key, result);
    hooks.onResult?.(job.item.key, result);
  }
  return results;
}

/** A quiet summary, e.g. "5 added to Reading, 2 moved to the front of their decks." */
export function summarize(results: Iterable<RowResult>): string {
  const all = [...results];
  const ok = (kind: RowResult["kind"]) => all.filter((r) => r.ok && r.kind === kind);
  const added = ok("added");
  const moved = ok("moved");
  const known = ok("known");
  const failed = all.filter((r) => !r.ok).length;
  const parts: string[] = [];
  if (added.length) {
    const decks = [...new Set(added.flatMap((r) => (r.deck ? [deckName(r.deck)] : [])))];
    parts.push(`${added.length} added${decks.length ? ` to ${decks.join(" and ")}` : ""}`);
  }
  if (moved.length) {
    parts.push(
      `${moved.length} moved to the front of ${moved.length === 1 ? "its deck" : "their decks"}`,
    );
  }
  if (known.length) parts.push(`${known.length} marked known`);
  const done = parts.length ? `${parts.join(", ")}.` : "";
  const bad = failed ? `${plural(failed, "word")} could not be updated.` : "";
  return [done, bad].filter(Boolean).join(" ") || "Nothing was changed.";
}
