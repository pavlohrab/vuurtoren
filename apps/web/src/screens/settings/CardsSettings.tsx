/**
 * Settings → Language & decks, the cards part. Connected mode: one action, "Move from Anki to
 * Vuurtoren". Native mode: what Vuurtoren holds, importing a deck file, each deck's target retention
 * and limits, and FSRS tuning ("Optimise now").
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useRef, useState } from "react";
import { DEFAULT_DECK_OPTIONS, type DeckOptions, defaultProfile } from "@app/core";
import { Button, Input, Select, Skeleton, Spinner, useToast } from "@app/ui";
import { plural, relativeTime } from "../../format.js";
import { useServices } from "../../services/context.js";
import { saveFile } from "../../saveFile.js";
import type { DeckWithLoad, ImportSummary, NativeDeckSummary } from "../../services/nativeTypes.js";
import { errorText } from "../../services/errors.js";

/** Queries that change when cards come in or the mode changes. */
const AFFECTED = ["languageProfile", "learner", "review", "words", "texts", "home"];

function summaryText(s: ImportSummary): string {
  const had = s.alreadyHad ?? 0;
  if (had >= s.cards && s.cards > 0)
    return `You already have all ${plural(s.cards, "card")} of this file: nothing changed.`;
  const parts = [
    `${plural(s.cards - had, "card")} from ${plural(s.notes, "note")}`,
    `${plural(s.reviews, "past review")}`,
  ];
  if (s.media) parts.push(`${plural(s.media, "media file")}`);
  let text = `Imported ${parts.join(", ")}. ${plural(s.vocabNotes, "note")} feed your word list.`;
  if (had) text += ` ${plural(had, "card")} you already had stayed as they were.`;
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
  // Without Anki: Vuurtoren holds the cards from now on; nothing is imported.
  const fresh = useMutation({
    mutationFn: async () => {
      const current = await services.languageProfile();
      const lang = current?.lang ?? (await services.getSettings()).lang;
      const base = current ?? defaultProfile(lang, [], "native");
      await services.saveLanguageProfile({ ...base, mode: "native" });
    },
    onSuccess: async () => {
      toast("Vuurtoren keeps your cards now", "Review is in the sidebar.");
      for (const k of [...AFFECTED, "languageProfile", "review"])
        await qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast("Could not switch", errorText(e)),
  });
  const move = useMutation({
    mutationFn: () => services.moveFromAnki(setProgress),
    onSuccess: async (summary) => {
      // This part of Settings is replaced by the native one: the result goes to a toast.
      toast("Your reviews now happen in Vuurtoren", summaryText(summary));
      for (const k of AFFECTED) await qc.invalidateQueries({ queryKey: [k] });
    },
  });
  return (
    <section className="stack" aria-labelledby="cards-h">
      <h3 className="settings-h3" id="cards-h">
        Reviews
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        Anki keeps your cards and runs your reviews. You can bring your decks into Vuurtoren
        instead: they come over once, with every card and its past reviews, and from then on
        Vuurtoren plans your reviews. Anki itself is not changed.
      </p>
      {move.isSuccess ? (
        <p role="status" style={{ margin: 0 }}>
          {summaryText(move.data)} Your reviews now happen in Vuurtoren.
        </p>
      ) : confirm ? (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>
            Import the decks Vuurtoren reads from Anki and review in Vuurtoren from now on? Keep
            Anki open while it runs.
          </p>
          <div className="row">
            <Button variant="primary" disabled={move.isPending} onClick={() => move.mutate()}>
              {move.isPending ? <Spinner label="Importing" /> : null}
              Move to Vuurtoren
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
          <Button onClick={() => setConfirm(true)}>Move from Anki to Vuurtoren</Button>
          <Button variant="ghost" disabled={fresh.isPending} onClick={() => fresh.mutate()}>
            I don&apos;t use Anki: keep my cards in Vuurtoren
          </Button>
        </div>
      )}
      {move.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          The move did not finish. {errorText(move.error)}
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
          Vuurtoren keeps your cards and plans your reviews with spaced review (FSRS): each word
          comes back just before you would forget it.
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
      <StarterWords />
      <ImportPackage />
      {decks.data?.length ? <ExportPackage decks={decks.data.map((d) => d.name)} /> : null}
      {decks.data?.length ? (
        <>
          <NewWordsPerDay />
          <ReviewWeek />
        </>
      ) : null}
      <Tuning />
      {decks.data?.length ? <MoveToAnki /> : null}
    </>
  );
}

/**
 * The most common words, 500 a level: add the levels, and choose the level new words start
 * from (the levels below it get no new cards).
 */
function StarterWords() {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const levels = useQuery({
    queryKey: ["review", "starter"],
    queryFn: () => services.starterLevels(),
  });
  const refresh = async () => {
    for (const k of AFFECTED) await qc.invalidateQueries({ queryKey: [k] });
  };
  const add = useMutation({
    mutationFn: (which: number[]) => services.addStarterLevels({ levels: which }),
    onSuccess: async (r) => {
      await refresh();
      toast(
        "Words added",
        `${plural(r.added, "new card")}${r.skipped ? `; ${plural(r.skipped, "word")} you already had` : ""}.`,
      );
    },
  });
  const start = useMutation({
    mutationFn: (level: number) => services.setStarterFrom(level),
    onSuccess: async () => {
      await refresh();
      toast("Saved");
    },
  });
  if (!levels.data) return null;
  const { held, all, from } = levels.data;
  const missing = Array.from({ length: all }, (_, i) => i + 1).filter((l) => !held.includes(l));
  const range = (l: number) => `${(l - 1) * 500 + 1}–${l * 500}`;
  return (
    <section className="stack" aria-labelledby="starter-h">
      <h3 className="settings-h3" id="starter-h">
        Starter words
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        {held.length
          ? `The most common Dutch words, 500 to a level. You have ${held.length} of the ${all} levels; a level starts when the one before it has no new words left.`
          : "The most common Dutch words, 500 to a level, each with an example sentence. A level starts when the one before it has no new words left."}
      </p>
      {held.length ? (
        <div style={{ maxWidth: 320 }}>
          <Select
            label="Start new words from level"
            value={String(from)}
            disabled={start.isPending}
            options={Array.from({ length: all }, (_, i) => ({
              value: String(i + 1),
              label: `Level ${i + 1} (words ${range(i + 1)})`,
            }))}
            onValueChange={(v) => start.mutate(Number(v))}
          />
          <p className="k-hint">The levels below it get no new cards.</p>
        </div>
      ) : null}
      {missing.length ? (
        <div className="row">
          <Button disabled={add.isPending} onClick={() => add.mutate(missing)}>
            {add.isPending ? <Spinner label="Adding words" /> : null}
            {held.length ? "Add the missing levels" : "Add the most common words"}
          </Button>
        </div>
      ) : null}
      {add.isError || start.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          Could not change the words. {errorText(add.error ?? start.error)}
        </p>
      ) : null}
    </section>
  );
}

const RETENTIONS = [0.8, 0.85, 0.87, 0.9, 0.92, 0.95, 0.97];

function DeckTable({ decks }: { decks: DeckWithLoad[] }) {
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
                  {[...new Set([...RETENTIONS, d.options.desiredRetention])].sort().map((r) => {
                    const perDay = d.load.find((l) => l.retention === r)?.perDay;
                    return (
                      <option key={r} value={String(r)}>
                        {Math.round(r * 100)}%
                        {perDay !== undefined ? ` · about ${perDay} a day` : ""}
                      </option>
                    );
                  })}
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
        Target recall: how likely you are to still know a card when it comes back. Higher means more
        reviews a day; each choice shows about how many.
      </p>
    </div>
  );
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_LOAD = [
  { value: "1", label: "Normal" },
  { value: "0.5", label: "Reduced" },
  { value: "0", label: "Minimum" },
];

/** Lighter days: weekdays with fewer reviews; due dates spread away from them. */
/** New words a day, for all decks together: the one number most learners change. */
function NewWordsPerDay() {
  const services = useServices();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => services.getSettings() });
  const save = useMutation({
    mutationFn: (newWordsPerDay: number) => services.saveSettings({ newWordsPerDay }),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["review"] });
    },
  });
  if (!settings.data) return null;
  return (
    <section className="stack" aria-labelledby="new-words-h">
      <h3 className="settings-h3" id="new-words-h">
        New words a day
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        How many new words join your reviews each day, from all your decks together: words you added
        while reading first, then your level. After your reviews you can always go on with more.
      </p>
      <Input
        type="number"
        min={0}
        max={200}
        aria-label="New words a day"
        className="cards-new-per-day"
        defaultValue={settings.data.newWordsPerDay}
        onBlur={(e) => {
          const n = Math.max(0, Math.min(200, Math.round(Number(e.target.value))));
          if (Number.isFinite(n) && n !== settings.data?.newWordsPerDay) save.mutate(n);
        }}
      />
    </section>
  );
}

