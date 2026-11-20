/**
 * Home: the first screen. What to do today (continue reading, practise, send new words to Anki,
 * the current course unit), the words to learn now, the week so far, recent texts, a grammar
 * topic from your texts and a Talk prompt, plus how far you have come. Built from the existing
 * services, each tile with its own empty state.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  BookText,
  Check,
  ClipboardCheck,
  Dumbbell,
  GraduationCap,
  Layers,
  ListChecks,
  MessagesSquare,
  Plus,
  Settings as SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { A2_EXAM, grammarTopics } from "@app/content";
import {
  Chip,
  Logo,
  ProgressRing,
  Skeleton,
  TextCover,
  coverKind,
  difficultyBand,
  useNativeMode,
} from "@app/ui";
import { readLastText } from "../lastText.js";
import { useServices } from "../services/context.js";
import { activeDays, type ActivityDay } from "../services/activity.js";
import type { TextListItem, TextWordItem } from "../services/types.js";
import type { ExamAttemptRecord } from "../services/examTypes.js";
import { usePageHeader } from "../shell/ShellContext.js";
import { PageHeader, SectionHeader } from "../shell/PageHeader.js";
import { pct, plural } from "../format.js";
import { pagesOf, pickContinue, WORDS_PER_PAGE } from "../textPages.js";
import { useWordInspector } from "./useWordInspector.js";
import { topicCount } from "./grammar/Grammar.js";

export { pagesOf, pickContinue, WORDS_PER_PAGE };

/** Dutch greeting for the time of day. */
export function greeting(hour: number): string {
  if (hour < 5 || hour >= 18) return "Goedenavond";
  if (hour < 12) return "Goedemorgen";
  return "Goedemiddag";
}

const fmt = (n: number) => n.toLocaleString("en");

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

/**
 * Words to learn now from a text: its words (`textWords`) without a card yet or with a card
 * not studied yet, the highlighted and looked-up ones first.
 */
export function wordsToLearn(items: readonly TextWordItem[], max = 8): TextWordItem[] {
  const open = items.filter(
    (w) => w.entry.anki.status === "absent" || w.entry.anki.status === "new",
  );
  return [
    ...open.filter((w) => w.source !== "gloss"),
    ...open.filter((w) => w.source === "gloss"),
  ].slice(0, max);
}

