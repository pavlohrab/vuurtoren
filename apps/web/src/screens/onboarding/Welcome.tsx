/**
 * First-run onboarding: language → "Do you use Anki?" → (on a phone) Connect to your server.
 * - No (the easy start, three steps): Vuurtoren holds the cards (native mode, saved at once with
 *   the default decks) → where new words start (starter levels) → ready: Read opens with a story
 *   at the learner's level.
 * - Yes, and move to Vuurtoren: connect Anki → confirm decks → where new words go → the decks are
 *   imported with their review history (native mode) → first text.
 * - Yes, and keep using Anki (connected mode): connect Anki → confirm decks → where new words
 *   go → (start fresh) placement check → first text.
 * On a phone, Connect to your server comes after "Do you use Anki?": new texts and translations
 * come from the server ("Not now" goes on without one).
 * Skippable; the step and choices are kept in localStorage so a reload resumes where the learner
 * was. Nothing is written to Anki here.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type LanguageProfile,
  PROFILE_LANGUAGES,
  type ProfileSource,
  defaultProfile,
  rootDeck,
} from "@app/core";
import { STARTER_LEVELS } from "@app/anki";
import { Button, Spinner, Logo } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { AnkiStatus } from "../../services/types.js";
import { AnkiConnectionHelp } from "../settings/AnkiSettings.js";
import { ConnectYourServer } from "../settings/SyncSettings.js";
import { ImportPackage } from "../settings/CardsSettings.js";
import { DictionaryPack } from "../settings/DictionaryPack.js";
import "../settings/settings.css";
import { currentDevice } from "../../platform/index.js";
import { storyToStart } from "../../services/stories.js";
import { startTour } from "../../shell/Tour.js";
import { DeckChecklist, DestinationFields, LanguageChoice, deckRows } from "./deckParts.js";
import { setSkipped } from "./skip.js";
import "./onboarding.css";
import { readLocalJSON, writeLocalJSON } from "../../storage/local.js";
import { runAnkiSync } from "../../shell/ankiSync.js";

const STORAGE = "vuurtoren.onboarding";

type Step =
  | "language"
  | "uses"
  | "server"
  | "choice"
  | "anki"
  | "decks"
  | "apkg"
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
const PARTS = ["Getting started", "Your words", "Start reading"] as const;
const PART: Record<Step, number> = {
  language: 0,
  uses: 0,
  server: 0,
  choice: 0,
  anki: 0,
  decks: 0,
  apkg: 1,
  destinations: 1,
  moving: 1,
  placement: 1,
  starter: 1,
  first: 2,
};

/** Every step in the order the welcome can show them (each flow shows some of them). */
const ORDER: Step[] = [
  "language",
  "uses",
  "server",
  "choice",
  "anki",
  "decks",
  "apkg",
  "destinations",
  "moving",
  "placement",
  "starter",
  "first",
];

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
  /** Native: the starter level new words start from (one of START_LEVELS). */
  from: number;
}

/**
 * Native mode: where new words start. Every level is added; the levels below the start get no
 * new cards until the learner turns them on (Settings). Nothing is marked known.
 */
