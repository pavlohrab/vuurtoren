/**
 * First-run onboarding: language → "Do you use Anki?" → (on a phone) Connect to your server.
 * - No (the easy start, three steps): Vuurtoren holds the cards (native mode, saved at once with
 *   the default decks) → the starter words, from the most common one (no question) → ready: Read
 *   opens with a story at the learner's level.
 * - Yes, and move to Vuurtoren: connect Anki → confirm decks → where new words go → the decks are
 *   imported with their review history (native mode) → first text.
 * - Yes, and keep using Anki (connected mode): connect Anki → confirm decks → where new words
 *   go → (start fresh) placement check → first text.
 * On a phone, Connect to your server comes after "Do you use Anki?": new texts and translations
 * come from the server ("Not now" goes on without one).
 * Not skippable: the step and choices are kept in localStorage until the last step, so leaving
 * the app (or a reload) brings the learner back where they were. Nothing is written to Anki here.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LanguageProfile,
  PROFILE_LANGUAGES,
  type ProfileSource,
  defaultProfile,
  rootDeck,
} from "@app/core";
import { STARTER_LEVELS, STARTER_LEVEL_SIZE, starterBand } from "@app/anki";
import { Button, Spinner, Logo } from "@app/ui";
import { ChevronLeft } from "lucide-react";
import { useServices } from "../../services/context.js";
import type { AnkiStatus } from "../../services/types.js";
import { AnkiConnectionHelp } from "../settings/AnkiSettings.js";
import { ConnectYourServer } from "../settings/SyncSettings.js";
import { ImportPackage } from "../settings/CardsSettings.js";
import { useAnkiConversion, useConvert } from "../settings/ConvertAnki.js";
import { useLevelProgress } from "../words/WordsRoom.js";
import { DictionaryPack } from "../settings/DictionaryPack.js";
import { RecordingsPack } from "../settings/RecordingsPack.js";
import "../settings/settings.css";
import { currentDevice } from "../../platform/index.js";
import { storyToStart } from "../../services/stories.js";
import { startTour } from "../../shell/Tour.js";
import { DeckChecklist, DestinationFields, LanguageChoice, deckRows } from "./deckParts.js";
import { ONBOARDING_DRAFT } from "./unfinished.js";
import "./onboarding.css";
import { readLocalJSON, writeLocalJSON } from "../../storage/local.js";
import { runAnkiSync } from "../../shell/ankiSync.js";
import { useCanAddTexts } from "../../platform/canAddTexts.js";
import {
  type LevelEstimate,
  LevelCheck,
  LevelResult,
  TryPractice,
  estimateLevel,
  levelWords,
} from "./FirstSteps.js";

const STORAGE = ONBOARDING_DRAFT;

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
  | "convert"
  | "known"
  | "practise"
  | "level"
  | "ready"
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
  // The 500 words' screen is the last one (Start reading is on it).
  starter: 2,
  // An Anki user: convert the Anki words, then what the reviews say you know (no 20 words).
  convert: 2,
  known: 2,
  // Then a few practice questions, Check your level and what it means (mock-practice-words).
  practise: 2,
  level: 2,
  ready: 2,
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
  "convert",
  "known",
  "practise",
  "level",
  "ready",
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
}

const fresh = (): Draft => ({
  step: PICK_LANGUAGE ? "language" : "uses",
  lang: "nl",
  sources: [],
  decksInit: false,
  noAnki: false,
  usesAnki: null,
  move: true,
  profile: defaultProfile("nl"),
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
  const canAdd = useCanAddTexts();
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
  // With the 500 words, their screen is the last one: Start reading sits on it (mock MK4 A).
  const steps: Step[] = phoneAnki
    ? [...start, "apkg", "starter", "convert", "known"]
    : native
      ? [...start, "starter"]
      : draft.usesAnki === null
        ? [...start, "first"]
        : [
            ...start,
            "choice",
            "anki",
            "decks",
            "destinations",
            ...(moving
              ? (["moving", "convert", "known"] as const)
              : startFresh
                ? (["placement", "first"] as const)
                : (["first"] as const)),
          ];
  const at = Math.max(0, steps.indexOf(draft.step));
  const go = (step: Step) => setDraft({ step });
  // Relative to the overall order, so a step the current flow does not show (after an answer
  // changed the flow) still goes on forward, never back to the start.
  const rank = ORDER.indexOf(draft.step);
  const next = () => go(steps.find((s) => ORDER.indexOf(s) > rank) ?? "first");
  const back = () => go(steps.findLast((s) => ORDER.indexOf(s) < rank) ?? steps[0]!);

  const [server, setServer] = useState<"none" | "paired" | "on">("none");
  const onServerState = useCallback((s: "none" | "paired" | "on") => setServer(s), []);
  const finish = () => writeDraft(null);

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
    enabled: ["placement", "practise", "level"].includes(draft.step),
  });
  const [known, setKnown] = useState<Set<string>>(new Set());
  const placement = useMutation({
    mutationFn: () => services.savePlacement([...known]),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["learner"] });
      next();
    },
  });

  // ---- Native: the most common words, all levels, new cards from the first 500 (no level
  // question: Check your level in Words marks what you know, m5)
  const [added, setAdded] = useState<{ done: number; total: number } | null>(null);
  const starter = useMutation({
    mutationFn: async () => {
      // With sync set up (a phone joining a computer), bring the other devices' words in first:
      // the starter words they already have are then skipped, not added a second time.
      // At most 15 s: offline or slow, the words are added and compaction drops repeats later.
      if (sync.data?.place)
        await Promise.race([
          services.syncNow().catch(() => {}),
          new Promise((done) => setTimeout(done, 15_000)),
        ]);
      return services.addStarterLevels(
        {
          levels: Array.from({ length: STARTER_LEVELS }, (_, i) => i + 1),
          from: 1,
        },
        (done, total) => setAdded({ done, total }),
      );
    },
    onSuccess: async () => {
      for (const k of ["learner", "review", "words", "home"]) {
        await qc.invalidateQueries({ queryKey: [k] });
      }
      // Then try Practice once, and Check your level; an Anki user's reviews say what they know.
      if (phoneAnki) await afterAnkiImport();
      else go("practise");
    },
  });

  // ---- An Anki user: convert the words, then what the reviews say they know.
  const conversion = useAnkiConversion(draft.step === "convert");
  const { run: convert, progress: converting } = useConvert(false);
  // Nothing to convert: straight on to what you know.
  const afterAnkiImport = async () => {
    const c = await qc
      .fetchQuery({ queryKey: ["anki-conversion"], queryFn: () => services.ankiConversion() })
      .catch(() => null);
    go(c?.words ? "convert" : "known");
  };
  const levels = useLevelProgress(draft.step === "known");
  const fromReviews = useMemo((): LevelEstimate | null => {
    if (!levels.data) return null;
    const known = levels.data.reduce((n, p) => n + p.known, 0);
    if (known < 50) return null;
    return {
      words: Math.round(known / 100) * 100,
      band: starterBand(Math.max(1, Math.ceil(known / STARTER_LEVEL_SIZE))),
    };
  }, [levels.data]);

  // ---- Ready: the story at the learner's level opens in the reader (Read when there is none).
  const story = useQuery({
    queryKey: ["onboarding", "story"],
    queryFn: async () => storyToStart(await services.storyShelf()),
    enabled: ["first", "starter", "level", "ready", "convert", "known"].includes(draft.step),
  });
  const startReading = useMutation({
    mutationFn: async () => {
      // A quick tap can come before the shelf has loaded: wait for it, don't open Read instead.
      const start = story.data ?? storyToStart(await services.storyShelf());
      return start ? services.openStory(start.slug) : null;
    },
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

  // ---- The end: Check your level marks what you know, then the story opens.
  const checkWords = useMemo(() => (bands.data ? levelWords(bands.data) : []), [bands.data]);
  const [estimate, setEstimate] = useState<LevelEstimate | null>(null);
  const [marking, setMarking] = useState<Promise<unknown> | null>(null);
  const finishLevel = async () => {
    await marking?.catch(() => undefined);
    startReading.mutate();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.step === "uses") {
      if (draft.usesAnki === true && !phone) next();
      // No Anki (or a phone, where Anki decks come as a file): save the profile now
      // (Vuurtoren's cards, default decks) and go on.
      else if (draft.usesAnki !== null) save.mutate({});
    } else if (draft.step === "destinations") save.mutate({});
    else if (draft.step === "moving") {
      if (move.isSuccess) void afterAnkiImport();
      else if (!move.isPending) move.mutate();
    } else if (draft.step === "placement") placement.mutate();
    else if (draft.step === "starter") starter.mutate();
    else if (draft.step === "ready" || draft.step === "known") void finishLevel();
    else if (!["first", "practise", "level", "convert"].includes(draft.step)) next();
  };

  const errorOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");
  const root = rootDeck(draft.lang);

  return (
    <div className="ob-shell">
      <main className="ob-card">
        <div className="ob-brand">
          <Logo size={28} />
          <span className="beta-tag">Beta</span>
        </div>
        {/* OB8: a round back button, "Step 2 of 3" and one bar (the list is for screen readers). */}
        <div className="ob-top">
          {draft.step === "server" || (at > 0 && draft.step !== "first") ? (
            <button
              type="button"
              className="ob-back"
              aria-label="Back"
              onClick={back}
              disabled={starter.isPending}
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
          ) : null}
          <div className="ob-progress" aria-hidden>
            <span>
              Step {PART[draft.step] + 1} of {PARTS.length}
            </span>
            <i>
              <b style={{ width: `${((PART[draft.step] + 1) / PARTS.length) * 100}%` }} />
            </i>
          </div>
        </div>
        <ol className="ob-steps k-sr" aria-label="Setup steps">
          {PARTS.map((name, i) => (
            <li
              key={name}
              aria-current={i === PART[draft.step] ? "step" : undefined}
              data-done={i < PART[draft.step] || undefined}
            >
              <span className="k-sr">
                {i + 1}. {name}
              </span>
            </li>
          ))}
        </ol>
        {draft.step === "server" ? (
          <section aria-labelledby="ob-server-h">
            <h1 id="ob-server-h" ref={heading} tabIndex={-1}>
              Connect your phone
            </h1>
            <p className="ob-lede">Your phone needs a computer or a server to read new texts.</p>
            <ConnectYourServer onState={onServerState} />
            <div className="ob-nav">
              <span className="ob-nav-spacer" />
              <Button variant={server === "on" ? "primary" : "secondary"} onClick={next}>
                {server === "on" ? "Continue" : "Not now"}
              </Button>
            </div>
          </section>
        ) : (
          <form onSubmit={submit}>
            {draft.step === "language" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  Welcome to Vuurtoren
                </h1>
                <p className="ob-lede">
                  A few questions first. You can change everything later in Settings.
                </p>
                <LanguageChoice value={draft.lang} onChange={(lang) => setDraft({ lang })} />
              </>
            ) : null}

            {draft.step === "uses" ? (
              <>
                {/* One question, nothing to explain: Anki users know Anki, others don't need it. */}
                <h1 ref={heading} tabIndex={-1}>
                  Do you use Anki?
                </h1>
                {/* The answer is the button: Yes or No, low on the screen (mock MK4 A). */}
                <div className="ob-answers">
                  <Button
                    disabled={save.isPending}
                    onClick={() => {
                      if (phone) {
                        // A phone brings Anki decks in as a file: its cards are Vuurtoren's.
                        setDraft({ usesAnki: true });
                        save.mutate({ native: true });
                      } else setDraft({ usesAnki: true, step: "choice" });
                    }}
                  >
                    Yes
                  </Button>
                  <Button
                    variant="primary"
                    disabled={save.isPending}
                    onClick={() => {
                      setDraft({ usesAnki: false, sources: [], noAnki: false });
                      save.mutate({ native: true });
                    }}
                  >
                    No
                  </Button>
                </div>
              </>
            ) : null}

            {draft.step === "choice" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  Your Anki cards
                </h1>

                <fieldset className="ob-choices">
                  <legend className="k-sr">Who schedules your reviews</legend>
                  <Choice
                    name="move"
                    checked={draft.move}
                    onChange={() => setDraft({ move: true })}
                    title="Bring them into Vuurtoren"
                    sub="Your decks and their history come in once. Anki doesn’t change."
                  />
                  <Choice
                    name="move"
                    checked={!draft.move}
                    onChange={() => setDraft({ move: false })}
                    title="Keep using Anki"
                    sub="You review in Anki. Keep it open to send it new words."
                  />
                </fieldset>
              </>
            ) : null}

            {draft.step === "moving" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  Importing your decks
                </h1>

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
                  <p>This can take a minute.</p>
                )}
              </>
            ) : null}

            {draft.step === "anki" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  Connect Anki
                </h1>
                <p className="ob-lede">
                  Vuurtoren reads your decks through AnkiConnect while Anki is open.
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
                <p className="ob-lede">Tick the decks with your Dutch words.</p>
                {draft.noAnki || !connected ? (
                  <p className="ob-note">
                    Without Anki, Vuurtoren starts fresh: it creates {root} the first time you add a
                    word, and you can connect Anki later in Settings.
                  </p>
                ) : decks.isPending ? (
                  <p role="status">
                    <Spinner label="Looking at your decks" /> Looking at your decks…
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
                  In Anki, choose File → Export → Anki Deck Package (.apkg), with scheduling
                  information, and choose that file here.
                </p>
                <ImportPackage />
                <p className="ob-note">
                  No file at hand? Continue, and import it later in Settings → Your words.
                </p>
              </>
            ) : null}

            {draft.step === "destinations" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  Where new words go
                </h1>
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
                <p className="ob-lede">Tick the words you know. No cards are made for them.</p>
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
                  You start with the 500 most common words
                </h1>
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
                {/* A phone: the dictionary comes down now, and one yes or no for the recordings. */}
                <DictionaryPack autoStart />
                <RecordingsPack ask />
              </>
            ) : null}

            {draft.step === "convert" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  Make your Anki words Vuurtoren words?
                </h1>
                {conversion.data ? (
                  <>
                    <p className="ob-lede">
                      {conversion.data.words.toLocaleString("en")} of your notes are Dutch words
                      Vuurtoren knows.
                    </p>
                    <ul className="ob-result-list">
                      <li>Your reviews stay.</li>
                      <li>Vuurtoren&rsquo;s meaning, sentence and recordings.</li>
                      <li>Pictures stay.</li>
                    </ul>
                    <div className="ob-first-actions">
                      <Button
                        variant="primary"
                        disabled={convert.isPending}
                        onClick={() => convert.mutate(undefined, { onSuccess: () => go("known") })}
                      >
                        {convert.isPending ? <Spinner label="Converting" /> : null}
                        {convert.isPending && converting ? converting : "Yes, convert them"}
                      </Button>
                      <button
                        type="button"
                        className="ob-skip"
                        disabled={convert.isPending}
                        onClick={() => go("known")}
                      >
                        Keep my Anki cards
                      </button>
                    </div>
                    {convert.isError ? (
                      <p role="alert" className="error-text">
                        {errorOf(convert.error)}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <Spinner label="Looking at your words" />
                )}
              </>
            ) : null}

            {draft.step === "known" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  {fromReviews
                    ? `You know about ${fromReviews.words.toLocaleString("en")} words`
                    : "You start at A1"}
                </h1>
                {fromReviews ? (
                  <>
                    <p className="ob-lede">
                      From your Anki reviews. That&rsquo;s around {fromReviews.band}. Vuurtoren
                      will:
                    </p>
                    <LevelResult estimate={fromReviews} bars={false} />
                  </>
                ) : levels.isPending ? (
                  <Spinner label="Counting" />
                ) : null}
              </>
            ) : null}

            {draft.step === "practise" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  Practise what you read
                </h1>
                <p className="ob-lede">Three questions with your first words.</p>
                {bands.data ? (
                  <TryPractice bands={bands.data} onDone={() => go("level")} />
                ) : (
                  <Spinner label="Loading words" />
                )}
                <button type="button" className="ob-skip" onClick={() => go("level")}>
                  Skip
                </button>
              </>
            ) : null}

            {draft.step === "level" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  Do you know these?
                </h1>
                <p className="ob-lede">About 20 words.</p>
                {checkWords.length ? (
                  <LevelCheck
                    words={checkWords}
                    onDone={(knownWords) => {
                      setEstimate(estimateLevel(checkWords, knownWords));
                      // Marked like I know it in Words: those cards leave the review.
                      setMarking(
                        Promise.all(
                          // One word that can't be found (not in the dictionary) is skipped.
                          knownWords.map(async (w) => {
                            try {
                              await services.markKnown(await services.inspectWord(w.key));
                            } catch {
                              // Not found (not in the dictionary): this word is skipped.
                            }
                          }),
                        ).then(() =>
                          Promise.all(
                            ["learner", "review", "words", "home"].map((k) =>
                              qc.invalidateQueries({ queryKey: [k] }),
                            ),
                          ),
                        ),
                      );
                      go("ready");
                    }}
                  />
                ) : (
                  <Spinner label="Loading words" />
                )}
                {/* Skipped: Vuurtoren starts at A1, and Check your level stays in Words. */}
                <button
                  type="button"
                  className="ob-skip"
                  onClick={() => {
                    setEstimate(null);
                    go("ready");
                  }}
                >
                  Skip
                </button>
              </>
            ) : null}

            {draft.step === "ready" ? (
              <>
                <h1 ref={heading} tabIndex={-1}>
                  {estimate
                    ? `You know about ${estimate.words.toLocaleString("en")} words`
                    : "You start at A1"}
                </h1>
                {estimate ? (
                  <>
                    <p className="ob-lede">That&rsquo;s around {estimate.band}. Vuurtoren will:</p>
                    <LevelResult estimate={estimate} />
                  </>
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
                  Tap a word you don't know to see what it means.
                </p>
                {/* A phone: the dictionary comes down now, so meanings work without a server. */}
                <DictionaryPack autoStart />
                {/* Then one yes or no for the recordings (230 MB): never a big download unasked. */}
                <RecordingsPack ask />
                <div className="ob-first-actions">
                  <Button
                    variant="primary"
                    disabled={story.isPending || startReading.isPending}
                    onClick={() => startReading.mutate()}
                  >
                    {startReading.isPending ? <Spinner label="Opening the story" /> : null}
                    Start reading
                  </Button>
                  {canAdd ? (
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
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="ob-nav">
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
              {draft.step !== "first" &&
              draft.step !== "uses" &&
              draft.step !== "practise" &&
              draft.step !== "level" &&
              draft.step !== "convert" &&
              !(draft.step === "anki" && !connected) ? (
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    save.isPending ||
                    placement.isPending ||
                    starter.isPending ||
                    startReading.isPending ||
                    move.isPending ||
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
                        : draft.step === "starter"
                          ? "Next"
                          : draft.step === "ready" || draft.step === "known"
                            ? "Start reading"
                            : "Continue"}
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </main>
    </div>
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
  sub?: string;
}) {
  return (
    <label className="ob-choice">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="ob-radio" aria-hidden />
      <span>
        <span className="ob-choice-title">{title}</span>
        {sub ? <span className="ob-choice-sub">{sub}</span> : null}
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
