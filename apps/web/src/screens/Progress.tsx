import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@app/ui";
import { useServices } from "../services/context.js";

const fmt = (n: number) => n.toLocaleString("en");

/** Progress: calm summary numbers; charts arrive later. */
export function Progress() {
  const services = useServices();
  const q = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });
  const s = q.data;

  return (
    <div className="page">
      <h1>Progress</h1>
      <p className="page-lede">
        {s?.lastSync
          ? `Based on your Anki collection, last synced ${new Date(s.lastSync).toLocaleString("en")}.`
          : "Sync Anki in Settings to see where you stand."}
      </p>
      {q.isPending ? (
        <Skeleton style={{ height: 110, borderRadius: 10 }} />
      ) : s ? (
        <div className="stat-grid">
          <Stat value={fmt(s.vocabEstimate)} label="Estimated vocabulary" />
          <Stat value={fmt(s.known)} label="Words known" />
          <Stat value={fmt(s.learning)} label="Words in progress" />
          <Stat value={fmt(s.unknown)} label="Words not yet met" />
        </div>
      ) : (
        <p className="error-text">The summary could not be loaded.</p>
      )}
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
