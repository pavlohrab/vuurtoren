/**
 * /exam: the A2 inburgeringsexamen at a glance (parts, formats, durations, pass rules, with the
 * date the facts were checked and links to the official site), and your progress per part.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ExternalLink } from "lucide-react";
import { A2_EXAM, type ExamPart } from "@app/content";
import { Chip, Skeleton } from "@app/ui";
import { useDutchVoice } from "../../practice/speech.js";
import { useServices } from "../../services/context.js";
import type { ExamAttemptRecord } from "../../services/examTypes.js";
import { PageHeader } from "../../shell/PageHeader.js";
import { usePageHeader } from "../../shell/ShellContext.js";
import { pct, plural } from "../../format.js";
import "./exam.css";

export function useExamAttempts() {
  const services = useServices();
  return useQuery({
    queryKey: ["exam", "attempts"],
    queryFn: () => services.examAttempts(),
    staleTime: 30_000,
  });
}

export interface PartProgress {
  attempts: number;
  /** Best mock-exam share, null when no mock exam was taken. */
  bestExam: number | null;
  last: ExamAttemptRecord | null;
}

/** Progress of one part from the attempts list. */
export function partProgress(attempts: readonly ExamAttemptRecord[], part: ExamPart): PartProgress {
  const mine = attempts.filter((a) => a.part === part);
  const exams = mine.filter((a) => a.mode === "exam" && a.total > 0);
  return {
    attempts: mine.length,
    bestExam: exams.length ? Math.max(...exams.map((a) => a.correct / a.total)) : null,
    last: mine.at(-1) ?? null,
  };
}

export const checkedDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** Listening reads its fragments aloud with the system's Dutch voice. */
export function NoDutchVoice() {
  return (
    <p className="k-hint" role="note">
      Listening needs a Dutch voice, and none is installed. Add one in your system&rsquo;s speech
      settings, then reload Kenning.
    </p>
  );
}

export function Exam() {
  usePageHeader("Exam");
  const attempts = useExamAttempts();
  const noVoice = useDutchVoice() === false;
  return (
    <div className="page page--narrow exam">
      <PageHeader
        title="Exam"
        lede="Prepare for the Dutch civic integration exam (inburgeringsexamen) at A2. Practise each part with instant feedback, then take a timed mock exam."
        actions={
          <a
            href={A2_EXAM.practiceUrl}
            target="_blank"
            rel="noreferrer"
            className="k-btn k-btn--secondary"
          >
            Official practice exams <ExternalLink size={14} aria-hidden />
          </a>
        }
      />

      <section aria-labelledby="exam-parts-h">
        <h2 id="exam-parts-h" className="exam-h2">
          The five parts
        </h2>
        {noVoice ? <NoDutchVoice /> : null}
        <ul className="exam-parts">
          {A2_EXAM.parts.map((p) => {
            const prog = attempts.data ? partProgress(attempts.data, p.part) : null;
            return (
              <li key={p.part}>
                <Link to="/exam/$part" params={{ part: p.part }} className="exam-part">
                  <span className="exam-part-name">
                    <span lang="nl">{p.nl}</span>
                    <span className="exam-muted"> · {p.en}</span>
                  </span>
                  <span className="exam-part-format">{p.format}</span>
                  <span className="exam-part-meta">
                    <Chip>{p.minutes} min</Chip>
                    <Chip>{p.items}</Chip>
                    <span className="exam-muted">Pass: {p.passRule}</span>
                    {noVoice && p.part === "luisteren" ? (
                      <Chip tone="warm">Needs a Dutch voice</Chip>
                    ) : null}
                  </span>
                  <span className="exam-part-progress">
                    {attempts.isPending ? (
                      <Skeleton style={{ height: 16, width: 120 }} />
                    ) : prog && prog.attempts > 0 ? (
                      <>
                        {prog.bestExam !== null ? (
                          <Chip tone={prog.bestExam >= p.passEstimate ? "success" : "neutral"}>
                            Best mock {pct(prog.bestExam)}
                          </Chip>
                        ) : null}
                        <span className="exam-muted">{plural(prog.attempts, "session")}</span>
                      </>
                    ) : (
                      <span className="exam-muted">Not started</span>
                    )}
                  </span>
                  <ArrowRight size={16} className="exam-part-go" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="exam-about-h" className="exam-about">
        <h2 id="exam-about-h" className="exam-h2">
          About the exam
        </h2>
        <ul className="exam-facts">
          {A2_EXAM.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="exam-muted">
          Kenning's practice items are original, written in the official formats; they are not
          official exam items. Pass marks are estimates. Always check{" "}
          <a href="https://www.inburgeren.nl/" target="_blank" rel="noreferrer">
            inburgeren.nl
          </a>{" "}
          before you book.
        </p>
        <p className="exam-checked">Last checked {checkedDate(A2_EXAM.lastChecked)}. Sources:</p>
        <ul className="exam-sources">
          {A2_EXAM.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.label} <ExternalLink size={12} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
