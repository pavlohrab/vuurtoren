/**
 * "Create a story": an AI-written text at your level, saved to the Library (docs/ai.md, Stories).
 * Used from the Library, a grammar topic page and a course unit. The trigger is only shown when an
 * AI provider is configured (`useAIReady`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { STORY_WORDS, estimateStoryTokens } from "@app/ai";
import { grammarTopic, grammarTopics } from "@app/content";
import { Button, Dialog, Input, Spinner, useToast } from "@app/ui";
import type { StoryLength, StoryStyle, StoryTargetSource } from "../services/aiTypes.js";
import { useServices } from "../services/context.js";

const LENGTHS: { value: StoryLength; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];
const STYLES: { value: StoryStyle; label: string }[] = [
  { value: "story", label: "Story" },
  { value: "dialogue", label: "Dialogue" },
  { value: "news", label: "News" },
  { value: "letter", label: "Letter" },
];
/** Known words sent with the prompt (see liveAI createStory). */
const PROMPT_LEMMAS = 300;

type Source = "learn-now" | "unit" | "grammar" | "own";

export interface StoryPreset {
  topic?: string;
  /** Grammar topic page id: the story features it. */
  grammarTopic?: string;
  /** Course unit: its new words are the default targets. */
  unit?: { courseId: string; unitN: number };
}

/** True when an AI provider is configured (AI buttons are hidden otherwise). */
export function useAIReady(): boolean {
  const services = useServices();
  const q = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  return q.data?.configured === true;
}

/** Button + dialog. Renders nothing without a configured provider. */
export function CreateStoryButton({
  preset = {},
  variant = "secondary",
}: {
  preset?: StoryPreset;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const ready = useAIReady();
  const [open, setOpen] = useState(false);
  if (!ready) return null;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Sparkles size={16} aria-hidden /> Create a story
      </Button>
      {open ? <StoryDialog open={open} onOpenChange={setOpen} preset={preset} /> : null}
    </>
  );
}

const tokensText = (n: number) =>
  n >= 1000 ? `${(Math.round(n / 100) / 10).toLocaleString("en")}K` : String(n);

export function StoryDialog({
  open,
  onOpenChange,
  preset = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: StoryPreset;
}) {
  const services = useServices();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [topic, setTopic] = useState(preset.topic ?? "");
  const [length, setLength] = useState<StoryLength>("short");
  const [style, setStyle] = useState<StoryStyle>("story");
  const [source, setSource] = useState<Source>(
    preset.unit ? "unit" : preset.grammarTopic ? "grammar" : "learn-now",
  );
  const [grammarId, setGrammarId] = useState(preset.grammarTopic ?? "");
  const [ownWords, setOwnWords] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const pickSource = (s: Source) => {
    setSource(s);
    setOwnWords(null);
  };

  const targetSource: StoryTargetSource | null =
    source === "learn-now"
      ? { kind: "learn-now" }
      : source === "unit" && preset.unit
        ? { kind: "unit", ...preset.unit }
        : null;
  const suggested = useQuery({
    queryKey: ["story-targets", targetSource],
    queryFn: () => services.storyTargets(targetSource!),
    enabled: targetSource !== null,
  });
  const words = (
    ownWords ?? (source === "own" || source === "grammar" ? "" : (suggested.data ?? []).join(", "))
  )
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
  // A unit's story also features the unit's main grammar point (preset from its texts).
  const topicPage =
    (source === "grammar" || (source === "unit" && preset.grammarTopic)) && grammarId
      ? grammarTopic(grammarId)
      : undefined;

  const est = estimateStoryTokens({
    length,
    knownLemmas: Array.from({ length: PROMPT_LEMMAS }, () => ""),
  });

  const create = useMutation({
    mutationFn: () =>
      services.createStory(
        {
          topic: topic.trim() || topicPage?.title || "everyday life",
          length,
          style,
          targetWords: words,
          ...(topicPage ? { grammarTopic: topicPage.id } : {}),
        },
        setProgress,
      ),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["texts"] });
      onOpenChange(false);
      toast(
        `Saved “${r.title}” to your library`,
        r.missingTargets.length
          ? `It does not use: ${r.missingTargets.join(", ")}.`
          : r.coverage !== null
            ? `You know about ${Math.round(r.coverage * 100)}% of its words.`
            : undefined,
      );
      void navigate({ to: "/read/$textId", params: { textId: r.textId } });
    },
    onSettled: () => setProgress(null),
  });

  const option = <T extends string>(value: T, current: T, set: (v: T) => void, label: string) => (
    <button
      key={value}
      type="button"
      className="practice-option"
      aria-pressed={value === current}
      disabled={create.isPending}
      onClick={() => set(value)}
    >
      {label}
    </button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!create.isPending) onOpenChange(o);
      }}
      title="Create a story"
      description="A new text written for you, kept to words you know, with a few words to learn."
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Input
          label="Topic"
          value={topic}
          placeholder="A day at the market, a lost cat, ..."
          disabled={create.isPending}
          onChange={(e) => setTopic(e.target.value)}
        />
        <fieldset className="practice-group">
          <legend className="k-label">Length</legend>
          <div className="practice-options">
            {LENGTHS.map((l) =>
              option(l.value, length, setLength, `${l.label} (~${STORY_WORDS[l.value]} words)`),
            )}
          </div>
        </fieldset>
        <fieldset className="practice-group">
          <legend className="k-label">Kind of text</legend>
          <div className="practice-options">
            {STYLES.map((s) => option(s.value, style, setStyle, s.label))}
          </div>
        </fieldset>
        <fieldset className="practice-group">
          <legend className="k-label">Focus</legend>
          <div className="practice-options">
            {option<Source>("learn-now", source, pickSource, "Words to learn now")}
            {preset.unit
              ? option<Source>(
                  "unit",
                  source,
                  pickSource,
                  preset.grammarTopic && grammarTopic(preset.grammarTopic)
                    ? `This unit's new words and ${grammarTopic(preset.grammarTopic)?.title}`
                    : "This unit's new words",
                )
              : null}
            {option<Source>("grammar", source, pickSource, "A grammar topic")}
            {option<Source>("own", source, pickSource, "My own words")}
          </div>
        </fieldset>
        {source === "grammar" ? (
          <label className="k-field">
            <span className="k-label">Grammar topic</span>
            <select
              className="k-input"
              value={grammarId}
              disabled={create.isPending}
              onChange={(e) => setGrammarId(e.target.value)}
            >
              <option value="">Choose a topic</option>
              {grammarTopics().map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.level})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Input
          label="Words to use"
          value={ownWords ?? words.join(", ")}
          placeholder={source === "grammar" ? "Optional" : "Comma separated"}
          hint="Up to 10. The story uses each of them; the check tells you if one is missing."
          disabled={create.isPending}
          onChange={(e) => setOwnWords(e.target.value)}
        />
        <p className="k-hint" style={{ margin: 0 }}>
          About {tokensText(est.input)} tokens in and {tokensText(est.output)} out (with one
          rewrite): well under a cent on small models, a few cents on larger ones. Your key, your
          provider; about {PROMPT_LEMMAS} of your known words are sent with the request.
        </p>
        {create.isError ? (
          <p role="alert" className="error-text" style={{ margin: 0 }}>
            {create.error instanceof Error ? create.error.message : String(create.error)}
          </p>
        ) : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {progress ? (
            <span className="k-hint" role="status" style={{ marginRight: "auto" }}>
              {progress}
            </span>
          ) : null}
          <Button type="button" disabled={create.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || (source === "grammar" && !topicPage)}
          >
            {create.isPending ? <Spinner label="Writing" /> : null}
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
