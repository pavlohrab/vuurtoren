/**
 * What you can do with your words (mocks practice-stages.html, desktop-progress.html): four
 * stages, Understand, Build, Write and Use (Use only with an AI, or once a word got there). On
 * Practice, your words by stage; on a word's card, where it is. Both read `practiceLadder`.
 */
import { useQuery } from "@tanstack/react-query";
import { STAGE_NAMES } from "@app/core";
import { useServices } from "../services/context.js";

/** "Next: …" under a word's stages. */
const NEXT = ["", "put it in a sentence.", "write it yourself.", "use it in your own sentence."];

/** On a word's card: the stages as boxes, done and next. */
export function PracticeStepLine({ wordKey }: { wordKey: string }) {
  const services = useServices();
  const q = useQuery({
    queryKey: ["practice", "ladder", wordKey],
    queryFn: () => services.practiceLadder(wordKey),
    staleTime: 60_000,
  });
  const stage = q.data?.stage ?? 0;
  if (!q.data || stage === 0) return null;
  const next = stage < q.data.stages ? NEXT[stage] : "";
  return (
    <div className="stages-line">
      <span className="stages-k">In Practice</span>
      <span className="stages-boxes">
        {STAGE_NAMES.slice(0, q.data.stages).map((name, i) => (
          <span key={name} data-on={i < stage || undefined} data-next={i === stage || undefined}>
            {name}
          </span>
        ))}
      </span>
      {next ? <span className="stages-next">Next: {next}</span> : null}
    </div>
  );
}

/** The headline: the furthest stage words have reached, with its words this week. */
function headline(at: number[], week: number[]): { text: string; n: number; up: number } {
  const from = (s: number) => at.slice(s - 1).reduce((a, b) => a + b, 0);
  if (from(3) > 0) return { text: "write", n: from(3), up: week[2] ?? 0 };
  if (from(2) > 0) return { text: "build sentences with", n: from(2), up: week[1] ?? 0 };
  return { text: "understand", n: from(1), up: week[0] ?? 0 };
}

/** On Practice: your words by stage, one bar, and what's new this week. */
export function LadderBlock() {
  const services = useServices();
  const q = useQuery({
    queryKey: ["practice", "ladder"],
    queryFn: () => services.practiceLadder(),
    staleTime: 60_000,
  });
  const at = q.data?.at ?? [];
  const total = at.reduce((a, b) => a + b, 0);
  if (!q.data || total === 0) return null;
  const week = q.data.newThisWeek;
  const h = headline(at, week);
  return (
    <section className="stages-block" aria-labelledby="stages-h">
      <h2 id="stages-h" className="lessons-h">
        Your words
      </h2>
      <p className="stages-head">
        You can {h.text} <b>{h.n.toLocaleString("en")} words</b>
        {h.text === "write" ? " yourself" : ""}.
        {h.up ? <span className="stages-up"> +{h.up.toLocaleString("en")} this week</span> : null}
      </p>
      <span className="stages-bar" aria-hidden>
        {at.map((n, i) => (
          <i key={i} data-stage={i + 1} style={{ width: `${(100 * n) / total}%` }} />
        ))}
      </span>
      <ul className="stages-legend">
        {at.map((n, i) => (
          <li key={i}>
            <i data-stage={i + 1} aria-hidden />
            {STAGE_NAMES[i]} {n.toLocaleString("en")}
            {week[i] && i > 0 ? <small className="stages-up"> +{week[i]}</small> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
