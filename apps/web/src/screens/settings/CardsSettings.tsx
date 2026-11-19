/**
 * Settings → Language & decks, the cards part. Connected mode: one action, "Move from Anki to
 * Kenning". Native mode: what Kenning holds, importing a deck file, each deck's target retention
 * and limits, and FSRS tuning ("Optimise now").
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useState } from "react";
import { DEFAULT_DECK_OPTIONS, type DeckOptions } from "@app/core";
import { Button, Select, Skeleton, Spinner, useToast } from "@app/ui";
import { plural, relativeTime } from "../../format.js";
import { useServices } from "../../services/context.js";
import { saveFile } from "../../saveFile.js";
import type { ImportSummary, NativeDeckSummary } from "../../services/nativeTypes.js";

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");
/** Queries that change when cards come in or the mode changes. */
const AFFECTED = ["languageProfile", "learner", "review", "words", "texts", "home"];

function summaryText(s: ImportSummary): string {
  const parts = [
    `${plural(s.cards, "card")} from ${plural(s.notes, "note")}`,
    `${plural(s.reviews, "past review")}`,
  ];
  if (s.media) parts.push(`${plural(s.media, "media file")}`);
  let text = `Imported ${parts.join(", ")}. ${plural(s.vocabNotes, "note")} feed your word list.`;
  if (s.skippedMedia) text += ` ${plural(s.skippedMedia, "media file")} could not be kept.`;
  return text;
}

export function CardsSettings({ native }: { native: boolean }) {
  return native ? <NativeCards /> : <MoveFromAnki />;
}

