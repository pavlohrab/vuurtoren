/**
 * First-run onboarding (ADR 0010): language → connect Anki → confirm decks → where new words go
 * → (start fresh) placement check → first text. Skippable; the step and choices are kept in
 * localStorage so a reload resumes where the learner was. Nothing is written to Anki here.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { type LanguageProfile, type ProfileSource, defaultProfile, rootDeck } from "@app/core";
import { Button, Spinner, Logo } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { AnkiStatus } from "../../services/types.js";
import { AnkiConnectionHelp } from "../settings/AnkiSettings.js";
import { DeckChecklist, DestinationFields, LanguageChoice, deckRows } from "./deckParts.js";
import { SAMPLE_TEXT } from "./sample.js";
import { setSkipped } from "./skip.js";
import "./onboarding.css";
import { readLocalJSON, writeLocalJSON } from "../../storage/local.js";

const STORAGE = "kenning.onboarding";

type Step = "language" | "anki" | "decks" | "destinations" | "placement" | "first";
const LABEL: Record<Step, string> = {
  language: "Language",
  anki: "Anki",
  decks: "Decks",
  destinations: "New words",
  placement: "Quick check",
  first: "First text",
};

interface Draft {
  step: Step;
  lang: string;
  sources: ProfileSource[];
  /** Suggested decks were pre-ticked once (later visits keep the learner's choice). */
  decksInit: boolean;
  /** Continue without Anki or no decks: start fresh. */
  noAnki: boolean;
  profile: LanguageProfile;
}

const fresh = (): Draft => ({
  step: "language",
  lang: "nl",
  sources: [],
  decksInit: false,
  noAnki: false,
  profile: defaultProfile("nl"),
});

function readDraft(): Draft {
  const saved = readLocalJSON(STORAGE) as Partial<Draft> | undefined;
  return saved && typeof saved === "object" ? { ...fresh(), ...saved } : fresh();
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
  const steps: Step[] = [
    "language",
    "anki",
    "decks",
    "destinations",
    ...(startFresh ? (["placement"] as const) : []),
    "first",
  ];
  const at = Math.max(0, steps.indexOf(draft.step));
  const go = (step: Step) => setDraft({ step });
  const next = () => go(steps[at + 1] ?? "first");
  const back = () => go(steps[at - 1] ?? "language");

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
      const profile: LanguageProfile = {
        ...draft.profile,
        lang: draft.lang,
        sources: draft.sources,
        tags: [draft.lang],
      };
      await services.saveLanguageProfile(profile);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["languageProfile"] });
      await qc.invalidateQueries({ queryKey: ["deckChoices"] });
      next();
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
    if (draft.step === "destinations") save.mutate();
    else if (draft.step === "placement") placement.mutate();
    else if (draft.step !== "first") next();
  };

  const errorOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");
  const root = rootDeck(draft.lang);

  return (
    <div className="ob-shell">
      <main className="ob-card">
        <Logo size={28} className="ob-brand" />
        <ol className="ob-steps" aria-label="Setup steps">
          {steps.map((s, i) => (
            <li
              key={s}
              aria-current={s === draft.step ? "step" : undefined}
              data-done={i < at || undefined}
            >
              {i + 1}. {LABEL[s]}
            </li>
          ))}
        </ol>
        <form onSubmit={submit}>
          {draft.step === "language" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Welcome to Kenning
              </h1>
              <p className="ob-lede">
                Kenning helps you read real texts at the edge of what you know. Your Anki decks are
                its record of the words you know, so a few choices first. This takes about two
                minutes, and you can change everything later in Settings.
              </p>
              <LanguageChoice value={draft.lang} onChange={(lang) => setDraft({ lang })} />
            </>
          ) : null}

          {draft.step === "anki" ? (
            <>
              <h1 ref={heading} tabIndex={-1}>
                Connect Anki
              </h1>
              <p className="ob-lede">
                Kenning reads your decks through the AnkiConnect add-on while Anki is open. It only
                writes when you click a button such as Add to Anki.
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
                Decks Kenning reads
              </h1>
              <p className="ob-lede">
                Words in the decks you tick count as known or learning. Kenning suggests the decks
                that look like Dutch vocabulary; you decide.
              </p>
              {draft.noAnki || !connected ? (
                <p className="ob-note">
                  Without Anki, Kenning starts fresh: it creates {root} the first time you add a
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
                        Kenning creates {root} and fills it with the words you add while reading.
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
                When you add a word, Kenning creates a card in this deck. Every Add button shows the
                deck and lets you pick another one.
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
                Tick the words you know, so the first texts are not too easy or too hard. This stays
                in Kenning; nothing is added to Anki.
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
                  <h2>Import a text</h2>
                  <p>Paste an article, open a web page, or a PDF or photo of a page.</p>
                  <Button
                    variant="primary"
                    onClick={() => {
                      finish();
                      void navigate({ to: "/import" });
                    }}
                  >
                    Import a text
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
                Go to the library
              </button>
            ) : (
              <button type="button" className="ob-skip" onClick={skip}>
                Skip setup for now
              </button>
            )}
            {draft.step === "anki" && !connected ? (
              <Button
                onClick={() => {
                  setDraft({ noAnki: true, sources: [] });
                  go("decks");
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
                  (draft.step === "decks" && connected && !draft.noAnki && decks.isPending) ||
                  (draft.step === "destinations" && !draft.profile.destinations.default.trim())
                }
                onClick={() => {
                  if (draft.step === "anki") setDraft({ noAnki: false });
                }}
              >
                {draft.step === "destinations"
                  ? "Save and continue"
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
              Allow Kenning in Anki
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