function ReviewWeek() {
  const services = useServices();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => services.getSettings() });
  // The week as last chosen here: quick changes to several days build on each other, not on
  // settings that have not come back yet.
  const [draft, setDraft] = useState<number[] | null>(null);
  const saving = useRef(0);
  const save = useMutation({
    mutationFn: (reviewWeek: number[]) => services.saveSettings({ reviewWeek }),
    onMutate: () => void saving.current++,
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["settings"] });
      if (--saving.current === 0) setDraft(null);
    },
  });
  const week =
    draft ??
    (settings.data?.reviewWeek?.length === 7 ? settings.data.reviewWeek : [1, 1, 1, 1, 1, 1, 1]);
  const choose = (day: number, load: number) => {
    const next = week.map((x, j) => (j === day ? load : x));
    setDraft(next);
    save.mutate(next);
  };
  return (
    <section className="stack" aria-labelledby="review-week-h">
      <h3 className="settings-h3" id="review-week-h">
        Review days
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        Days you want fewer reviews. Vuurtoren moves cards away from them where it can.
      </p>
      <div className="cards-week">
        {WEEKDAYS.map((day, i) => (
          <Select
            key={day}
            label={day}
            value={String(week[i] ?? 1)}
            onValueChange={(v) => choose(i, Number(v))}
            options={DAY_LOAD}
          />
        ))}
      </div>
    </section>
  );
}

