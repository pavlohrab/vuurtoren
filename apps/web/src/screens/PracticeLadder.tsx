/**
 * Practice's ladder made visible (mock merge-and-direction.html, 3): one word's step on its card,
 * and how many of your words reached each step on Practice. Both read `practiceLadder`.
 */
import { useQuery } from "@tanstack/react-query";
import { STEP_NAMES } from "@app/core";
import { useServices } from "../services/context.js";

/** On the word card: "Practice · Build it, 3 of 5", with the steps as small bars. */
export function PracticeStepLine({ wordKey }: { wordKey: string }) {
  const services = useServices();
  const q = useQuery({
    queryKey: ["practice", "ladder", wordKey],
    queryFn: () => services.practiceLadder(wordKey),
    staleTime: 60_000,
  });
  const step = q.data?.step ?? 0;
  if (!q.data || step === 0) return null;
  return (
    <div className="ladder-line">
      <span className="ladder-line-text">
        Practice · {STEP_NAMES[step - 1]}, {step} of {q.data.top}
      </span>
      <span className="ladder-dots" aria-hidden>
        {Array.from({ length: q.data.top }, (_, i) => (
          <i key={i} data-on={i < step || undefined} />
        ))}
      </span>
    </div>
  );
}

/** On Practice: how many of your words reached each step. */
export function LadderBlock() {
  const services = useServices();
  const q = useQuery({
    queryKey: ["practice", "ladder"],
    queryFn: () => services.practiceLadder(),
    staleTime: 60_000,
  });
  const reached = q.data?.reached ?? [];
  const most = reached[0] ?? 0;
  if (!most) return null;
  return (
    <section className="ladder-block" aria-labelledby="ladder-h">
      <h2 id="ladder-h" className="lessons-h">
        Your words on the ladder
      </h2>
      <ul>
        {reached.map((n, i) => (
          <li key={i}>
            <span>{STEP_NAMES[i]}</span>
            <span className="ladder-bar" aria-hidden>
              <i style={{ width: `${(100 * n) / most}%` }} />
            </span>
            <b>{n.toLocaleString("en")}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
