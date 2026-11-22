/**
 * Today, on top of Read: the text to continue (or a story at the learner's level to start with)
 * as one card with the page's primary button, and what is due today in Words as one row. Its
 * heading is for screen readers only. "Finish setting up" sits above it while there is no language profile.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, Check, Dumbbell, Layers } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Skeleton, TextCover, coverKind, useNativeMode } from "@app/ui";
import { readLastText } from "../../lastText.js";
import { useServices } from "../../services/context.js";
import { storyToStart } from "../../services/stories.js";
import { pickContinue, pagesOf } from "../../textPages.js";
import { plural } from "../../format.js";
import { useOpenStory, useStoryShelf } from "./StoriesShelf.js";
import "./today.css";

/** About how long the reviews take: four cards a minute, at least a minute. */
export function reviewMinutes(cards: number): number {
  return Math.max(1, Math.round(cards / 4));
}

const fmt = (n: number) => n.toLocaleString("en");
export function TodayStrip() {
  const services = useServices();
  const profile = useQuery({
    queryKey: ["languageProfile"],
    queryFn: () => services.languageProfile(),
    staleTime: Infinity,
  });
  return (
    <>
      {profile.data === null ? (
        <Link to="/welcome" className="today-setup">
          <span className="today-setup-title">Finish setting up</span>
          <span className="today-setup-hint">
            Two questions, and your first story is ready at your level.
          </span>
          <ArrowRight size={16} aria-hidden />
        </Link>
      ) : null}
      <section className="today" aria-labelledby="today-h">
        <h2 className="k-sr" id="today-h">
          Today
        </h2>
        <div className="today-row">
          <ContinueSlot />
          <ul className="today-steps" aria-label="Today">
            <ReviewStep />
          </ul>
        </div>
      </section>
    </>
  );
}

/** The text to continue, else a story at the learner's level, with the page's one primary. */
function ContinueSlot() {
  const services = useServices();
  const texts = useQuery({
    queryKey: ["texts"],
    queryFn: () => services.listTexts(),
    // Plans of older texts follow in the background: ask again until they are all there.
    refetchInterval: (q) => (q.state.data?.some((t) => t.planning) ? 1500 : false),
  });
  const stories = useStoryShelf();
  const openStory = useOpenStory();
  const cont = texts.data ? pickContinue(texts.data, readLastText()) : null;

  if (texts.isPending) return <Skeleton className="today-continue" style={{ height: 96 }} />;
  if (cont) {
    const t = cont.text;
    const { page, pages } = pagesOf(t);
    return (
      <div className="today-continue">
        <Link
          to="/read/$textId"
          params={{ textId: t.id }}
          className="today-cover"
          tabIndex={-1}
          aria-hidden
        >
          <TextCover
            title={t.title}
            kind={coverKind(t.sourceKind, t.sourceRef)}
            coverage={t.coverage}
            showLabel={false}
            size="sm"
          />
        </Link>
        <div className="today-continue-main">
          <span className="today-kicker">{cont.started ? "Continue reading" : "Next to read"}</span>
          <Link to="/read/$textId" params={{ textId: t.id }} className="today-text-title">
            {t.title}
          </Link>
          <span className="today-meta">
            {cont.started ? `Page ${page} of ${pages}` : plural(pages, "page")}
          </span>
        </div>
        <Link
          to="/read/$textId"
          params={{ textId: t.id }}
          className="k-btn k-btn--primary today-go"
        >
          {cont.started ? "Continue" : "Start reading"} <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    );
  }
  const story = stories.data ? storyToStart(stories.data) : null;
  if (stories.isPending) return <Skeleton className="today-continue" style={{ height: 96 }} />;
  if (!story) {
    return (
      <div className="today-continue">
        <span className="today-icon" aria-hidden>
          <BookOpen size={20} />
        </span>
        <div className="today-continue-main">
          <span className="today-kicker">Nothing open</span>
          <span className="today-meta">Pick a story below, or add a text of your own.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="today-continue">
      <span className="today-cover" aria-hidden>
        <TextCover title={story.title} kind="paste" showLabel={false} size="sm" />
      </span>
      <div className="today-continue-main">
        <span className="today-kicker">A story at your level · {story.level}</span>
        <span className="today-text-title">{story.title}</span>
        <span className="today-meta">
          {fmt(story.words)} words · you know {Math.round(story.coverage * 100)}%
        </span>
      </div>
      <Button
        variant="primary"
        className="today-go"
        disabled={openStory.isPending}
        onClick={() => openStory.mutate(story.slug)}
      >
        Start reading <ArrowRight size={16} aria-hidden />
      </Button>
    </div>
  );
}

/** Native: the cards due in Review and about how long they take. Connected: exercises due. */
function ReviewStep() {
  const services = useServices();
  const native = useNativeMode();
  const review = useQuery({
    queryKey: ["review", "overview"],
    queryFn: () => services.reviewOverview(),
    staleTime: 60_000,
    enabled: native,
  });
  const practice = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
    staleTime: 60_000,
    enabled: !native,
  });
  if (native) {
    if (!review.data) return <PendingStep />;
    const n = review.data.due + review.data.fresh;
    if (n === 0) return <DoneStep icon={<Layers size={16} />} text="Nothing due today" />;
    return (
      <Step
        to="/review"
        icon={<Layers size={16} />}
        text={`Due today · ${plural(n, "card")} · ~${reviewMinutes(n)} min`}
        go="Start"
      />
    );
  }
  if (!practice.data) return <PendingStep />;
  const due = practice.data.due;
  if (due === 0) return <DoneStep icon={<Dumbbell size={16} />} text="No exercises due" />;
  return (
    <Step
      to="/practice"
      icon={<Dumbbell size={16} />}
      text={`${plural(due, "exercise")} due`}
      go="Practise"
    />
  );
}

function Step({
  to,
  icon,
  text,
  go,
}: {
  to: "/review" | "/practice";
  icon: ReactNode;
  text: string;
  go: string;
}) {
  return (
    <li>
      <Link to={to} className="today-step">
        <span className="today-step-icon" aria-hidden>
          {icon}
        </span>
        <span className="today-step-text">{text}</span>
        <span className="today-step-go">
          {go} <ArrowRight size={14} aria-hidden />
        </span>
      </Link>
    </li>
  );
}

function DoneStep({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <li>
      <span className="today-step today-step--done">
        <span className="today-step-icon" aria-hidden>
          {icon}
        </span>
        <span className="today-step-text">{text}</span>
        <Check size={14} className="today-step-go" aria-hidden />
      </span>
    </li>
  );
}

function PendingStep() {
  return (
    <li>
      <Skeleton style={{ height: 20, margin: "12px 0" }} />
    </li>
  );
}