const START_LEVELS = [1, 2, 3, 5, 7] as const;

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
  from: 1,
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
  // A phone without sync yet: its server brings new texts and translations (after the Anki question).
  const sync = useQuery({ queryKey: ["sync", "status"], queryFn: () => services.syncStatus() });
  const [phone] = useState(() => currentDevice().kind === "android");
  // AnkiConnect needs Anki on a computer: a phone brings Anki decks in as a file instead, so
  // its cards are Vuurtoren's own either way.
  const phoneAnki = phone && draft.usesAnki === true;
  const native = draft.usesAnki === false || phoneAnki;
  const moving =
    !phoneAnki && draft.usesAnki === true && draft.move && !draft.noAnki && !startFresh;
  const askServer = phone && (draft.step === "server" || (!!sync.data && !sync.data.place));
  const start: Step[] = [
    ...(PICK_LANGUAGE ? (["language", "uses"] as const) : (["uses"] as const)),
    ...(askServer ? (["server"] as const) : []),
  ];
  // No Anki: the default decks are fine to start with (Settings changes them), so no deck step.
  const steps: Step[] = phoneAnki
    ? [...start, "apkg", "starter", "first"]
    : native
      ? [...start, "starter", "first"]
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
  // Relative to the overall order, so a step the current flow does not show (after an answer
  // changed the flow) still goes on forward, never back to the start.
  const rank = ORDER.indexOf(draft.step);
  const next = () => go(steps.find((s) => ORDER.indexOf(s) > rank) ?? "first");
  const back = () => go(steps.findLast((s) => ORDER.indexOf(s) < rank) ?? steps[0]!);

  // Skipping still sets the learner up with Vuurtoren's own cards, so Review and the word
  // actions work; Settings can switch to Anki later.
  const skip = async () => {
    setSkipped(true);
    const current = await services.languageProfile();
    if (current?.mode !== "native") {
      const lang = current?.lang ?? (await services.getSettings()).lang;
      await services.saveLanguageProfile({
        ...(current ?? defaultProfile(lang, [], "native")),
        mode: "native",
      });
      await qc.invalidateQueries();
    }
    void navigate({ to: "/" });
  };
  const [server, setServer] = useState<"none" | "paired" | "on">("none");
  const onServerState = useCallback((s: "none" | "paired" | "on") => setServer(s), []);
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
    mutationFn: async (opts: { native?: boolean }) => {
      const own = opts.native ?? native;
      // Native from the start, or connected until the move has imported the decks.
      const profile: LanguageProfile = {
        ...draft.profile,
        lang: draft.lang,
        mode: own ? "native" : "connected",
        sources: own ? [] : draft.sources,
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

  // ---- Native: the most common words, all levels, new cards from the chosen one
  const [added, setAdded] = useState<{ done: number; total: number } | null>(null);
  const starter = useMutation({
    mutationFn: () =>
      services.addStarterLevels(
        {
          levels: Array.from({ length: STARTER_LEVELS }, (_, i) => i + 1),
          from: draft.from,
        },
        (done, total) => setAdded({ done, total }),
      ),
    onSuccess: async () => {
      for (const k of ["learner", "review", "words", "home"]) {
        await qc.invalidateQueries({ queryKey: [k] });
      }
      next();
    },
  });

  // ---- Ready: the story at the learner's level opens in the reader (Read when there is none).
  const story = useQuery({
    queryKey: ["onboarding", "story"],
    queryFn: async () => storyToStart(await services.storyShelf()),
    enabled: draft.step === "first",
  });
  const startReading = useMutation({
    mutationFn: async () => (story.data ? services.openStory(story.data.slug) : null),
    onSettled: async (textId) => {
      finish();
      // A short walkthrough of the app follows, once.
      startTour();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["stories"] }),
        qc.invalidateQueries({ queryKey: ["texts"] }),
      ]);
      if (textId) void navigate({ to: "/read/$textId", params: { textId } });
      else void navigate({ to: "/" });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.step === "uses") {
      if (draft.usesAnki === true && !phone) next();
      // No Anki (or a phone, where Anki decks come as a file): save the profile now
      // (Vuurtoren's cards, default decks) and go on.
      else if (draft.usesAnki !== null) save.mutate({});
    } else if (draft.step === "destinations") save.mutate({});
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
        {draft.step === "server" ? (
          <section aria-labelledby="ob-server-h">
            <h1 id="ob-server-h" ref={heading} tabIndex={-1}>
              Sync with your other devices
            </h1>
            <p className="ob-lede">
              Connect to your Vuurtoren server to keep your words and texts the same here and on
              your computer; it also analyses texts you add on this phone. No server yet? Choose Not
              now and connect later in Settings → Your devices.
            </p>
            <ConnectYourServer onState={onServerState} />
            <div className="ob-nav">
              <Button variant="ghost" onClick={back}>
                Back
              </Button>
              <span className="ob-nav-spacer" />
              <Button variant={server === "on" ? "primary" : "secondary"} onClick={next}>
                {server === "on" ? "Continue" : "Not now"}
              </Button>
            </div>
            <SkipSetup onSkip={skip} />
          </section>
        ) : (
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
                      choices first: this takes about two minutes, and you can change everything
                      later in Settings.
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
                    sub={
                      phone
                        ? "Bring your Anki decks in as a deck file (.apkg)."
                        : "Bring your Anki decks into Vuurtoren, or keep using Anki."
                    }
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
                  Words in the decks you tick count as known or learning. Vuurtoren suggests the
                  decks that look like Dutch vocabulary; you decide.
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
                          Vuurtoren creates {root} and fills it with the words you add while
                          reading.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </>
            ) : null}

            {draft.step === "apkg" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  Your Anki cards
                </h1>
                <p className="ob-lede">
                  Anki&apos;s connection (AnkiConnect) works only with Anki on a computer. On this
                  phone, bring your decks in as a file: in Anki, choose File → Export → Anki Deck
                  Package (.apkg), with scheduling information, then choose that file here. Your
                  reviews then happen in Vuurtoren.
                </p>
                <ImportPackage />
                <p className="ob-note">
                  No file at hand? Continue and start with Vuurtoren&apos;s cards; Settings → Your
                  words imports a deck file any time.
                </p>
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
                  Tick the words you know, so the first texts are not too easy or too hard. This
                  only marks them known; no cards are made.
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
                  Vuurtoren can give you cards for about 5000 of the most common Dutch words, in
                  levels of 500, each with an example sentence. Ten new words a day, one level at a
                  time; you can change that later.
                </p>
                <label className="ob-check">
                  <input
                    type="checkbox"
                    checked={draft.starter}
                    disabled={starter.isPending}
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
                  <fieldset className="ob-choices" disabled={starter.isPending}>
                    <legend className="ob-question">Where should new words start?</legend>
                    <p className="ob-choices-note">
                      Lower levels wait until you turn them on; the words you know get marked as you
                      read.
                    </p>
                    {START_LEVELS.map((level) => (
                      <Choice
                        key={level}
                        name="from"
                        checked={draft.from === level}
                        onChange={() => setDraft({ from: level })}
                        title={`Level ${level}`}
                        sub={`Words ${(level - 1) * 500 + 1}–${level * 500}`}
                      />
                    ))}
                  </fieldset>
                ) : null}
                {starter.isPending ? (
                  <p role="status">
                    <Spinner label="Adding words" />{" "}
                    {added
                      ? `Adding words… ${added.done.toLocaleString("en")} of ${added.total.toLocaleString("en")}`
                      : "Adding the words…"}
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
                  You are ready
                </h1>
                <p className="ob-lede">
                  {story.data ? (
                    <>
                      A short story at your level is ready:{" "}
                      <cite lang="nl">{story.data.title}</cite>.
                    </>
                  ) : (
                    "A short story at your level is waiting on Read."
                  )}{" "}
                  Tap any word you do not know to see what it means, and keep it with Add to my
                  words.
                </p>
                {/* A phone: the dictionary comes down now, so meanings work without a server. */}
                <DictionaryPack autoStart />
                <div className="ob-first-actions">
                  <Button
                    variant="primary"
                    disabled={story.isPending || startReading.isPending}
                    onClick={() => startReading.mutate()}
                  >
                    {startReading.isPending ? <Spinner label="Opening the story" /> : null}
                    Start reading
                  </Button>
                  <button
                    type="button"
                    className="ob-skip"
                    onClick={() => {
                      finish();
                      void navigate({ to: "/import" });
                    }}
                  >
                    Add a text of your own
                  </button>
                </div>
              </>
            ) : null}

            <div className="ob-nav">
              {at > 0 && draft.step !== "first" ? (
                <Button variant="ghost" onClick={back} disabled={starter.isPending}>
                  Back
                </Button>
              ) : null}
              <span className="ob-nav-spacer" />
              {draft.step === "anki" && !connected ? (
                <Button
                  onClick={() => {
                    // Moving needs Anki; without it Vuurtoren starts fresh with its own cards.
                    if (draft.move) {
                      setDraft({ usesAnki: false, sources: [], noAnki: false });
                      save.mutate({ native: true });
                    } else {
                      setDraft({ noAnki: true, sources: [] });
                      go("decks");
                    }
                  }}
                >
                  Continue without Anki
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
            {draft.step === "first" ? null : <SkipSetup onSkip={() => void skip()} />}
          </form>
        )}
      </main>
    </div>
  );
}

/** "Skip setup for now", one quiet link under the buttons. */
function SkipSetup({ onSkip }: { onSkip: () => void }) {
  return (
    <p className="ob-skip-row">
      <button type="button" className="ob-skip" onClick={onSkip}>
        Skip setup for now
      </button>
    </p>
  );
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
