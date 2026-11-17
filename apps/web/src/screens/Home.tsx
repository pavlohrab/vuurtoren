/**
 * Home: the first screen. What to do today (continue reading, practise, send new words to Anki,
 * the current course unit) and how far you have come, built from the existing services.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Dumbbell,
  GraduationCap,
  ListChecks,
  MessagesSquare,
  Plus,
  Settings as SettingsIcon,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { CoverageMeter, Logo, ProgressRing, Skeleton } from "@app/ui";
import { readLastText } from "../lastText.js";
import { useServices } from "../services/context.js";
import type { TextListItem } from "../services/types.js";
import { CreateStoryButton } from "./StoryDialog.js";

/** Words per reader page (the reader's segment target, packages/core reading/segment.ts). */
export const WORDS_PER_PAGE = 150;
/** A learner's reading pace for a page with a few new words, in words per minute. */
const WORDS_PER_MINUTE = 70;

/** Dutch greeting for the time of day. */
export function greeting(hour: number): string {
  if (hour < 5 || hour >= 18) return "Goedenavond";
  if (hour < 12) return "Goedemorgen";
  return "Goedemiddag";
}

const fmt = (n: number) => n.toLocaleString("en");

/** The text to continue: the one opened last, else one in progress, else the best next one. */
export function pickContinue(
  texts: readonly TextListItem[],
  lastId: string | null,
): { text: TextListItem; started: boolean } | null {
  const last = texts.find((t) => t.id === lastId);
  if (last) return { text: last, started: last.lastSegment > 0 };
  const inProgress = texts.find((t) => t.lastSegment > 0);
  if (inProgress) return { text: inProgress, started: true };
  // Nothing started: the analysed text with the highest coverage is the gentlest start.
  const ranked = [...texts].sort((a, b) => (b.coverage ?? -1) - (a.coverage ?? -1));
  return ranked[0] ? { text: ranked[0], started: false } : null;
}

/** Reader pages of a text (estimate from its length) and the page to continue on. */
export function pagesOf(t: Pick<TextListItem, "wordCount" | "lastSegment">) {
  const pages = Math.max(1, Math.ceil(t.wordCount / WORDS_PER_PAGE));
  const page = Math.min(t.lastSegment + 1, pages);
  return { pages, page, done: Math.min(1, t.lastSegment / pages) };
}

/** Coverage of the library: analysed texts weighted by length. Null when nothing is analysed. */
export function libraryCoverage(texts: readonly TextListItem[]): number | null {
  let words = 0;
  let known = 0;
  for (const t of texts) {
    if (t.coverage === null) continue;
    words += t.wordCount;
    known += t.coverage * t.wordCount;
  }
  return words > 0 ? known / words : null;
}

export function Home() {
  const services = useServices();
  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const summary = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const practice = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
    staleTime: 60_000,
  });
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => services.courseList() });

  const list = texts.data ?? [];
  const cont = texts.data ? pickContinue(list, readLastText()) : null;
  // Words from the text in progress that are not in Anki yet ("Words from this text").
  const waiting = useQuery({
    queryKey: ["home", "waiting", cont?.text.id],
    queryFn: async () => {
      const items = await services.textWords(cont!.text.id);
      return items.filter((w) => w.entry.anki.status === "absent").length;
    },
    enabled: Boolean(cont?.started),
    staleTime: 60_000,
    retry: false,
  });

  const hello = greeting(new Date().getHours());
  const s = summary.data;
  const brandNew =
    texts.data !== undefined && list.length === 0 && s !== undefined && s.known + s.learning === 0;

  if (brandNew) return <Welcome hello={hello} />;

  const course = courses.data?.find((c) => c.continueUnit !== null);
  const due = practice.data?.due ?? 0;
  const coverage = libraryCoverage(list);

  return (
    <div className="page home">
      <header className="home-head">
        <div>
          <h1 className="home-hello">{hello}</h1>
          <p className="page-lede">
            {s && s.known > 0
              ? `You know ${fmt(s.known)} Dutch words. Here is a short plan for today.`
              : "Here is a short plan for today."}
          </p>
        </div>
        <div className="home-actions" role="group" aria-label="Quick actions">
          <Link to="/import" className="k-btn k-btn--secondary">
            <Plus size={16} aria-hidden /> Import
          </Link>
          <CreateStoryButton />
          <Link to="/talk" className="k-btn k-btn--secondary">
            <MessagesSquare size={16} aria-hidden /> Talk
          </Link>
        </div>
      </header>

      <div className="home-grid">
        <section className="home-card home-continue" aria-labelledby="home-continue-h">
          <h2 className="k-overline" id="home-continue-h">
            {cont?.started === false ? "Start reading" : "Continue reading"}
          </h2>
          {texts.isPending ? (
            <Skeleton style={{ height: 120 }} />
          ) : cont ? (
            <ContinueCard text={cont.text} started={cont.started} />
          ) : (
            <p className="home-muted">
              Your library is empty. <Link to="/import">Import a text</Link> to start reading.
            </p>
          )}
        </section>

        <section className="home-card home-plan" aria-labelledby="home-plan-h">
          <h2 className="k-overline" id="home-plan-h">
            Today
          </h2>
          <ol className="home-steps">
            {cont ? (
              <PlanStep
                icon={<BookOpen size={18} />}
                to={{ to: "/read/$textId", params: { textId: cont.text.id } }}
                label="Read one page"
                value={`~${Math.max(1, Math.round(Math.min(cont.text.wordCount, WORDS_PER_PAGE) / WORDS_PER_MINUTE))} min`}
              />
            ) : (
              <PlanStep
                icon={<Plus size={18} />}
                to={{ to: "/import" }}
                label="Add something to read"
                value="Import"
              />
            )}
            <PlanStep
              icon={<Dumbbell size={18} />}
              to={{ to: "/practice" }}
              label={due > 0 ? "Practise" : "Practise new words"}
              value={
                practice.isPending
                  ? "…"
                  : due > 0
                    ? `${fmt(due)} due`
                    : `${fmt(practice.data?.newAvailable ?? 0)} new`
              }
              tone={due > 0 ? "accent" : undefined}
            />
            {cont?.started && waiting.data ? (
              <PlanStep
                icon={<ListChecks size={18} />}
                to={{ to: "/read/$textId/words", params: { textId: cont.text.id } }}
                label="New words waiting to go to Anki"
                value={fmt(waiting.data)}
                tone="learn"
              />
            ) : null}
            {course && course.continueUnit !== null ? (
              <PlanStep
                icon={<GraduationCap size={18} />}
                to={{
                  to: "/courses/$courseId/$unit",
                  params: { courseId: course.course.id, unit: String(course.continueUnit) },
                }}
                label={`${course.course.title}`}
                value={`Unit ${course.continueUnit}`}
              />
            ) : null}
          </ol>
        </section>
        <section className="home-card home-known" aria-labelledby="home-known-h">
          <h2 className="k-overline" id="home-known-h">
            Your words
          </h2>
          {summary.isPending ? (
            <Skeleton style={{ height: 140 }} />
          ) : s ? (
            <div className="home-known-body">
              <ProgressRing
                value={coverage ?? 0}
                size={168}
                stroke={10}
                label="Share of your library you already know"
              >
                <span className="home-ring-num">
                  {coverage === null ? "–" : `${Math.round(coverage * 100)}%`}
                </span>
                <span className="home-ring-cap">of your library</span>
              </ProgressRing>
              <dl className="home-stats">
                <div>
                  <dt>Known</dt>
                  <dd className="home-stat--known">{fmt(s.known)}</dd>
                </div>
                <div>
                  <dt>Learning</dt>
                  <dd>{fmt(s.learning)}</dd>
                </div>
                {s.lastSync ? (
                  <div>
                    <dt title="Estimated from your Anki collection">Vocabulary</dt>
                    <dd>{fmt(s.vocabEstimate)}</dd>
                  </div>
                ) : null}
              </dl>
              <Link to="/progress" className="home-link">
                <TrendingUp size={14} aria-hidden /> Progress
              </Link>
            </div>
          ) : (
            <p className="home-muted">Your word counts could not be loaded.</p>
          )}
        </section>
      </div>
    </div>
  );
}