function MoveFromAnki() {
  const services = useServices();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  const move = useMutation({
    mutationFn: () => services.moveFromAnki(setProgress),
    onSuccess: async (summary) => {
      // This part of Settings is replaced by the native one: the result goes to a toast.
      toast("Your reviews now happen in Kenning", summaryText(summary));
      for (const k of AFFECTED) await qc.invalidateQueries({ queryKey: [k] });
    },
  });
  return (
    <section className="stack" aria-labelledby="cards-h">
      <h3 className="settings-h3" id="cards-h">
        Reviews
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        Anki is the record of the words you know and runs your reviews. You can bring your decks
        into Kenning instead: the decks below are imported once, with every card and its review
        history, and from then on Kenning schedules your reviews. Anki is not changed.
      </p>
      {move.isSuccess ? (
        <p role="status" style={{ margin: 0 }}>
          {summaryText(move.data)} Your reviews now happen in Kenning.
        </p>
      ) : confirm ? (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>
            Import the decks Kenning reads from Anki and review in Kenning from now on? Keep Anki
            open while it runs.
          </p>
          <div className="row">
            <Button variant="primary" disabled={move.isPending} onClick={() => move.mutate()}>
              {move.isPending ? <Spinner label="Importing" /> : null}
              Move to Kenning
            </Button>
            <Button variant="ghost" disabled={move.isPending} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
          {move.isPending && progress ? (
            <p className="k-hint" role="status" style={{ margin: 0 }}>
              {progress}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="row">
          <Button onClick={() => setConfirm(true)}>Move from Anki to Kenning</Button>
        </div>
      )}
      {move.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          The move did not finish. {message(move.error)}
        </p>
      ) : null}
    </section>
  );
}

function NativeCards() {
  const services = useServices();
  const decks = useQuery({ queryKey: ["review", "decks"], queryFn: () => services.nativeDecks() });
  return (
    <>
      <section className="stack" aria-labelledby="cards-h">
        <h3 className="settings-h3" id="cards-h">
          Your cards
        </h3>
        <p className="k-hint" style={{ margin: 0 }}>
          Kenning keeps your words and schedules your reviews with FSRS.
        </p>
        {decks.data ? (
          decks.data.length ? (
            <DeckTable decks={decks.data} />
          ) : (
            <p style={{ margin: 0 }}>No cards yet. Add words while you read, or import a deck.</p>
          )
        ) : (
          <Skeleton style={{ height: 80 }} />
        )}
      </section>
      <ImportPackage />
      {decks.data?.length ? <ExportPackage decks={decks.data.map((d) => d.name)} /> : null}
      <Tuning />
    </>
  );
}

const RETENTIONS = [0.8, 0.85, 0.87, 0.9, 0.92, 0.95, 0.97];

function DeckTable({ decks }: { decks: NativeDeckSummary[] }) {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: ({ deck, options }: { deck: string; options: DeckOptions }) =>
      services.setDeckOptions(deck, options),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["review"] });
      toast("Saved");
    },
  });
  const set = (d: NativeDeckSummary, patch: Partial<DeckOptions>) =>
    save.mutate({ deck: d.name, options: { ...DEFAULT_DECK_OPTIONS, ...d.options, ...patch } });
  return (
    <div className="cards-table-wrap">
      <table className="cards-table" aria-label="Decks">
        <thead>
          <tr>
            <th scope="col">Deck</th>
            <th scope="col">Cards</th>
            <th scope="col">Target recall</th>
            <th scope="col">New a day</th>
          </tr>
        </thead>
        <tbody>
          {decks.map((d) => (
            <tr key={d.name}>
              <th scope="row" title={d.name}>
                {d.name}
              </th>
              <td>
                {d.total}
                {d.due ? <span className="k-hint"> · {d.due} due</span> : null}
              </td>
              <td>
                <select
                  className="k-input"
                  aria-label={`Target recall for ${d.name}`}
                  value={String(d.options.desiredRetention)}
                  onChange={(e) => set(d, { desiredRetention: Number(e.target.value) })}
                >
                  {[...new Set([...RETENTIONS, d.options.desiredRetention])].sort().map((r) => (
                    <option key={r} value={String(r)}>
                      {Math.round(r * 100)}%
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className="k-input"
                  type="number"
                  min={0}
                  max={999}
                  aria-label={`New cards a day for ${d.name}`}
                  defaultValue={d.options.newPerDay}
                  onBlur={(e) => {
                    const n = Math.max(0, Math.round(Number(e.target.value)));
                    if (Number.isFinite(n) && n !== d.options.newPerDay) set(d, { newPerDay: n });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="k-hint" style={{ margin: 0 }}>
        Target recall is how likely you are to remember a card when it comes back. Higher means more
        reviews a day.
      </p>
    </div>
  );
}

/** Export to .apkg: some decks or all of them, with history, for Anki or a backup. */
function ExportPackage({ decks }: { decks: string[] }) {
  const services = useServices();
  // Only top-level choices: a deck brings its subdecks.
  const tops = [...new Set(decks.map((d) => d.split("::")[0]!))];
  const [deck, setDeck] = useState("");
  const run = useMutation({
    mutationFn: () => services.exportPackage(deck ? [deck] : []),
    onSuccess: (r) => saveFile(r.bytes, r.fileName, "application/octet-stream"),
  });
  return (
    <section className="stack" aria-labelledby="export-deck-h">
      <h3 className="settings-h3" id="export-deck-h">
        Export to a deck file
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        An Anki deck file (.apkg) with your notes, cards, their schedule and memory, deck options,
        review history, images and sounds. Import it in Anki with File › Import.
      </p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        {tops.length > 1 ? (
          <Select
            label="Decks"
            value={deck || "all"}
            onValueChange={(v) => setDeck(v === "all" ? "" : v)}
            options={[
              { value: "all", label: "All decks" },
              ...tops.map((d) => ({ value: d, label: d })),
            ]}
          />
        ) : null}
        <Button disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? <Spinner label="Exporting" /> : null}
          Export to .apkg
        </Button>
      </div>
      {run.isSuccess ? (
        <p role="status" style={{ margin: 0 }}>
          Exported {plural(run.data.summary.notes, "note")},{" "}
          {plural(run.data.summary.cards, "card")} and {plural(run.data.summary.reviews, "review")}{" "}
          to {run.data.fileName}.
        </p>
      ) : null}
      {run.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          The export did not finish. {message(run.error)}
        </p>
      ) : null}
    </section>
  );
}

function ImportPackage() {
  const services = useServices();
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: (file: File) => services.openPackage(file),
    onSuccess: (r) => setChosen(new Set(r.decks.map((d) => d.name))),
  });
  const run = useMutation({
    mutationFn: () => services.importPackage(open.data!.token, [...chosen], setProgress),
    onSuccess: async () => {
      for (const k of AFFECTED) await qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    run.reset();
    if (f) open.mutate(f);
  };
  return (
    <section className="stack" aria-labelledby="import-deck-h">
      <h3 className="settings-h3" id="import-deck-h">
        Import a deck file
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        An Anki deck (.apkg) or collection (.colpkg): notes, cards, review history, images and
        sounds. Cards you already have are kept as they are.
      </p>
      <label className="k-btn k-btn--secondary cards-file">
        Choose a file
        <input type="file" accept=".apkg,.colpkg" onChange={onFile} className="k-sr" />
      </label>
      {open.isPending ? (
        <p role="status" style={{ margin: 0 }}>
          <Spinner label="Opening" /> Opening the file
        </p>
      ) : open.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {message(open.error)}
        </p>
      ) : open.data && !run.isSuccess ? (
        <fieldset className="stack cards-decks" style={{ gap: 6 }}>
          <legend className="k-label">Decks to import</legend>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={chosen.size === open.data.decks.length}
              onChange={(e) =>
                setChosen(new Set(e.target.checked ? open.data!.decks.map((d) => d.name) : []))
              }
            />
            <span>All decks</span>
          </label>
          {open.data.decks.map((d) => (
            <label key={d.name} className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={chosen.has(d.name)}
                onChange={(e) =>
                  setChosen((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(d.name);
                    else n.delete(d.name);
                    return n;
                  })
                }
              />
              <span>
                {d.name}{" "}
                <span className="k-hint">
                  {plural(d.cards, "card")}
                  {d.reviews ? ` · ${plural(d.reviews, "review")}` : ""}
                </span>
              </span>
            </label>
          ))}
          <div className="row">
            <Button
              variant="primary"
              disabled={chosen.size === 0 || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? <Spinner label="Importing" /> : null}
              Import {plural(chosen.size, "deck")}
            </Button>
            {run.isPending && progress ? <span className="k-hint">{progress}</span> : null}
          </div>
        </fieldset>
      ) : null}
      {run.isSuccess ? (
        <p role="status" style={{ margin: 0 }}>
          {summaryText(run.data)}
        </p>
      ) : null}
      {run.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          The import did not finish. {message(run.error)}
        </p>
      ) : null}
    </section>
  );
}

const fmt = (n: number | undefined) => (n === undefined ? "–" : n.toFixed(4));

function Tuning() {
  const services = useServices();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);
  const info = useQuery({ queryKey: ["review", "tuning"], queryFn: () => services.tuning() });
  const run = useMutation({
    mutationFn: () => services.optimiseNow(setProgress),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["review"] });
      await qc.invalidateQueries({ queryKey: ["learner"] });
    },
  });
  const t = run.data ?? info.data;
  return (
    <section className="stack" aria-labelledby="tuning-h">
      <h3 className="settings-h3" id="tuning-h">
        Tuned to you
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        The FSRS optimizer learns how you forget from your review history and sets the scheduler to
        match. It runs by itself every 30 days or after 500 new reviews, on this device.
      </p>
      {t ? (
        <p style={{ margin: 0 }} role="status">
          {t.tuned
            ? `Tuned on ${plural(t.reviewsUsed, "review")}${t.at ? `, ${relativeTime(t.at)}` : ""}.`
            : "Using the FSRS defaults."}{" "}
          {plural(t.history, "review")} in your history.
        </p>
      ) : null}
      {t?.logLoss !== undefined ? (
        <table className="cards-table cards-metrics" aria-label="Fit before and after tuning">
          <thead>
            <tr>
              <th scope="col">Fit (lower is better)</th>
              <th scope="col">Before</th>
              <th scope="col">Now</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Log loss</th>
              <td>{fmt(t.previousLogLoss)}</td>
              <td>{fmt(t.logLoss)}</td>
            </tr>
            <tr>
              <th scope="row">RMSE</th>
              <td>{fmt(t.previousRmse)}</td>
              <td>{fmt(t.rmse)}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
      {run.isSuccess && !run.data.improved ? (
        <p className="k-hint" style={{ margin: 0 }}>
          The new parameters fit no better, so the current ones were kept.
        </p>
      ) : null}
      <div className="row">
        <Button disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? <Spinner label="Optimising" /> : null}
          Optimise now
        </Button>
        {run.isPending && progress ? <span className="k-hint">{progress}</span> : null}
      </div>
      {run.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          {message(run.error)}
        </p>
      ) : null}
    </section>
  );
}
