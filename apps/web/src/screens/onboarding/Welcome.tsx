/**
 * First-run onboarding: language → "Do you use Anki?".
 * - No: Vuurtoren holds the cards (native mode) → where new words go → the most common words
 *   (starter levels, with a placement question) → first text.
 * - Yes, and move to Vuurtoren: connect Anki → confirm decks → where new words go → the decks are
 *   imported with their review history (native mode) → first text.
 * - Yes, and keep using Anki (connected mode): connect Anki → confirm decks → where new words
 *   go → (start fresh) placement check → first text.
 * Skippable; the step and choices are kept in localStorage so a reload resumes where the learner
 * was. Nothing is written to Anki here.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type LanguageProfile,
  PROFILE_LANGUAGES,
  type ProfileSource,
  defaultProfile,
  rootDeck,
} from "@app/core";
import { Button, Spinner, Logo } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { AnkiStatus } from "../../services/types.js";
import { AnkiConnectionHelp } from "../settings/AnkiSettings.js";
import { DeckChecklist, DestinationFields, LanguageChoice, deckRows } from "./deckParts.js";
import { SAMPLE_TEXT } from "./sample.js";
import { setSkipped } from "./skip.js";
import "./onboarding.css";
import { readLocalJSON, writeLocalJSON } from "../../storage/local.js";
import { runAnkiSync } from "../../shell/ankiSync.js";

const STORAGE = "vuurtoren.onboarding";

type Step =
  | "language"
  | "uses"
  | "choice"
  | "anki"
  | "decks"
  | "destinations"
  | "moving"
  | "placement"
  | "starter"
  | "first";
/** The language step is shown only when there is more than one language to choose. */
const PICK_LANGUAGE = PROFILE_LANGUAGES.filter((l) => l.enabled).length > 1;

/**
 * The stepper shows three fixed parts, whatever the answers add or skip inside them, so it
 * never changes length mid-flow.
 */
const PARTS = ["Getting started", "Your words", "First text"] as const;
const PART: Record<Step, number> = {
  language: 0,
  uses: 0,
  choice: 0,
  anki: 0,
  decks: 0,
  destinations: 1,
  moving: 1,
  placement: 1,
  starter: 1,
  first: 2,
};

interface Draft {
  step: Step;
  lang: string;
  sources: ProfileSource[];
  /** Suggested decks were pre-ticked once (later visits keep the learner's choice). */
  decksInit: boolean;
  /** Continue without Anki or no decks: start fresh. */
  noAnki: boolean;
  /** The answer to "Do you use Anki?" (null: not answered yet). */
  usesAnki: boolean | null;
  /** Import the Anki decks and review in Vuurtoren (else keep using Anki). */
  move: boolean;
  profile: LanguageProfile;
  /** Native: start with the most common words (starter levels). */
  starter: boolean;
  /** Native: how much Dutch the learner knows (a key of PLACEMENT). */
  level: Placement;
}

/**
 * The placement question of native mode: the words through `known` count as known (Mark known),
 * and these starter levels (500 words each) become new cards.
 */
const PLACEMENT = {
  start: { label: "Just starting", known: 0, levels: [1, 2, 3, 4, 5, 6] },
  "500": { label: "About 500 words", known: 500, levels: [2, 3, 4, 5, 6] },
  "1000": { label: "About 1000 words", known: 1000, levels: [3, 4, 5, 6] },
  "2000": { label: "About 2000 words", known: 2000, levels: [5, 6] },
  more: { label: "More", known: 3000, levels: [7, 8, 9, 10] },
} as const;
type Placement = keyof typeof PLACEMENT;

const fresh = (): Draft => ({
  step: PICK_LANGUAGE ? "language" : "uses",
  lang: "nl",
  sources: [],
  decksInit: false,
  noAnki: false,
  usesAnki: null,
  move: true,
  profile: defaultProfile("nl"),
  starter: true,
  level: "start",
});