type StepTarget =
  | { to: "/read/$textId"; params: { textId: string } }
  | { to: "/read/$textId/words"; params: { textId: string } }
  | { to: "/courses/$courseId/$unit"; params: { courseId: string; unit: string } }
  | { to: "/practice" | "/import" };

function PlanStep({
  icon,
  to,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  to: StepTarget;
  label: string;
  value: string;
  tone?: "accent" | "learn" | undefined;
}) {
  return (
    <li>
      <Link {...(to as { to: "/practice" })} className="home-step" data-tone={tone}>
        <span className="home-step-icon" aria-hidden>
          {icon}
        </span>
        <span className="home-step-label">{label}</span>
        <span className="home-step-value">{value}</span>
        <ArrowRight size={16} className="home-step-go" aria-hidden />
      </Link>
    </li>
  );
}

function ContinueCard({ text, started }: { text: TextListItem; started: boolean }) {
  const { pages, page, done } = pagesOf(text);
  return (
    <div className="home-continue-body">
      <Link to="/read/$textId" params={{ textId: text.id }} className="home-continue-title">
        {text.title}
      </Link>
      <p className="home-muted">
        {started ? `Page ${page} of ${pages}` : `${pages} ${pages === 1 ? "page" : "pages"}`} ·{" "}
        {fmt(text.wordCount)} words
        {text.newTypes ? ` · ${fmt(text.newTypes)} new` : ""}
      </p>
      <div
        className="home-bar"
        role="progressbar"
        aria-label="Read so far"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(done * 100)}
      >
        <span style={{ transform: `scaleX(${done})` }} />
      </div>
      <div className="home-continue-foot">
        <CoverageMeter value={text.coverage} label="Whole text" />
        <Link to="/read/$textId" params={{ textId: text.id }} className="k-btn k-btn--primary">
          {started ? "Continue" : "Start"} <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/** A brand-new learner: no texts and no words yet. */
function Welcome({ hello }: { hello: string }) {
  return (
    <div className="page page--narrow home home-welcome">
      <Logo variant="mark" size={56} coverage={0.75} title="Kenning" />
      <h1 className="home-hello">{hello}</h1>
      <p className="page-lede">
        Kenning helps you read Dutch with the words you already know. Two steps to start:
      </p>
      <ol className="home-steps home-steps--welcome">
        <li>
          <Link to="/settings" className="home-step">
            <span className="home-step-icon" aria-hidden>
              <SettingsIcon size={18} />
            </span>
            <span className="home-step-label">
              Connect Anki
              <span className="home-step-hint">Your decks tell Kenning which words you know.</span>
            </span>
            <ArrowRight size={16} className="home-step-go" aria-hidden />
          </Link>
        </li>
        <li>
          <Link to="/import" className="home-step">
            <span className="home-step-icon" aria-hidden>
              <Plus size={18} />
            </span>
            <span className="home-step-label">
              Import a text
              <span className="home-step-hint">Paste an article, add a web page or a PDF.</span>
            </span>
            <ArrowRight size={16} className="home-step-go" aria-hidden />
          </Link>
        </li>
      </ol>
      <p className="home-muted">
        Not set up yet? <Link to="/welcome">Run the guided setup</Link>.
      </p>
    </div>
  );
}