/** Move to Anki, once: the words go to Anki and the profile switches to Keep using Anki. */
function MoveToAnki() {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: async () => {
      const r = await services.moveToAnki(history, setProgress);
      setProgress("Reading your words from Anki");
      await services.syncAnki(setProgress).catch(() => undefined);
      return r;
    },
    onSuccess: async (r) => {
      const parts = [`${plural(r.added, "word")} added`];
      if (r.existing) parts.push(`${plural(r.existing, "note")} Anki already had`);
      if (r.scheduled) parts.push(`${plural(r.scheduled, "card")} given their due date`);
      if (r.reviews) parts.push(`${plural(r.reviews, "past review")} copied`);
      if (r.skipped) parts.push(`${plural(r.skipped, "note")} without a word left out`);
      // This part of Settings is replaced by the connected one: the result goes to a toast.
      toast("Your reviews now happen in Anki", `${parts.join(", ")}.`);
      for (const k of AFFECTED) await qc.invalidateQueries({ queryKey: [k] });
    },
  });
  return (
    <section className="stack" aria-labelledby="to-anki-h">
      <h3 className="settings-h3" id="to-anki-h">
        Move to Anki
      </h3>
      <p className="k-hint" style={{ margin: 0 }}>
        Review in Anki from now on. Your words become notes in Anki, in the same decks, and each
        card comes due on the same day as here. Vuurtoren then reads your words from Anki. Cards of
        other kinds stay here: export them to a deck file above.
      </p>
      {confirm ? (
        <div className="stack" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={history}
              onChange={(e) => setHistory(e.target.checked)}
            />
            <span>
              Also copy the review history and exact intervals (experimental)
              <span className="k-hint" style={{ display: "block" }}>
                Every answer with its real time. Open the deck options in Anki afterwards so FSRS
                reads it.
              </span>
            </span>
          </label>
          <p style={{ margin: 0 }}>Keep Anki open while it runs.</p>
          <div className="row">
            <Button variant="primary" disabled={move.isPending} onClick={() => move.mutate()}>
              {move.isPending ? <Spinner label="Moving" /> : null}
              Move to Anki
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
          <Button onClick={() => setConfirm(true)}>Move to Anki…</Button>
        </div>
      )}
      {move.isError ? (
        <p role="alert" className="error-text" style={{ margin: 0 }}>
          The move did not finish. {errorText(move.error)}
        </p>
      ) : null}
    </section>
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
        A deck file (.apkg) Anki can open, with your cards, their past reviews, images and sounds.
        In Anki: File › Import.
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
          The export did not finish. {errorText(run.error)}
        </p>
      ) : null}
    </section>
  );
}

export function ImportPackage() {
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
        Bring in an Anki deck (.apkg) or collection (.colpkg), with past reviews, images and sounds.
        Cards you already have stay as they are.
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
          {errorText(open.error)}
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
          The import did not finish. {errorText(run.error)}
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
        Vuurtoren learns how quickly you forget from your past reviews and times your cards to
        match. It does this by itself every 30 days or after 500 new reviews, on this device.
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
          {errorText(run.error)}
        </p>
      ) : null}
    </section>
  );
}