function readDraft(): Draft {
  const saved = readLocalJSON(STORAGE) as Partial<Draft> | undefined;
  if (!saved || typeof saved !== "object") return fresh();
  const d = { ...fresh(), ...saved };
  return d.step === "language" && !PICK_LANGUAGE ? { ...d, step: "uses" } : d;
}
function writeDraft(d: Draft | null): void {
  writeLocalJSON(STORAGE, d);
}

export function Welcome() {
  const services = useServices();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraftState] = useState<Draft>(readDraft);
  const setDraft = (patch: Partial<Draft>) =>
    setDraftState((d) => {
      const next = { ...d, ...patch };
      writeDraft(next);
      return next;
    });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [draft.step]);

  const startFresh = draft.sources.length === 0;
  const native = draft.usesAnki === false;
  const moving = draft.usesAnki === true && draft.move && !draft.noAnki && !startFresh;
  const start: Step[] = PICK_LANGUAGE ? ["language", "uses"] : ["uses"];
  const steps: Step[] = native
    ? [...start, "destinations", "starter", "first"]
    : draft.usesAnki === null
      ? [...start, "first"]
      : [
          ...start,
          "choice",
          "anki",
          "decks",
          "destinations",
          ...(moving ? (["moving"] as const) : startFresh ? (["placement"] as const) : []),
          "first",
        ];
  const at = Math.max(0, steps.indexOf(draft.step));
  const go = (step: Step) => setDraft({ step });
  const next = () => go(steps[at + 1] ?? "first");
  const back = () => go(steps[at - 1] ?? steps[0]!);

  const skip = () => {
    setSkipped(true);
    void navigate({ to: "/library" });
  };
  const finish = () => {
    writeDraft(null);
    setSkipped(false);
  };

  // ---- Anki
  const status = useQuery({
    queryKey: ["onboarding", "ankiStatus"],
    queryFn: () => services.ankiStatus(),
    enabled: draft.step === "anki" || draft.step === "decks",
  });
  const [denied, setDenied] = useState(false);
  const connect = useMutation({
    mutationFn: () => services.connectAnki(),
    onSuccess: (r) => {
      setDenied(r.denied);
      qc.setQueryData(["onboarding", "ankiStatus"], r.status);
    },
  });
  const connected = status.data?.connected === true;

  // ---- Decks
  const decks = useQuery({
    queryKey: ["onboarding", "suggestDecks"],
    queryFn: async () => {
      const found = await services.suggestDecks();
      // Pre-tick the suggestions once; later visits keep the learner's choice.
      setDraftState((d) => {
        if (d.decksInit) return d;
        const next = {
          ...d,
          decksInit: true,
          sources: deckRows(found, [])
            .filter((r) => r.suggested)
            .map((r) => r.source),
        };
        writeDraft(next);
        return next;
      });
      return found;
    },
    enabled: draft.step === "decks" && connected && !draft.noAnki,
    staleTime: Infinity,
  });

  // ---- Save the profile when leaving "where new words go"
  const save = useMutation({
    mutationFn: async () => {
      // Native from the start, or connected until the move has imported the decks.
      const profile: LanguageProfile = {
        ...draft.profile,
        lang: draft.lang,
        mode: native ? "native" : "connected",
        sources: native ? [] : draft.sources,
        tags: [draft.lang],
      };
      await services.saveLanguageProfile(profile);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["languageProfile"] });
      await qc.invalidateQueries({ queryKey: ["deckChoices"] });
      // Read the confirmed decks in the background while the learner finishes the welcome steps.
      if (!native && !moving && draft.sources.length > 0 && connected && !draft.noAnki)
        void runAnkiSync(services, qc).catch(() => undefined);
      next();
    },
  });

  // ---- Move from Anki: import the confirmed decks with their history
  const [moveMsg, setMoveMsg] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: () => services.moveFromAnki(setMoveMsg),
    onSuccess: async () => {
      for (const k of ["languageProfile", "learner", "review", "words", "texts"]) {
        await qc.invalidateQueries({ queryKey: [k] });
      }
    },
  });

  // ---- Placement
  const bands = useQuery({
    queryKey: ["onboarding", "placement"],
    queryFn: () => services.placementWords(),
    enabled: draft.step === "placement",
  });
  const [known, setKnown] = useState<Set<string>>(new Set());
  const placement = useMutation({
    mutationFn: () => services.savePlacement([...known]),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["learner"] });
      next();
    },
  });

  // ---- Native: the most common words, from the learner's level
  const starter = useMutation({
    mutationFn: () => {
      const p = PLACEMENT[draft.level];
      return services.addStarterLevels({ levels: [...p.levels], knownThrough: p.known });
    },
    onSuccess: async () => {
      for (const k of ["learner", "review", "words", "home"]) {
        await qc.invalidateQueries({ queryKey: [k] });
      }
      next();
    },
  });

  // ---- First text
  const sample = useMutation({
    mutationFn: () =>
      services.importText({
        kind: "paste",
        title: SAMPLE_TEXT.title,
        content: SAMPLE_TEXT.content,
      }),
    onSuccess: (textId) => {
      finish();
      void qc.invalidateQueries({ queryKey: ["texts"] });
      void navigate({ to: "/read/$textId", params: { textId } });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.step === "uses") {
      if (draft.usesAnki !== null) go(draft.usesAnki ? "choice" : "destinations");
    } else if (draft.step === "destinations") save.mutate();
    else if (draft.step === "moving") {
      if (move.isSuccess) next();
      else if (!move.isPending) move.mutate();
    } else if (draft.step === "placement") placement.mutate();
    else if (draft.step === "starter") {
      if (draft.starter) starter.mutate();
      else next();
    } else if (draft.step !== "first") next();
  };

  const errorOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");
  const root = rootDeck(draft.lang);

  return (
    <div className="ob-shell">
      <main className="ob-card">
        <Logo size={28} className="ob-brand" />
        <ol className="ob-steps" aria-label="Setup steps">
          {PARTS.map((name, i) => (
            <li
              key={name}
              aria-current={i === PART[draft.step] ? "step" : undefined}
              data-done={i < PART[draft.step] || undefined}
            >
              {i + 1}. {name}
            </li>
          ))}
        </ol>
        <form onSubmit={submit}>
          {draft.step === "language" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Welcome to Vuurtoren
              </h1>
              <p className="ob-lede">
                Vuurtoren helps you read real texts at the edge of what you know. A few choices
                first: this takes about two minutes, and you can change everything later in
                Settings.
              </p>
              <LanguageChoice value={draft.lang} onChange={(lang) => setDraft({ lang })} />
            </>
          ) : null}

          {draft.step === "uses" ? (
            <>
              {PICK_LANGUAGE ? (
                <h1 ref={heading} tabIndex={-1}>
                  Do you use Anki?
                </h1>
              ) : (
                <>
                  <h1 ref={heading} tabIndex={-1}>
                    Welcome to Vuurtoren
                  </h1>
                  <p className="ob-lede">
                    Vuurtoren helps you read real Dutch texts at the edge of what you know. A few
                    choices first: this takes about two minutes, and you can change everything later
                    in Settings.
                  </p>
                  <h2 className="ob-question">Do you use Anki?</h2>
                </>
              )}
              <p className="ob-lede">
                Vuurtoren can keep your words and run your reviews itself, or work alongside Anki.
              </p>
              <fieldset className="ob-choices">
                <legend className="k-sr">Do you use Anki?</legend>
                <Choice
                  name="uses"
                  checked={draft.usesAnki === false}
                  onChange={() => setDraft({ usesAnki: false, sources: [], noAnki: false })}
                  title="No"
                  sub="Vuurtoren keeps your words and schedules your reviews. You can import an Anki deck file later."
                />
                <Choice
                  name="uses"
                  checked={draft.usesAnki === true}
                  onChange={() => setDraft({ usesAnki: true })}
                  title="Yes"
                  sub="Bring your Anki decks into Vuurtoren, or keep using Anki."
                />
              </fieldset>
            </>
          ) : null}

          {draft.step === "choice" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Your Anki cards
              </h1>
              <p className="ob-lede">Choose who schedules your reviews from now on.</p>
              <fieldset className="ob-choices">
                <legend className="k-sr">Who schedules your reviews</legend>
                <Choice
                  name="move"
                  checked={draft.move}
                  onChange={() => setDraft({ move: true })}
                  title="Import from Anki and use Vuurtoren’s scheduler"
                  sub="Your chosen decks come into Vuurtoren once, with every card and its review history. Reviews then happen in Vuurtoren; Anki is not changed."
                />
                <Choice
                  name="move"
                  checked={!draft.move}
                  onChange={() => setDraft({ move: false })}
                  title="Keep using Anki"
                  sub="Anki stays the record of what you know and runs your reviews. Anki must be open for Vuurtoren to send words to it."
                />
              </fieldset>
            </>
          ) : null}

          {draft.step === "moving" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Importing your decks
              </h1>
              <p className="ob-lede">
                Vuurtoren reads your chosen decks from Anki: notes, cards and the full review
                history. Nothing in Anki changes.
              </p>
              {move.isPending ? (
                <p role="status">
                  <Spinner label="Importing" /> {moveMsg ?? "Starting"}
                </p>
              ) : move.isSuccess ? (
                <p role="status">
                  Imported {move.data.cards} cards from {move.data.notes} notes, with{" "}
                  {move.data.reviews} past reviews. Your reviews now happen in Vuurtoren.
                </p>
              ) : move.isError ? (
                <p role="alert" className="error-text">
                  The import did not finish. {errorOf(move.error)}
                </p>
              ) : (
                <p>This can take a minute for a large collection.</p>
              )}
            </>
          ) : null}

          {draft.step === "anki" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Connect Anki
              </h1>
              <p className="ob-lede">
                Vuurtoren reads your decks through the AnkiConnect add-on while Anki is open. It
                only writes when you click a button such as Add to Anki.
              </p>
              <AnkiStep
                status={status.data}
                checking={status.isFetching}
                denied={denied}
                connecting={connect.isPending}
                onConnect={() => connect.mutate()}
                onCheck={() => void status.refetch()}
              />
            </>
          ) : null}

          {draft.step === "decks" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Decks Vuurtoren reads
              </h1>
              <p className="ob-lede">
                Words in the decks you tick count as known or learning. Vuurtoren suggests the decks
                that look like Dutch vocabulary; you decide.
              </p>
              {draft.noAnki || !connected ? (
                <p className="ob-note">
                  Without Anki, Vuurtoren starts fresh: it creates {root} the first time you add a
                  word, and you can connect Anki later in Settings.
                </p>
              ) : decks.isPending ? (
                <p role="status">
                  <Spinner label="Looking at your decks" /> Looking at your decks. With large
                  collections this takes a moment.
                </p>
              ) : decks.isError ? (
                <div className="stack" style={{ gap: 8 }}>
                  <p role="alert" className="error-text" style={{ margin: 0 }}>
                    Could not look at your decks. {errorOf(decks.error)}
                  </p>
                  <div className="row">
                    <Button onClick={() => void decks.refetch()}>Try again</Button>
                  </div>
                </div>
              ) : (
                <div className="stack" style={{ gap: 12 }}>
                  {decks.data.length ? (
                    <DeckChecklist
                      rows={deckRows(decks.data, draft.sources)}
                      chosen={draft.sources}
                      onChange={(sources) => setDraft({ sources })}
                    />
                  ) : (
                    <p className="ob-note">No Dutch vocabulary decks found in your collection.</p>
                  )}
                  <label className="ob-check">
                    <input
                      type="checkbox"
                      checked={startFresh}
                      onChange={(e) =>
                        setDraft({
                          sources: e.target.checked
                            ? []
                            : deckRows(decks.data, [])
                                .filter((r) => r.suggested)
                                .map((r) => r.source),
                        })
                      }
                    />
                    <span>
                      Start fresh
                      <span className="ob-choice-sub">
                        Vuurtoren creates {root} and fills it with the words you add while reading.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </>
          ) : null}

          {draft.step === "destinations" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Where new words go
              </h1>
              <p className="ob-lede">
                When you add a word, Vuurtoren creates a card in this deck
                {native ? "" : " in Anki"}. Every Add button shows the deck and lets you pick
                another one.
              </p>
              <DestinationFields
                compact
                profile={{ ...draft.profile, lang: draft.lang }}
                onChange={(profile) => setDraft({ profile })}
              />
              {save.isError ? (
                <p role="alert" className="error-text">
                  Could not save your choices. {errorOf(save.error)}
                </p>
              ) : null}
            </>
          ) : null}

          {draft.step === "placement" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Words you already know
              </h1>
              <p className="ob-lede">
                Tick the words you know, so the first texts are not too easy or too hard. This only
                marks them known; no cards are made.
              </p>
              {bands.data ? (
                <div className="ob-bands">
                  {bands.data.map((b) => (
                    <section key={b.label} className="ob-band" aria-label={b.label}>
                      <h2>{b.label}</h2>
                      <div className="ob-words">
                        {b.words.map((w) => (
                          <label key={w.key} className="ob-word">
                            <input
                              type="checkbox"
                              checked={known.has(w.key)}
                              onChange={(e) =>
                                setKnown((s) => {
                                  const n = new Set(s);
                                  if (e.target.checked) n.add(w.key);
                                  else n.delete(w.key);
                                  return n;
                                })
                              }
                            />
                            <span lang={draft.lang}>{w.word}</span>
                            <span className="ob-word-gloss">{w.gloss}</span>
                          </label>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <Spinner label="Loading words" />
              )}
            </>
          ) : null}

          {draft.step === "starter" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                The most common words
              </h1>
              <p className="ob-lede">
                Vuurtoren can give you cards for the 3000 most common Dutch words, 500 at a time,
                each with an example sentence. New cards come 20 a day; you can change that later.
              </p>
              <label className="ob-check">
                <input
                  type="checkbox"
                  checked={draft.starter}
                  onChange={(e) => setDraft({ starter: e.target.checked })}
                />
                <span>
                  Start with the most common words
                  <span className="ob-choice-sub">
                    Without them, your cards are the words you add while reading.
                  </span>
                </span>
              </label>
              {draft.starter ? (
                <fieldset className="ob-choices">
                  <legend className="ob-question">How much Dutch do you know?</legend>
                  {(Object.keys(PLACEMENT) as Placement[]).map((key) => (
                    <Choice
                      key={key}
                      name="level"
                      checked={draft.level === key}
                      onChange={() => setDraft({ level: key })}
                      title={PLACEMENT[key].label}
                      sub={placementLine(key)}
                    />
                  ))}
                </fieldset>
              ) : null}
              {starter.isPending ? (
                <p role="status">
                  <Spinner label="Adding words" /> Adding the words
                </p>
              ) : null}
              {starter.isError ? (
                <p role="alert" className="error-text">
                  Could not add the words. {errorOf(starter.error)}
                </p>
              ) : null}
            </>
          ) : null}

          {draft.step === "first" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Your first text
              </h1>
              <p className="ob-lede">
                You are set up. Start with something you want to read, or try a short sample.
              </p>
              <div className="ob-first">
                <div className="ob-first-card">
                  <h2>Add a text</h2>
                  <p>Paste an article, open a web page, or a PDF or photo of a page.</p>
                  <Button
                    variant="primary"
                    onClick={() => {
                      finish();
                      void navigate({ to: "/import" });
                    }}
                  >
                    Add text
                  </Button>
                </div>
                <div className="ob-first-card">
                  <h2>Read a sample</h2>
                  <p>{SAMPLE_TEXT.blurb}</p>
                  <Button disabled={sample.isPending} onClick={() => sample.mutate()}>
                    {sample.isPending ? <Spinner label="Preparing" /> : null}
                    Read the sample
                  </Button>
                </div>
              </div>
              {sample.isError ? (
                <p role="alert" className="error-text">
                  Could not prepare the sample. {errorOf(sample.error)}
                </p>
              ) : null}
            </>
          ) : null}

          <div className="ob-nav">
            {at > 0 && draft.step !== "first" ? (
              <Button variant="ghost" onClick={back}>
                Back
              </Button>
            ) : null}
            <span className="ob-nav-spacer" />
            {draft.step === "first" ? (
              <button
                type="button"
                className="ob-skip"
                onClick={() => {
                  finish();
                  void navigate({ to: "/library" });
                }}
              >
                Go to the Library
              </button>
            ) : (
              <button type="button" className="ob-skip" onClick={skip}>
                Skip setup for now
              </button>
            )}
            {draft.step === "anki" && !connected ? (
              <Button
                onClick={() => {
                  // Moving needs Anki; without it Vuurtoren starts fresh with its own cards.
                  if (draft.move) {
                    setDraft({ usesAnki: false, sources: [], step: "destinations" });
                  } else {
                    setDraft({ noAnki: true, sources: [] });
                    go("decks");
                  }
                }}
              >
                Continue without Anki
              </Button>
            ) : null}
            {draft.step === "placement" ? (
              <Button variant="ghost" onClick={next}>
                Skip this
              </Button>
            ) : null}
            {draft.step !== "first" && !(draft.step === "anki" && !connected) ? (
              <Button
                type="submit"
                variant="primary"
                disabled={
                  save.isPending ||
                  placement.isPending ||
                  starter.isPending ||
                  move.isPending ||
                  (draft.step === "uses" && draft.usesAnki === null) ||
                  (draft.step === "decks" && connected && !draft.noAnki && decks.isPending) ||
                  (draft.step === "destinations" && !draft.profile.destinations.default.trim())
                }
                onClick={() => {
                  if (draft.step === "anki") setDraft({ noAnki: false });
                }}
              >
                {draft.step === "destinations"
                  ? "Save and continue"
                  : draft.step === "moving"
                    ? move.isSuccess
                      ? "Continue"
                      : move.isError
                        ? "Try again"
                        : "Import"
                    : draft.step === "placement"
                      ? `Continue${known.size ? ` with ${known.size} known` : ""}`
                      : "Continue"}
              </Button>
            ) : null}
          </div>
        </form>
      </main>
    </div>
  );
}

/** What a placement answer does, in one line. */
function placementLine(key: Placement): string {
  const p = PLACEMENT[key];
  const from = (p.levels[0] - 1) * 500 + 1;
  const to = p.levels[p.levels.length - 1]! * 500;
  return p.known === 0
    ? `Words 1–${to} come as new cards.`
    : `Words 1–${p.known} count as known; words ${from}–${to} come as new cards.`;
}

/** One radio choice with a title and a line under it. */
function Choice({
  name,
  checked,
  onChange,
  title,
  sub,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  sub: string;
}) {
  return (
    <label className="ob-choice">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>
        <span className="ob-choice-title">{title}</span>
        <span className="ob-choice-sub">{sub}</span>
      </span>
    </label>
  );
}

/** Connection state with clear help for each problem; buttons to ask Anki and to re-check. */
function AnkiStep({
  status,
  checking,
  denied,
  connecting,
  onConnect,
  onCheck,
}: {
  status: AnkiStatus | undefined;
  checking: boolean;
  denied: boolean;
  connecting: boolean;
  onConnect: () => void;
  onCheck: () => void;
}) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      {status ? (
        <AnkiConnectionHelp status={status} denied={denied} />
      ) : (
        <p role="status">
          <Spinner label="Checking" /> Looking for Anki
        </p>
      )}
      {status && !status.connected ? (
        <div className="row">
          {status.state === "not-allowed" ? (
            <Button variant="primary" disabled={connecting} onClick={onConnect}>
              {connecting ? <Spinner label="Waiting for Anki" /> : null}
              Allow Vuurtoren in Anki
            </Button>
          ) : null}
          <Button disabled={checking} onClick={onCheck}>
            {checking ? <Spinner label="Checking" /> : null}
            Check again
          </Button>
        </div>
      ) : null}
      {connecting ? (
        <p className="k-hint" style={{ margin: 0 }}>
          Switch to Anki: it asks whether to allow this site. Click Yes.
        </p>
      ) : null}
    </div>
  );
}
