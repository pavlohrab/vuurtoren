import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { EmptyState, Skeleton } from "@app/ui";
import { useServices } from "../services/context.js";

const fmt = (n: number) => n.toLocaleString("en");

/** Progress: calm summary numbers; charts arrive later. */
export function Progress() {
  const services = useServices();
  const q = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const s = q.data;
  const synced = Boolean(s?.lastSync);

  // Nothing synced and nothing read yet: one next step instead of a wall of zeros.
  if (s && !synced && s.known + s.learning === 0) {
    return (
      <div className="page">
        <h1>Progress</h1>
        <EmptyState
          icon={<TrendingUp size={28} />}
          title="Nothing to measure yet"
          description="Sync your Anki decks and Kenning can tell how many Dutch words you know."
          action={
            <Link to="/settings" className="k-btn k-btn--primary">
              Connect Anki
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Progress</h1>
      <p className="page-lede">
        {s?.lastSync
          ? `Based on your Anki collection, last synced ${new Date(s.lastSync).toLocaleString("en")}.`
          : "Based on your reading so far. Sync Anki in Settings to include your decks and an estimate of your vocabulary."}
      </p>
      {q.isPending ? (
        <Skeleton style={{ height: 110, borderRadius: 10 }} />
      ) : s ? (
        <div className="stat-grid">
          {/* The estimate is only meaningful once Anki has been read. */}
          {synced ? <Stat value={fmt(s.vocabEstimate)} label="Estimated vocabulary" /> : null}
          <Stat value={fmt(s.known)} label="Known words" />
          <Stat value={fmt(s.learning)} label="Learning" />
          <Stat value={fmt(s.unknown)} label="New words" />
        </div>
      ) : (
        <p className="error-text">The summary could not be loaded.</p>
      )}
      <PracticeSection />
      {s && s.sources.length > 0 ? (
        <p className="k-hint" style={{ marginTop: 16 }}>
          Sources: {s.sources.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

const SKILL_LABEL = {
  recognition: "Recognition",
  recall: "Recall",
  form: "Forms",
  gender: "Gender",
  listening: "Listening",
} as const;

/** Small practice summary: items due and items learned per skill. */
function PracticeSection() {
  const services = useServices();
  const q = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
  });
  const p = q.data;
  if (!p) return null;
  return (
    <section style={{ marginTop: 32 }} aria-label="Practice">
      <h2 className="practice-h2">Practice</h2>
      <div className="stat-grid">
        <Stat value={fmt(p.due)} label="Due now" />
        <Stat value={fmt(p.learned)} label="Items learned" />
        {(Object.keys(SKILL_LABEL) as (keyof typeof SKILL_LABEL)[]).map((k) => (
          <Stat key={k} value={fmt(p.bySkill[k])} label={`${SKILL_LABEL[k]} learned`} />
        ))}
      </div>
    </section>
  );
}