/** A line of text to show from where the learner left off: whole words, about two lines. */
export function excerptAt(content: string, start: number, max = 220): string {
  const rest = content.slice(start).replace(/\s+/g, " ").trim();
  if (rest.length <= max) return rest;
  const cut = rest.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)) || cut}…`;
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function Home() {
  const services = useServices();
  const inspector = useWordInspector("reading");
  // The top bar shows today's date: the page's own heading is the greeting.
  usePageHeader(DATE_FMT.format(new Date()), { always: true });
  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const summary = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const practice = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
    staleTime: 60_000,
  });
  const review = useQuery({
    queryKey: ["review", "overview"],
    queryFn: () => services.reviewOverview(),
    staleTime: 60_000,
  });
  const native = review.data?.native === true;
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => services.courseList() });
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: () => services.activity(7),
    staleTime: 60_000,
    retry: false,
  });
  const list = texts.data ?? [];
  const cont = texts.data ? pickContinue(list, readLastText()) : null;
  const contId = cont?.text.id;
  const reading = useQuery({
    queryKey: ["reading", contId],
    queryFn: () => services.getReading(contId!),
    enabled: Boolean(contId),
    staleTime: 60_000,
    retry: false,
  });
  // Words from the text in progress (amber words and look-ups), with their Anki state.
  const textWords = useQuery({
    queryKey: ["home", "textWords", contId],
    queryFn: () => services.textWords(contId!),
    enabled: Boolean(contId),
    staleTime: 60_000,
    retry: false,
  });

  // Top the list up with words met while reading elsewhere (seen, then new), when the text in
  // progress has only a few.
  const fromText = textWords.data ? wordsToLearn(textWords.data) : null;
  const more = useQuery({
    queryKey: ["home", "moreWords"],
    queryFn: async () => [
      ...(await services.words({ state: "seen", limit: 8 })),
      ...(await services.words({ state: "unknown", limit: 8 })),
    ],
    enabled: fromText !== null && fromText.length < 6,
    staleTime: 60_000,
    retry: false,
  });

  const hello = greeting(new Date().getHours());
  const s = summary.data;
  const brandNew =
    texts.data !== undefined && list.length === 0 && s !== undefined && s.known + s.learning === 0;
  if (brandNew) return <Welcome hello={hello} />;

  // The last day of the strip is today.
  const today = activity.data?.at(-1);
  const learn = fromText;
  const extra = (more.data ?? [])
    .filter((w) => !(learn ?? []).some((l) => l.key === w.key))
    .slice(0, Math.max(0, 8 - (learn?.length ?? 0)));
  const waiting = textWords.data?.filter((w) => w.entry.anki.status === "absent").length;

  const learnWords = (learn ?? []).slice(0, 3).map((w) => w.lemma);

  return (
    <div className="page home">
      <PageHeader
        title={hello}
        lede={
          s && s.known > 0
            ? `You know ${fmt(s.known)} Dutch words. Here is a short plan for today.`
            : "Here is a short plan for today."
        }
        actions={
          <>
            <Link to="/import" className="k-btn k-btn--secondary">
              <Plus size={16} aria-hidden /> Add text
            </Link>
          </>
        }
      />

      <div className="home-hero">
        <section className="home-reading" aria-labelledby="home-continue-h">
          <h2 className="home-kicker" id="home-continue-h">
            {cont?.started === false ? "Next to read" : "Continue reading"}
          </h2>
          {texts.isPending ? (
            <Skeleton style={{ height: 224 }} />
          ) : cont ? (
            <ContinueCard
              text={cont.text}
              started={cont.started}
              excerpt={
                reading.data
                  ? excerptAt(
                      reading.data.text.content,
                      reading.data.plans[
                        Math.min(cont.text.lastSegment, reading.data.plans.length - 1)
                      ]?.segment.charStart ?? 0,
                    )
                  : reading.isError
                    ? ""
                    : null
              }
            />
          ) : (
            <Empty
              text="Your Library is empty. Add an article, a web page or a PDF to start reading."
              action={
                <Link to="/import" className="k-btn k-btn--primary">
                  <Plus size={16} aria-hidden /> Add text
                </Link>
              }
            />
          )}
        </section>

        <section className="home-known" aria-labelledby="home-known-h">
          <h2 className="home-kicker" id="home-known-h">
            Your words
          </h2>
          {summary.isPending || texts.isPending ? (
            <Skeleton style={{ height: 180 }} />
          ) : s ? (
            <KnownWords
              coverage={libraryCoverage(list)}
              known={s.known}
              learning={s.learning}
              vocab={s.lastSync || s.native ? s.vocabEstimate : null}
            />
          ) : (
            <Empty text="Your word counts could not be loaded." />
          )}
        </section>
      </div>

      <section className="k-section home-today" aria-labelledby="home-plan-h">
        <SectionHeader id="home-plan-h" title="Today" />
        <ol className="home-steps">
          {native && review.data ? (
            <ReviewStep due={review.data.due} fresh={review.data.fresh} />
          ) : null}
          <PracticeStep
            due={practice.data?.due}
            fresh={practice.data?.newAvailable ?? 0}
            answered={today?.exercises ?? 0}
          />
          {cont && waiting ? (
            <PlanStep
              icon={<ListChecks size={16} />}
              to={{ to: "/read/$textId/words", params: { textId: cont.text.id } }}
              label={native ? "New words to decide on" : "New words waiting for Anki"}
              value={`${fmt(waiting)} to decide`}
              tone="learn"
            />
          ) : today?.added ? (
            <DoneStep
              label={native ? "Words added" : "Words added to Anki"}
              value={fmt(today.added)}
            />
          ) : null}
          {today?.pages ? (
            <DoneStep
              label="Read today"
              value={`${fmt(today.pages)} ${today.pages === 1 ? "page" : "pages"}`}
            />
          ) : null}
          <CourseStep course={courses.data?.find((c) => c.continueUnit !== null)} />
          <ExamStep />
        </ol>
      </section>

      <div className="k-section home-row">
        <section className="home-learn" aria-labelledby="home-learn-h">
          <SectionHeader
            id="home-learn-h"
            title="Words to learn now"
            action={
              cont && learn?.length ? (
                <Link to="/words" search={{ source: `text:${cont.text.id}` }} className="k-link">
                  All words <ArrowRight size={14} aria-hidden />
                </Link>
              ) : null
            }
          />
          {textWords.isPending && contId ? (
            <Skeleton style={{ height: 96 }} />
          ) : cont && learn && learn.length + extra.length > 0 ? (
            <>
              <ul className="home-words" aria-label="Words to learn now">
                {learn.map((w) => (
                  <li key={w.key}>
                    <button
                      type="button"
                      className="k-word-chip"
                      title={w.glosses[0] ?? undefined}
                      lang="nl"
                      aria-pressed={inspector.current === w.key}
                      onClick={(e) => inspector.openKey(w.key, e.currentTarget)}
                    >
                      {w.article && w.pos === "NOUN" ? (
                        <span className="k-word-art">{w.article}</span>
                      ) : null}
                      {w.lemma}
                    </button>
                  </li>
                ))}
                {extra.map((w) => (
                  <li key={w.key}>
                    <button
                      type="button"
                      className="k-word-chip k-word-chip--quiet"
                      title={w.gloss ?? undefined}
                      lang="nl"
                      aria-pressed={inspector.current === w.key}
                      onClick={(e) => inspector.openKey(w.key, e.currentTarget)}
                    >
                      {w.article ? <span className="k-word-art">{w.article}</span> : null}
                      {w.key}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="home-note">
                From {cont.text.title}
                {extra.length ? " and your other reading" : ""}. Open a word to add it to Anki or
                mark it known.
              </p>
            </>
          ) : (
            <Empty text="No new words waiting. Words you meet while reading show up here." />
          )}
        </section>

        <section className="home-recent" aria-labelledby="home-recent-h">
          <SectionHeader
            id="home-recent-h"
            title="Recent texts"
            action={
              list.length > 0 ? (
                <Link to="/library" className="k-link">
                  Library <ArrowRight size={14} aria-hidden />
                </Link>
              ) : null
            }
          />
          <RecentTexts texts={list} skip={contId} />
        </section>
      </div>

      <section className="k-section home-more" aria-labelledby="home-more-h">
        <SectionHeader id="home-more-h" title="More for today" />
        <ul className="home-more-list">
          <li>
            <GrammarSuggestion />
          </li>
          <li>
            <TalkPrompt words={learnWords} topic={cont?.text.title} />
          </li>
          <li>
            <WeekLine days={activity.data} pending={activity.isPending} />
          </li>
        </ul>
      </section>
      {inspector.portal}
    </div>
  );
}

function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="home-empty">
      <p>{text}</p>
      {action}
    </div>
  );
}

type StepTarget =
  | { to: "/read/$textId"; params: { textId: string } }
  | { to: "/read/$textId/words"; params: { textId: string } }
  | { to: "/courses/$courseId/$unit"; params: { courseId: string; unit: string } }
  | { to: "/exam/$part"; params: { part: string } }
  | { to: "/practice" | "/import" | "/review" };

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
        <span className="home-step-main">
          <span className="home-step-label">{label}</span>
          <span className="home-step-value">{value}</span>
        </span>
        <ArrowRight size={16} className="home-step-go" aria-hidden />
      </Link>
    </li>
  );
}

/** A step already done today: a check instead of a link. */
function DoneStep({ label, value }: { label: string; value: string }) {
  return (
    <li>
      <div className="home-step home-step--done">
        <span className="home-step-icon" aria-hidden>
          <Check size={16} />
        </span>
        <span className="home-step-main">
          <span className="home-step-label">
            {label}
            <span className="k-sr"> (done)</span>
          </span>
          <span className="home-step-value">{value}</span>
        </span>
      </div>
    </li>
  );
}

/** Native mode: the cards due today in Review. */
function ReviewStep({ due, fresh }: { due: number; fresh: number }) {
  const total = due + fresh;
  if (total === 0) return <DoneStep label="Reviews" value="Nothing due" />;
  return (
    <PlanStep
      icon={<Layers size={16} />}
      to={{ to: "/review" }}
      label="Review"
      value={`${fmt(due)} due${fresh ? ` · ${fmt(fresh)} new` : ""}`}
      tone="accent"
    />
  );
}

function PracticeStep({
  due,
  fresh,
  answered,
}: {
  due: number | undefined;
  fresh: number;
  answered: number;
}) {
  if (due === undefined) {
    return (
      <PlanStep icon={<Dumbbell size={16} />} to={{ to: "/practice" }} label="Practise" value="…" />
    );
  }
  if (due > 0) {
    return (
      <PlanStep
        icon={<Dumbbell size={16} />}
        to={{ to: "/practice" }}
        label="Practise"
        value={`${fmt(due)} ${due === 1 ? "exercise" : "exercises"} due`}
        tone="accent"
      />
    );
  }
  if (answered > 0) return <DoneStep label="Practised today" value={`${fmt(answered)} answered`} />;
  return (
    <PlanStep
      icon={<Dumbbell size={16} />}
      to={{ to: "/practice" }}
      label="Practise new words"
      value={`${fmt(fresh)} new`}
    />
  );
}

/**
 * The exam part to work on next: the first part never tried, else the part with the weakest
 * latest result. Null before the learner has started exam preparation.
 */
export function examNextStep(
  attempts: readonly ExamAttemptRecord[],
  now = Date.now(),
): { part: string; label: string; doneToday: number } | null {
  if (attempts.length === 0) return null;
  const today = new Date(now).toDateString();
  const doneToday = attempts.filter((a) => new Date(a.at).toDateString() === today).length;
  const latest = new Map<string, ExamAttemptRecord>();
  for (const a of attempts) latest.set(a.part, a);
  const untried = A2_EXAM.parts.find((p) => !latest.has(p.part));
  if (untried) return { part: untried.part, label: `Try ${untried.nl}`, doneToday };
  const weakest = A2_EXAM.parts
    .map((p) => {
      const a = latest.get(p.part)!;
      return { p, share: a.total ? a.correct / a.total : 0 };
    })
    .sort((x, y) => x.share - y.share)[0]!;
  return { part: weakest.p.part, label: `Practise ${weakest.p.nl}`, doneToday };
}

/** "Exam prep" in Today, once the learner has started preparing (see /exam). */
function ExamStep() {
  const services = useServices();
  const attempts = useQuery({
    queryKey: ["exam", "attempts"],
    queryFn: () => services.examAttempts(),
    staleTime: 30_000,
  });
  const next = examNextStep(attempts.data ?? []);
  if (!next) return null;
  if (next.doneToday > 0) {
    return (
      <DoneStep
        label="Exam prep today"
        value={`${fmt(next.doneToday)} ${next.doneToday === 1 ? "session" : "sessions"}`}
      />
    );
  }
  return (
    <PlanStep
      icon={<ClipboardCheck size={16} />}
      to={{ to: "/exam/$part", params: { part: next.part } }}
      label="Exam prep"
      value={next.label}
    />
  );
}

function CourseStep({
  course,
}: {
  course:
    | {
        course: { id: string; title: string };
        continueUnit: number | null;
        continueTitle?: string;
        continueKnown?: number | null;
      }
    | undefined;
}) {
  if (!course || course.continueUnit === null) return null;
  return (
    <PlanStep
      icon={<GraduationCap size={16} />}
      to={{
        to: "/courses/$courseId/$unit",
        params: { courseId: course.course.id, unit: String(course.continueUnit) },
      }}
      label={course.course.title}
      value={
        (course.continueTitle ?? `Unit ${course.continueUnit}`) +
        (course.continueKnown != null ? ` · ${pct(course.continueKnown)} of its words known` : "")
      }
    />
  );
}

function ContinueCard({
  text,
  started,
  excerpt,
}: {
  text: TextListItem;
  started: boolean;
  /** Null while loading; "" when it cannot be shown. */
  excerpt: string | null;
}) {
  const { pages, page, done } = pagesOf(text);
  const band = text.coverage !== null ? difficultyBand(text.coverage) : null;
  return (
    <div className="home-continue">
      <Link
        to="/read/$textId"
        params={{ textId: text.id }}
        className="home-continue-cover"
        tabIndex={-1}
        aria-hidden
      >
        <TextCover title={text.title} kind={coverKind(text.sourceKind, text.sourceRef)} />
      </Link>
      <div className="home-continue-main">
        <Link to="/read/$textId" params={{ textId: text.id }} className="home-continue-title">
          {text.title}
        </Link>
        <p className="home-meta">
          <span>{started ? `Page ${page} of ${pages}` : `${plural(pages, "page")}`}</span>
          <span>{fmt(text.wordCount)} words</span>
          {text.newTypes ? <span>{fmt(text.newTypes)} new</span> : null}
          {text.coverage !== null ? (
            <Chip
              tone={band === "comfortable" ? "success" : "warm"}
              title="Share of the words in this text you know"
            >
              {pct(text.coverage)} known
            </Chip>
          ) : null}
        </p>
        {excerpt ? (
          <p className="home-excerpt" lang="nl">
            {excerpt}
          </p>
        ) : excerpt === null ? (
          <Skeleton style={{ height: 52 }} />
        ) : null}
        <div className="home-progress" hidden={!started}>
          <div
            className="home-bar"
            role="progressbar"
            aria-label="Pages read"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(done * 100)}
          >
            <span style={{ transform: `scaleX(${done})` }} />
          </div>
          <span className="home-bar-label">{pct(done)} read</span>
        </div>
        <div className="home-continue-foot">
          <Link to="/read/$textId" params={{ textId: text.id }} className="k-btn k-btn--primary">
            {started ? "Continue" : "Start reading"} <ArrowRight size={16} aria-hidden />
          </Link>
          {started ? null : (
            <span className="home-bar-label">
              About {Math.max(1, Math.round(text.wordCount / 70))} min
            </span>
          )}
          <Link to="/library" className="k-link home-other">
            Not this one? Library <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}

function KnownWords({
  coverage,
  known,
  learning,
  vocab,
}: {
  coverage: number | null;
  known: number;
  learning: number;
  vocab: number | null;
}) {
  const native = useNativeMode();
  return (
    <div className="home-known-body">
      <div className="home-known-top">
        <ProgressRing
          value={coverage ?? 0}
          size={88}
          stroke={7}
          label="Share of the words in your texts you already know"
        >
          <span className="home-ring-num k-num">{coverage === null ? "–" : pct(coverage)}</span>
        </ProgressRing>
        <p className="home-known-caption">
          {coverage === null
            ? "Add a text to see how much of it you already know."
            : `You know ${pct(coverage)} of the words in your texts.`}
        </p>
      </div>
      <dl className="k-stats home-stats">
        <div>
          <dt>Known</dt>
          <dd className="k-num home-stat--known">
            <Link to="/words" search={{ state: "known" }}>
              {fmt(known)}
            </Link>
          </dd>
        </div>
        <div>
          <dt>Learning</dt>
          <dd className="k-num">
            <Link to="/words" search={{ state: "learning" }}>
              {fmt(learning)}
            </Link>
          </dd>
        </div>
        <div>
          <dt title={native ? "Estimated from your words" : "Estimated from your Anki collection"}>
            Vocabulary
          </dt>
          <dd className="k-num">{vocab === null ? "–" : fmt(vocab)}</dd>
        </div>
      </dl>
      <Link to="/progress" className="k-link">
        View progress <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

/** This week in one quiet line (no streak guilt), linking to Progress. */
function WeekLine({ days, pending }: { days: ActivityDay[] | undefined; pending: boolean }) {
  const sum = (k: "pages" | "exercises" | "added" | "reviews") =>
    (days ?? []).reduce((n, d) => n + d[k], 0);
  const reviews = sum("reviews");
  return (
    <section className="home-more-item" aria-labelledby="home-week-h">
      <h3 className="home-more-label" id="home-week-h">
        This week
      </h3>
      {pending ? (
        <Skeleton style={{ height: 20 }} />
      ) : days ? (
        <Link to="/progress" className="home-more-link">
          <span className="home-days" aria-hidden>
            {days.map((d) => (
              <span
                key={d.date}
                data-on={d.pages + d.exercises + d.added + d.reviews > 0 || undefined}
              />
            ))}
          </span>
          {activeDays(days)} of 7 days active · {fmt(sum("pages"))} pages · {fmt(sum("exercises"))}{" "}
          exercises{reviews ? ` · ${fmt(reviews)} reviews` : ""}
        </Link>
      ) : (
        <p className="home-more-text">Your activity could not be loaded.</p>
      )}
    </section>
  );
}

function RecentTexts({ texts, skip }: { texts: TextListItem[]; skip: string | undefined }) {
  const recent = [...texts]
    .filter((t) => t.id !== skip)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3);
  if (recent.length === 0) {
    return (
      <Empty
        text="Texts you add show up here as a small shelf."
        action={
          <Link to="/import" className="k-link">
            <Plus size={14} aria-hidden /> Add text
          </Link>
        }
      />
    );
  }
  return (
    <ul className="home-shelf">
      {recent.map((t) => (
        <li key={t.id}>
          <Link
            to="/read/$textId"
            params={{ textId: t.id }}
            className="home-shelf-item"
            aria-label={`${t.title}${t.coverage === null ? "" : `, ${pct(t.coverage)} known`}`}
          >
            <TextCover
              title={t.title}
              kind={coverKind(t.sourceKind, t.sourceRef)}
              coverage={t.coverage}
              showPercent
              showLabel={false}
              size="sm"
            />
            <span className="home-shelf-meta">
              {t.lastSegment > 0
                ? `Page ${pagesOf(t).page} of ${pagesOf(t).pages}`
                : `${fmt(t.wordCount)} words`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The grammar topic seen most in the learner's texts, with a link to its page. */
function GrammarSuggestion() {
  const services = useServices();
  const overview = useQuery({
    queryKey: ["grammar", "overview"],
    queryFn: () => services.grammarOverview(),
    staleTime: 60_000,
    retry: false,
  });
  let best: { id: string; title: string; hits: number; texts: number } | null = null;
  for (const topic of overview.data ? grammarTopics() : []) {
    const c = topicCount(topic, overview.data);
    if (c && c.hits > 0 && (!best || c.hits > best.hits)) {
      best = { id: topic.id, title: topic.title, ...c };
    }
  }
  return (
    <section className="home-more-item" aria-labelledby="home-grammar-h">
      <h3 className="home-more-label" id="home-grammar-h">
        Grammar in your texts
      </h3>
      {overview.isPending ? (
        <Skeleton style={{ height: 20 }} />
      ) : best ? (
        <Link to="/grammar/$topic" params={{ topic: best.id }} className="home-more-link">
          <BookText size={14} aria-hidden />
          <span>
            {best.title}
            <span className="home-more-quiet">
              {" "}
              · seen {fmt(best.hits)} {best.hits === 1 ? "time" : "times"}
            </span>
          </span>
        </Link>
      ) : (
        <Link to="/grammar" className="home-more-link">
          <BookText size={14} aria-hidden /> Browse grammar
        </Link>
      )}
    </section>
  );
}

/** A Talk prompt seeded with today's words (or a setup hint without an AI provider). */
function TalkPrompt({ words, topic }: { words: string[]; topic: string | undefined }) {
  const services = useServices();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  return (
    <section className="home-more-item" aria-labelledby="home-talk-h">
      <h3 className="home-more-label" id="home-talk-h">
        Talk about it
      </h3>
      {status.isPending ? (
        <Skeleton style={{ height: 20 }} />
      ) : !status.data?.configured ? (
        <Link to="/settings" search={{ section: "ai" }} className="home-more-link">
          <SettingsIcon size={14} aria-hidden /> Set up AI to chat about what you read
        </Link>
      ) : (
        <Link
          to="/talk"
          search={{
            ...(words.length ? { words: words.join(",") } : {}),
            ...(topic ? { topic } : {}),
          }}
          className="home-more-link"
        >
          <MessagesSquare size={14} aria-hidden />
          <span>
            {topic ? `Start talking about ${topic}` : "Start talking in Dutch"}
            {words.length ? (
              <span className="home-more-quiet"> · using {words.join(", ")}</span>
            ) : null}
          </span>
        </Link>
      )}
    </section>
  );
}

/** A brand-new learner: no texts and no words yet. */
function Welcome({ hello }: { hello: string }) {
  const native = useNativeMode();
  return (
    <div className="page page--read home home-welcome">
      <Logo variant="mark" size={48} title="Kenning" />
      <PageHeader
        title={hello}
        lede="Kenning helps you read Dutch with the words you already know. Two steps to start:"
      />
      <ol className="k-list">
        <li>
          <Link to="/settings" search={{ section: "language" }} className="k-row">
            <SettingsIcon size={16} className="k-row-go" aria-hidden />
            <span className="k-row-main">
              {native ? (
                <>
                  <span className="k-row-title">Words you already know</span>
                  <span className="k-row-hint">
                    Import a deck file, or mark words as known while you read.
                  </span>
                </>
              ) : (
                <>
                  <span className="k-row-title">Connect Anki</span>
                  <span className="k-row-hint">Your decks tell Kenning which words you know.</span>
                </>
              )}
            </span>
            <ArrowRight size={16} className="k-row-go" aria-hidden />
          </Link>
        </li>
        <li>
          <Link to="/import" className="k-row">
            <BookOpen size={16} className="k-row-go" aria-hidden />
            <span className="k-row-main">
              <span className="k-row-title">Add text</span>
              <span className="k-row-hint">Paste an article, add a web page or a PDF.</span>
            </span>
            <ArrowRight size={16} className="k-row-go" aria-hidden />
          </Link>
        </li>
      </ol>
      <p className="home-note">
        Not set up yet? <Link to="/welcome">Run the guided setup</Link>.
      </p>
    </div>
  );
}
