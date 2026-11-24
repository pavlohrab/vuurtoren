import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState, Skeleton } from "@app/ui";
import { useServices } from "../services/context.js";
import { groupWeeks, type ActivityWeek, type KnownPoint } from "../services/activity.js";
import { PageHeader, SectionHeader } from "../shell/PageHeader.js";
import { pct, relativeTime } from "../format.js";
import type { TextListItem } from "../services/types.js";
import { WordsRoom } from "./words/WordsRoom.js";
import { ErrorNotice } from "../shell/ErrorNotice.js";
import "./progress.css";

const fmt = (n: number) => n.toLocaleString();
const WEEKS = 12;
const DAY_FMT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dayOf = (iso: string) => DAY_FMT.format(new Date(`${iso}T12:00:00`));

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

/** Progress (a tab of Words): your words and your reading over the last weeks, in calm charts. */
export function Progress() {
  const services = useServices();
  const q = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const coverage = texts.data ? libraryCoverage(texts.data) : null;
  const s = q.data;
  const synced = Boolean(s?.lastSync) || s?.native === true;

  // Nothing synced and nothing read yet: one next step instead of a wall of zeros.
  if (s && !synced && s.known + s.learning === 0) {
    return (
      <div className="page page--list">
        <WordsRoom />
        <PageHeader title="Progress" />
        <EmptyState
          icon={<TrendingUp size={20} />}
          title="Nothing to measure yet"
          description="Read a story and add a few words, and Vuurtoren can tell how many Dutch words you know."
          action={
            <Link to="/settings" search={{ section: "words" }} className="k-btn k-btn--primary">
              Set up your words
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page page--list progress">
      <WordsRoom />
      <PageHeader
        title="Progress"
        lede={
          s?.native
            ? "Based on your cards in Vuurtoren and your reading."
            : s?.lastSync
              ? `Based on your Anki collection, synced ${relativeTime(s.lastSync)}.`
              : "Based on your reading so far. Connect Anki in Settings to include your decks."
        }
      />
      {q.isPending ? (
        <Skeleton style={{ height: 110, borderRadius: 10 }} />
      ) : s ? (
        <div className="stat-grid">
          {/* The estimate is only meaningful once there is a collection to read, and words in
              it: below 200 it shows its floor (200), which read as 200 words beside 0 known. */}
          {synced && s.known + s.learning >= 200 ? (
            <Stat value={fmt(s.vocabEstimate)} label="Estimated vocabulary" />
          ) : null}
          <Stat value={fmt(s.known)} label="Known words" state="known" />
          <Stat value={fmt(s.learning)} label="Learning" state="learning" />
          <Stat value={fmt(s.unknown)} label="New words" state="unknown" />
          {coverage !== null ? <Stat value={pct(coverage)} label="Known in your texts" /> : null}
        </div>
      ) : (
        <ErrorNotice
          title="Your word counts could not be loaded."
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      )}
      <div className="progress-charts">
        <KnownChart />
        <ReadingChart />
      </div>
      <PracticeSection />
    </div>
  );
}

/** A number; with `state` it opens Words filtered to that state. */
function Stat({
  value,
  label,
  state,
}: {
  value: string;
  label: string;
  state?: "known" | "learning" | "unknown";
}) {
  if (state) {
    return (
      <Link to="/words/all" search={{ state }} className="stat stat--link">
        <div className="stat-value">{value}</div>
        <div className="stat-label">
          {label} <ArrowRight size={12} aria-hidden />
        </div>
      </Link>
    );
  }
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** Chart frame: section header, one line on what it shows, the plot and a table for screen readers. */
function ChartSection({
  id,
  title,
  note,
  children,
  table,
}: {
  id: string;
  title: string;
  note: string;
  children: ReactNode;
  table: { head: [string, string]; rows: [string, string][] } | null;
}) {
  return (
    <section className="progress-chart" aria-labelledby={id}>
      <SectionHeader id={id} title={title} />
      <p className="progress-note">{note}</p>
      {children}
      {table ? (
        <table className="k-sr">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{table.head[0]}</th>
              <th scope="col">{table.head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map(([a, b]) => (
              <tr key={a}>
                <td>{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

/** Known words at the end of each week: one line, the last value labelled. */
function KnownChart() {
  const services = useServices();
  const q = useQuery({
    queryKey: ["progress", "known", WEEKS],
    queryFn: () => services.knownOverTime(WEEKS),
    staleTime: 60_000,
  });
  const points = q.data ?? [];
  return (
    <ChartSection
      id="progress-known-h"
      title="Known words"
      note={`The last ${WEEKS} weeks, dated by when each word’s card was made.`}
      table={
        q.data
          ? {
              head: ["Week ending", "Known words"],
              rows: points.map((p) => [dayOf(p.date), fmt(p.known)]),
            }
          : null
      }
    >
      {q.isPending ? (
        <Skeleton style={{ height: 160 }} />
      ) : q.isError ? (
        <ErrorNotice
          title="The history could not be loaded."
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <LineChart points={points} />
      )}
    </ChartSection>
  );
}

const H = 100;

function LineChart({ points }: { points: KnownPoint[] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.known);
  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat history sits in the upper part of the plot, not on the floor.
  const lo = Math.max(0, min - Math.max(1, (max - min) * 0.25));
  const span = Math.max(1, max - lo);
  const x = (i: number) => (i / (points.length - 1)) * 100;
  const y = (v: number) => H - ((v - lo) / span) * H * 0.9;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.known)}`).join(" ");
  const last = points.at(-1)!;
  const gained = last.known - points[0]!.known;
  const lastTop = `${(y(last.known) / H) * 100}%`;
  const step = 100 / (points.length - 1);
  return (
    <figure className="pchart" aria-hidden>
      <div className="pchart-plot">
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="pchart-svg">
          <path d={`${line} L100,${H} L0,${H} Z`} className="pchart-area" />
          <path d={line} className="pchart-line" vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => (
            <rect
              key={p.date}
              x={Math.max(0, x(i) - step / 2)}
              y={0}
              width={step}
              height={H}
              className="pchart-hit"
            >
              <title>{`${dayOf(p.date)}: ${fmt(p.known)} known`}</title>
            </rect>
          ))}
        </svg>
        <span className="pchart-dot" style={{ top: lastTop }} />
        <span className="pchart-end" style={{ top: lastTop }}>
          {fmt(last.known)}
        </span>
      </div>
      <figcaption className="pchart-axis">
        <span>{dayOf(points[0]!.date)}</span>
        <span>{gained > 0 ? `+${fmt(gained)} in ${WEEKS} weeks` : "No change"}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}

/** Pages read per week: thin bars, this week labelled. */
function ReadingChart() {
  const services = useServices();
  const q = useQuery({
    queryKey: ["activity", WEEKS * 7],
    queryFn: () => services.activity(WEEKS * 7),
    staleTime: 60_000,
  });
  const weeks = q.data ? groupWeeks(q.data) : [];
  return (
    <ChartSection
      id="progress-reading-h"
      title="Reading per week"
      note="Pages read, week by week."
      table={
        q.data
          ? {
              head: ["Week from", "Pages"],
              rows: weeks.map((w) => [dayOf(w.start), fmt(w.pages)]),
            }
          : null
      }
    >
      {q.isPending ? (
        <Skeleton style={{ height: 160 }} />
      ) : q.isError ? (
        <ErrorNotice
          title="Your reading could not be loaded."
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <BarChart weeks={weeks} />
      )}
    </ChartSection>
  );
}

function BarChart({ weeks }: { weeks: ActivityWeek[] }) {
  if (weeks.length === 0) return null;
  const max = Math.max(1, ...weeks.map((w) => w.pages));
  const total = weeks.reduce((n, w) => n + w.pages, 0);
  return (
    <figure className="pchart" aria-hidden>
      <div className="pchart-plot pchart-bars">
        {weeks.map((w, i) => (
          <span
            key={w.start}
            className="pchart-bar"
            data-now={i === weeks.length - 1 || undefined}
            title={`Week from ${dayOf(w.start)}: ${w.pages} ${w.pages === 1 ? "page" : "pages"}`}
          >
            <span style={{ height: `${(w.pages / max) * 100}%` }} />
          </span>
        ))}
      </div>
      <figcaption className="pchart-axis">
        <span>{dayOf(weeks[0]!.start)}</span>
        <span>{total ? `${fmt(total)} pages in ${WEEKS} weeks` : "Nothing read yet"}</span>
        <span>This week · {fmt(weeks.at(-1)!.pages)}</span>
      </figcaption>
    </figure>
  );
}

const SKILL_LABEL = {
  recognition: "Recognising the meaning",
  recall: "Recalling the word",
  form: "Word forms",
  gender: "de or het",
  listening: "Listening",
} as const;

/** Practice: what is due and what is learned, the skills in a disclosure. */
function PracticeSection() {
  const services = useServices();
  const q = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
  });
  const p = q.data;
  if (!p) return null;
  const skills = Object.keys(SKILL_LABEL) as (keyof typeof SKILL_LABEL)[];
  const top = Math.max(1, ...skills.map((k) => p.bySkill[k]));
  return (
    <section className="k-section progress-section" aria-labelledby="progress-practice-h">
      <SectionHeader id="progress-practice-h" title="Practice" />
      <div className="stat-grid">
        <Link to="/practice" className="stat stat--link">
          <div className="stat-value">{fmt(p.due)}</div>
          <div className="stat-label">
            Exercises due <ArrowRight size={12} aria-hidden />
          </div>
        </Link>
        <Stat value={fmt(p.learned)} label="Learned in practice" />
        {p.lastSession ? <Stat value={relativeTime(p.lastSession)} label="Last practised" /> : null}
      </div>
      <details className="k-disclosure progress-skills">
        <summary>
          <ChevronRight size={16} className="k-disclosure-icon" aria-hidden />
          By skill
        </summary>
        <ul className="k-disclosure-body progress-skill-list">
          {skills.map((k) => (
            <li key={k}>
              <span>{SKILL_LABEL[k]}</span>
              <span className="progress-skill-bar" aria-hidden>
                <span style={{ transform: `scaleX(${p.bySkill[k] / top})` }} />
              </span>
              <span className="progress-skill-n">{fmt(p.bySkill[k])}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
