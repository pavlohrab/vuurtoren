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
  Dumbbell,
  GraduationCap,
  ListChecks,
  MessagesSquare,
  Plus,
  Settings as SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { grammarTopics } from "@app/content";
import { Chip, Logo, ProgressRing, Skeleton, TextCover, coverKind, difficultyBand } from "@app/ui";
import { readLastText } from "../lastText.js";
import { useServices } from "../services/context.js";
import { activeDays, type ActivityDay } from "../services/activity.js";
import type { TextListItem, TextWordItem } from "../services/types.js";
import { usePageHeader } from "../shell/ShellContext.js";
import { pagesOf, WORDS_PER_PAGE } from "../textPages.js";
import { topicCount } from "./Grammar.js";
import { CreateStoryButton } from "./StoryDialog.js";

export { pagesOf, WORDS_PER_PAGE };

/** Dutch greeting for the time of day. */
export function greeting(hour: number): string {
  if (hour < 5 || hour >= 18) return "Goedenavond";
  if (hour < 12) return "Goedemorgen";
  return "Goedemiddag";
}

const fmt = (n: number) => n.toLocaleString("en");
const pct = (v: number) => `${Math.round(v * 100)}%`;

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

/** Words worth learning now from a text: highlighted or looked up, and not studied in Anki yet. */
export function wordsToLearn(items: readonly TextWordItem[], max = 8): TextWordItem[] {
  return items
    .filter((w) => w.source !== "gloss")
    .filter((w) => w.entry.anki.status === "absent" || w.entry.anki.status === "new")
    .slice(0, max);
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
  // The top bar shows today's date: the page's own heading is the greeting.
  usePageHeader(DATE_FMT.format(new Date()));
  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const summary = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const practice = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
    staleTime: 60_000,
  });
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
  const waiting = textWords.data?.filter(
    (w) => w.source !== "gloss" && w.entry.anki.status === "absent",
  ).length;

  return (
    <div className="page home">
      <header className="home-head">
        <h1 className="home-hello">{hello}</h1>
        <div className="home-actions" role="group" aria-label="Quick actions">
          <Link to="/import" className="k-btn k-btn--secondary">
            <Plus size={16} aria-hidden /> Import
          </Link>
          <CreateStoryButton />
          <Link to="/talk" className="k-btn k-btn--secondary">
            <MessagesSquare size={16} aria-hidden /> Talk
          </Link>
        </div>
        <p className="page-lede">
          {s && s.known > 0
            ? `You know ${fmt(s.known)} Dutch words. Here is a short plan for today.`
            : "Here is a short plan for today."}
        </p>
      </header>

      <div className="home-grid">
        <Tile
          id="home-continue-h"
          title={cont?.started === false ? "Start reading" : "Continue reading"}
          className="home-continue"
          action={
            <Link to="/library" className="home-tile-link">
              Not this one? Library <ArrowRight size={14} aria-hidden />
            </Link>
          }
        >
          {texts.isPending ? (
            <Skeleton style={{ height: 150 }} />
          ) : cont ? (
            <ContinueCard
              text={cont.text}
              started={cont.started}
              pages={reading.data?.plans.length ?? null}
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
              text="Your library is empty. Import an article, a web page or a PDF to start reading."
              action={
                <Link to="/import" className="k-btn k-btn--primary">
                  <Plus size={16} aria-hidden /> Import a text
                </Link>
              }
            />
          )}
        </Tile>

        <Tile id="home-known-h" title="Your words" className="home-known">
          {summary.isPending || texts.isPending ? (
            <Skeleton style={{ height: 200 }} />
          ) : s ? (
            <KnownWords
              coverage={libraryCoverage(list)}
              known={s.known}
              learning={s.learning}
              vocab={s.lastSync ? s.vocabEstimate : null}
            />
          ) : (
            <Empty text="Your word counts could not be loaded." />
          )}
        </Tile>

        <Tile id="home-plan-h" title="Today" className="home-plan">
          <ol className="home-steps">
            <PracticeStep
              due={practice.data?.due}
              fresh={practice.data?.newAvailable ?? 0}
              answered={today?.exercises ?? 0}
            />
            {cont && waiting ? (
              <PlanStep
                icon={<ListChecks size={18} />}
                to={{ to: "/read/$textId/words", params: { textId: cont.text.id } }}
                label="New words waiting for Anki"
                value={fmt(waiting)}
                tone="learn"
              />
            ) : today?.added ? (
              <DoneStep label="Words added to Anki" value={fmt(today.added)} />
            ) : null}
            {today?.pages ? (
              <DoneStep
                label="Read today"
                value={`${fmt(today.pages)} ${today.pages === 1 ? "page" : "pages"}`}
              />
            ) : null}
            <CourseStep course={courses.data?.find((c) => c.continueUnit !== null)} />
          </ol>
        </Tile>

        <Tile
          id="home-learn-h"
          title="Words to learn now"
          className="home-learn"
          action={
            cont && learn?.length ? (
              <Link
                to="/words"
                search={{ source: `text:${cont.text.id}` }}
                className="home-tile-link"
              >
                All words <ArrowRight size={14} aria-hidden />
              </Link>
            ) : null
          }
        >
          {textWords.isPending && contId ? (
            <Skeleton style={{ height: 96 }} />
          ) : cont && learn && learn.length + extra.length > 0 ? (
            <>
              <ul className="home-words" aria-label="Words to learn now">
                {learn.map((w) => (
                  <li key={w.key}>
                    <Link
                      to="/words"
                      search={{ source: `text:${cont.text.id}`, word: w.key }}
                      className="home-word"
                      title={w.glosses[0] ?? undefined}
                      lang="nl"
                    >
                      {w.article && w.pos === "NOUN" ? (
                        <span className="home-word-art">{w.article}</span>
                      ) : null}
                      {w.lemma}
                    </Link>
                  </li>
                ))}
                {extra.map((w) => (
                  <li key={w.key}>
                    <Link
                      to="/words"
                      search={{ word: w.key }}
                      className="home-word home-word--other"
                      title={w.gloss ?? undefined}
                      lang="nl"
                    >
                      {w.article ? <span className="home-word-art">{w.article}</span> : null}
                      {w.key}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="home-muted home-small">
                From <span className="home-text-ref">{cont.text.title}</span>
                {extra.length ? " and your other reading" : ""}. Open a word to add it to Anki or
                mark it known.
              </p>
            </>
          ) : (
            <Empty text="No new words waiting. Words you meet while reading show up here." />
          )}
        </Tile>

        <Tile id="home-week-h" title="This week" className="home-week">
          {activity.isPending ? (
            <Skeleton style={{ height: 120 }} />
          ) : activity.data ? (
            <WeekStrip days={activity.data} />
          ) : (
            <Empty text="Your activity could not be loaded." />
          )}
        </Tile>

        <Tile
          id="home-recent-h"
          title="Recent texts"
          className="home-recent"
          action={
            list.length > 0 ? (
              <Link to="/library" className="home-tile-link">
                Library <ArrowRight size={14} aria-hidden />
              </Link>
            ) : null
          }
        >
          <RecentTexts texts={list} skip={contId} />
        </Tile>

        <Tile id="home-grammar-h" title="Grammar in your texts" className="home-grammar">
          <GrammarSuggestion />
        </Tile>

        <Tile id="home-talk-h" title="Talk about it" className="home-talk">
          <TalkPrompt
            words={(learn ?? []).slice(0, 3).map((w) => w.lemma)}
            topic={cont?.text.title}
          />
        </Tile>
      </div>
    </div>
  );
}

/** A Home tile: eyebrow heading with an optional action on the right, then the body. */
function Tile({
  id,
  title,
  action,
  className,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className={`home-card ${className}`} aria-labelledby={id}>
      <header className="home-card-head">
        <h2 className="k-overline" id={id}>
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="home-empty">
      <p className="home-muted">{text}</p>
      {action}
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

/** A step already done today: a check instead of a link. */
function DoneStep({ label, value }: { label: string; value: string }) {
  return (
    <li>
      <div className="home-step home-step--done">
        <span className="home-step-icon" aria-hidden>
          <Check size={18} />
        </span>
        <span className="home-step-label">
          {label}
          <span className="k-sr"> (done)</span>
        </span>
        <span className="home-step-value">{value}</span>
      </div>
    </li>
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
      <PlanStep icon={<Dumbbell size={18} />} to={{ to: "/practice" }} label="Practise" value="…" />
    );
  }
  if (due > 0) {
    return (
      <PlanStep
        icon={<Dumbbell size={18} />}
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
      icon={<Dumbbell size={18} />}
      to={{ to: "/practice" }}
      label="Practise new words"
      value={`${fmt(fresh)} new`}
    />
  );
}

function CourseStep({
  course,
}: {
  course: { course: { id: string; title: string }; continueUnit: number | null } | undefined;
}) {
  if (!course || course.continueUnit === null) return null;
  return (
    <PlanStep
      icon={<GraduationCap size={18} />}
      to={{
        to: "/courses/$courseId/$unit",
        params: { courseId: course.course.id, unit: String(course.continueUnit) },
      }}
      label={course.course.title}
      value={`Unit ${course.continueUnit}`}
    />
  );
}

function ContinueCard({
  text,
  started,
  pages: planned,
  excerpt,
}: {
  text: TextListItem;
  started: boolean;
  /** Pages from the reading plan, when loaded (else estimated from the length). */
  pages: number | null;
  /** Null while loading; "" when it cannot be shown. */
  excerpt: string | null;
}) {
  const pages = planned ?? pagesOf(text).pages;
  const page = Math.min(text.lastSegment + 1, pages);
  const done = Math.min(1, text.lastSegment / pages);
  const band = text.coverage !== null ? difficultyBand(text.coverage) : null;
  return (
    <div className="home-continue-body">
      <TextCover
        title={text.title}
        kind={coverKind(text.sourceKind, text.sourceRef)}
        size="sm"
        showLabel={false}
        className="home-continue-cover"
      />
      <div className="home-continue-main">
        <Link to="/read/$textId" params={{ textId: text.id }} className="home-continue-title">
          {text.title}
        </Link>
        <p className="home-meta">
          <span>
            {started ? `Page ${page} of ${pages}` : `${pages} ${pages === 1 ? "page" : "pages"}`}
          </span>
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
          <Skeleton style={{ height: 44 }} />
        ) : null}
        <div className="home-continue-foot">
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
          {started ? null : (
            <span className="home-bar-label home-progress">
              About {Math.max(1, Math.round(text.wordCount / 70))} min for the whole text
            </span>
          )}
          <Link to="/read/$textId" params={{ textId: text.id }} className="k-btn k-btn--primary">
            {started ? "Continue" : "Start reading"} <ArrowRight size={16} aria-hidden />
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
  return (
    <div className="home-known-body">
      <div className="home-known-top">
        <ProgressRing
          value={coverage ?? 0}
          size={104}
          stroke={9}
          label="Share of the words in your texts you already know"
        >
          <span className="home-ring-num">{coverage === null ? "–" : pct(coverage)}</span>
        </ProgressRing>
        <p className="home-known-caption">
          {coverage === null
            ? "Import a text to see how much of it you already know."
            : `You know ${pct(coverage)} of the words in your texts.`}
        </p>
      </div>
      <dl className="home-stats">
        <div className="home-stat">
          <dt>Known</dt>
          <dd className="home-stat--known">
            <Link to="/words" search={{ state: "known" }}>
              {fmt(known)}
            </Link>
          </dd>
        </div>
        <div className="home-stat">
          <dt>Learning</dt>
          <dd>
            <Link to="/words" search={{ state: "learning" }}>
              {fmt(learning)}
            </Link>
          </dd>
        </div>
        <div className="home-stat">
          <dt title="Estimated from your Anki collection">Vocabulary</dt>
          <dd>{vocab === null ? "–" : fmt(vocab)}</dd>
        </div>
      </dl>
      <Link to="/progress" className="home-tile-link home-progress-link">
        View progress <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { weekday: "narrow" });
const DAY_LONG = new Intl.DateTimeFormat("en-GB", { weekday: "long" });

/** Seven days of activity: a quiet bar per day (no streak guilt), totals below. */
function WeekStrip({ days }: { days: ActivityDay[] }) {
  const total = (d: ActivityDay) => d.pages + d.exercises + d.added;
  const max = Math.max(1, ...days.map(total));
  const sum = (k: "pages" | "exercises" | "added") => days.reduce((n, d) => n + d[k], 0);
  // The strip ends today.
  const todayKey = days.at(-1)?.date;
  return (
    <div className="home-week-body">
      <ol className="home-days" aria-label="Activity per day">
        {days.map((d) => {
          const date = new Date(`${d.date}T12:00:00`);
          const t = total(d);
          const label = `${DAY_LONG.format(date)}: ${d.pages} pages, ${d.exercises} exercises, ${d.added} words added`;
          return (
            <li key={d.date} className="home-day" data-today={d.date === todayKey || undefined}>
              <span className="home-day-track" title={label}>
                <span
                  className="home-day-fill"
                  data-empty={t === 0 || undefined}
                  style={{ transform: `scaleY(${t === 0 ? 0.06 : 0.15 + (0.85 * t) / max})` }}
                />
              </span>
              <span className="home-day-name" aria-hidden>
                {DAY_FMT.format(date)}
              </span>
              <span className="k-sr">{label}</span>
            </li>
          );
        })}
      </ol>
      <dl className="home-week-totals">
        <div>
          <dt>Days active</dt>
          <dd>{activeDays(days)}/7</dd>
        </div>
        <div>
          <dt>Pages</dt>
          <dd>{fmt(sum("pages"))}</dd>
        </div>
        <div>
          <dt>Exercises</dt>
          <dd>{fmt(sum("exercises"))}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{fmt(sum("added"))}</dd>
        </div>
      </dl>
    </div>
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
          <Link to="/import" className="home-tile-link">
            <Plus size={14} aria-hidden /> Import a text
          </Link>
        }
      />
    );
  }
  return (
    <ul className="home-shelf">
      {recent.map((t) => (
        <li key={t.id}>
          <Link to="/read/$textId" params={{ textId: t.id }} className="home-shelf-item">
            <TextCover
              title={t.title}
              kind={coverKind(t.sourceKind, t.sourceRef)}
              coverage={t.coverage}
              size="sm"
            />
            <span className="home-shelf-title">{t.title}</span>
            <span className="home-shelf-meta">
              {t.coverage === null ? "Not analysed" : `${pct(t.coverage)} known`}
              {t.lastSegment > 0 ? ` · page ${pagesOf(t).page}` : ""}
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
  if (overview.isPending) return <Skeleton style={{ height: 80 }} />;
  let best: { id: string; title: string; summary: string; hits: number; texts: number } | null =
    null;
  for (const topic of grammarTopics()) {
    const c = topicCount(topic, overview.data);
    if (c && c.hits > 0 && (!best || c.hits > best.hits)) {
      best = { id: topic.id, title: topic.title, summary: topic.summary, ...c };
    }
  }
  if (!best) {
    return (
      <Empty
        text="Once your texts are analysed, the construction you meet most shows up here."
        action={
          <Link to="/grammar" className="home-tile-link">
            <BookText size={14} aria-hidden /> Browse grammar
          </Link>
        }
      />
    );
  }
  return (
    <div className="home-grammar-body">
      <Link to="/grammar/$topic" params={{ topic: best.id }} className="home-grammar-title">
        {best.title}
      </Link>
      <p className="home-muted home-small home-clamp">{best.summary}</p>
      <p className="home-meta">
        Seen {fmt(best.hits)} {best.hits === 1 ? "time" : "times"} in {fmt(best.texts)}{" "}
        {best.texts === 1 ? "text" : "texts"}
      </p>
      <Link to="/grammar/$topic" params={{ topic: best.id }} className="home-tile-link">
        Open topic <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

/** A Talk prompt seeded with today's words (or a setup hint without an AI provider). */
function TalkPrompt({ words, topic }: { words: string[]; topic: string | undefined }) {
  const services = useServices();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  if (status.isPending) return <Skeleton style={{ height: 80 }} />;
  if (!status.data?.configured) {
    return (
      <Empty
        text="Chat in Dutch about what you read, within the words you know. Talk uses your own AI provider."
        action={
          <Link to="/settings" search={{ section: "ai" }} className="home-tile-link">
            <SettingsIcon size={14} aria-hidden /> Set up AI
          </Link>
        }
      />
    );
  }
  return (
    <div className="home-talk-body">
      <p className="home-talk-q">
        {topic ? (
          <>
            A short chat about <span className="home-text-ref">{topic}</span>
          </>
        ) : (
          "A short chat in Dutch"
        )}
        {words.length ? (
          <>
            , using{" "}
            {words.map((w, i) => (
              <span key={w}>
                <span className="home-inline-word" lang="nl">
                  {w}
                </span>
                {i < words.length - 2 ? ", " : i === words.length - 2 ? " and " : ""}
              </span>
            ))}
          </>
        ) : null}
        {"."}
      </p>
      <Link
        to="/talk"
        search={{
          ...(words.length ? { words: words.join(",") } : {}),
          ...(topic ? { topic } : {}),
        }}
        className="home-tile-link"
      >
        <MessagesSquare size={14} aria-hidden /> Start talking
      </Link>
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
          <Link to="/settings" search={{ section: "language" }} className="home-step">
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
              <BookOpen size={18} />
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
