/**
 * "Write a story": an AI-written text at your level, saved to Your texts (docs/ai.md, Stories).
 * The form is the last tab of Add text; a grammar topic page and a course unit link to it with
 * their topic or words preset. Shown only when an AI provider is configured (`useAIReady`).
 */
import { pct } from "../format.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { STORY_WORDS, estimateStoryTokens } from "@app/ai";
import { grammarTopic, grammarTopics } from "@app/content";
import { Button, Input, Spinner, useToast } from "@app/ui";
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

/** The search params of Add text that open "Write a story" with a preset. */
export function storySearch(preset: StoryPreset = {}) {
  return {
    tab: "story",
    ...(preset.topic ? { topic: preset.topic } : {}),
    ...(preset.grammarTopic ? { grammar: preset.grammarTopic } : {}),
    ...(preset.unit ? { course: preset.unit.courseId, unit: String(preset.unit.unitN) } : {}),
  };
}

/** A link to "Write a story" with a preset. Renders nothing without a configured provider. */
export function WriteStoryLink({
  preset = {},
  variant = "secondary",
}: {
  preset?: StoryPreset;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const ready = useAIReady();
  if (!ready) return null;
  return (
    <Link to="/import" search={storySearch(preset)} className={`k-btn k-btn--${variant}`}>
      <Sparkles size={16} aria-hidden /> Write a story
    </Link>
  );
}

const tokensText = (n: number) =>
  n >= 1000 ? `${(Math.round(n / 100) / 10).toLocaleString("en")}K` : String(n);

/** Learning and new words together stay under this share of the story. */
const MIX_MAX = 50;

type Focus = "learning" | "unit" | "grammar";

export function StoryForm({ preset = {} }: { preset?: StoryPreset }) {
  const services = useServices();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [length, setLength] = useState<StoryLength>("medium");
  const [style, setStyle] = useState<StoryStyle>("story");
  const [focus, setFocus] = useState<Focus>(
    preset.unit ? "unit" : preset.grammarTopic ? "grammar" : "learning",
  );
  const [grammarId, setGrammarId] = useState(preset.grammarTopic ?? "");
  const [ownTopic, setOwnTopic] = useState(Boolean(preset.topic));
  const [topic, setTopic] = useState(preset.topic ?? "");
  const [notes, setNotes] = useState("");
  // Percentages of the story's words; known words are the rest.
  const [learning, setLearning] = useState(15);
  const [fresh, setFresh] = useState(5);
  const [progress, setProgress] = useState<string | null>(null);
  // Two linked sliders: moving one past the 50% cap takes the room from the other.
  const setLearningPct = (v: number) => {
    setLearning(v);
    if (v + fresh > MIX_MAX) setFresh(MIX_MAX - v);
  };
  const setFreshPct = (v: number) => {
    setFresh(v);
    if (learning + v > MIX_MAX) setLearning(MIX_MAX - v);
  };
  const known = 100 - learning - fresh;

  const storyWords = STORY_WORDS[length];
  // About one learning word per three uses of the share, so each comes back a few times.
  const targetCount = Math.max(3, Math.min(20, Math.round((storyWords * learning) / 100 / 3)));
  const targetSource: StoryTargetSource | null =
    learning === 0
      ? null
      : focus === "unit" && preset.unit
        ? { kind: "unit", ...preset.unit }
        : { kind: "learn-now", limit: targetCount };
  const targets = useQuery({
    queryKey: ["story-targets", targetSource],
    queryFn: () => services.storyTargets(targetSource!),
    enabled: targetSource !== null,
  });
  const topicPage =
    (focus === "grammar" || (focus === "unit" && preset.grammarTopic)) && grammarId
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
          topic: ownTopic ? topic.trim() : "",
          length,
          style,
          targetWords: learning > 0 ? (targets.data ?? []) : [],
          mix: { learning: learning / 100, fresh: fresh / 100 },
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(topicPage ? { grammarTopic: topicPage.id } : {}),
        },
        setProgress,
      ),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["texts"] });
      toast(
        `Saved “${r.title}” to Your texts`,
        r.missingTargets.length
          ? `It does not use: ${r.missingTargets.join(", ")}.`
          : r.coverage !== null
            ? `You know about ${pct(r.coverage)} of its words.`
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
    <>
      <p className="k-hint import-story-lede">
        A new text written for your level, from words you know, with your learning words and a few
        new ones.
      </p>
      <form
        className="stack story-form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <fieldset className="practice-group">
          <legend className="k-label">Length</legend>
          <div className="practice-options">
            {LENGTHS.map((l) =>
              option(l.value, length, setLength, `${l.label} · ~${STORY_WORDS[l.value]} words`),
            )}
          </div>
        </fieldset>

        <fieldset className="practice-group">
          <legend className="k-label">Words in the story</legend>
          <div
            className="story-mix"
            role="img"
            aria-label={`${known}% known words, ${learning}% learning words, ${fresh}% new words`}
          >
            <span className="story-mix-known" style={{ flexBasis: `${known}%` }}>
              Known {known}%
            </span>
            {learning > 0 ? (
              <span className="story-mix-learning" style={{ flexBasis: `${learning}%` }}>
                {learning >= 10 ? `${learning}%` : ""}
              </span>
            ) : null}
            {fresh > 0 ? (
              <span className="story-mix-new" style={{ flexBasis: `${fresh}%` }}>
                {fresh >= 10 ? `${fresh}%` : ""}
              </span>
            ) : null}
          </div>
          <label className="story-slider">
            <span>
              Learning words <b>{learning}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={MIX_MAX}
              step={5}
              value={learning}
              disabled={create.isPending}
              onChange={(e) => setLearningPct(Number(e.target.value))}
            />
          </label>
          <label className="story-slider">
            <span>
              New words <b>{fresh}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={MIX_MAX}
              step={5}
              value={fresh}
              disabled={create.isPending}
              onChange={(e) => setFreshPct(Number(e.target.value))}
            />
          </label>
          <p className="k-hint" style={{ margin: 0 }}>
            About {Math.round((storyWords * known) / 100)} known,{" "}
            {Math.round((storyWords * learning) / 100)} learning and{" "}
            {Math.round((storyWords * fresh) / 100)} new words. Learning and new words together stay
            under {MIX_MAX}%.
          </p>
        </fieldset>

        <fieldset className="practice-group">
          <legend className="k-label">Focus</legend>
          <div className="practice-options">
            {option<Focus>("learning", focus, setFocus, "My learning words")}
            {preset.unit
              ? option<Focus>(
                  "unit",
                  focus,
                  setFocus,
                  preset.grammarTopic && grammarTopic(preset.grammarTopic)
                    ? `This unit's words and ${grammarTopic(preset.grammarTopic)?.title}`
                    : "This unit's words",
                )
              : null}
            {option<Focus>("grammar", focus, setFocus, "A grammar topic")}
          </div>
          {focus === "grammar" ? (
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
          {learning > 0 && targets.data?.length ? (
            <p className="k-hint" style={{ margin: 0 }}>
              Learning words it uses: {targets.data.join(", ")}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="practice-group">
          <legend className="k-label">Topic</legend>
          <div className="practice-options">
            <button
              type="button"
              className="practice-option"
              aria-pressed={!ownTopic}
              disabled={create.isPending}
              onClick={() => setOwnTopic(false)}
            >
              AI chooses
            </button>
            <button
              type="button"
              className="practice-option"
              aria-pressed={ownTopic}
              disabled={create.isPending}
              onClick={() => setOwnTopic(true)}
            >
              My topic
            </button>
          </div>
          {ownTopic ? (
            <Input
              label="Topic"
              value={topic}
              placeholder="A day at the market, a lost cat, …"
              disabled={create.isPending}
              onChange={(e) => setTopic(e.target.value)}
            />
          ) : null}
        </fieldset>

        <fieldset className="practice-group">
          <legend className="k-label">Kind of text</legend>
          <div className="practice-options">
            {STYLES.map((st) => option(st.value, style, setStyle, st.label))}
          </div>
        </fieldset>

        <label className="k-field">
          <span className="k-label">Anything else for the AI? (optional)</span>
          <textarea
            className="k-input story-notes"
            rows={2}
            value={notes}
            placeholder="Make it funny, set it in Amsterdam, …"
            disabled={create.isPending}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

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
        <div className="row">
          <Button
            type="submit"
            variant="primary"
            disabled={
              create.isPending || (focus === "grammar" && !topicPage) || (ownTopic && !topic.trim())
            }
          >
            {create.isPending ? <Spinner label="Writing" /> : null}
            Write the story
          </Button>
          {progress ? (
            <span className="k-hint" role="status">
              {progress}
            </span>
          ) : null}
        </div>
      </form>
    </>
  );
}
