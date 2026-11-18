/**
 * /exam/<part>: one part of the exam. Without `mode`: the part's mock exams, practice options
 * (KNM themes, single writing tasks, an AI-written item) and your history. With
 * `mode=practice|exam&set=…` (or `theme=…`): the session itself.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowLeft, Sparkles, Timer } from "lucide-react";
import { useState } from "react";
import {
  EXAM_PARTS,
  type ExamPart,
  type ListeningFragment,
  type McGroup,
  type ReadingText,
  examBank,
  examPartInfo,
  examSets,
  mcGroups,
} from "@app/content";
import { Button, Chip, EmptyState } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { ExamItemPart, GeneratedExamView } from "../../services/examTypes.js";
import { errorText } from "../../services/errors.js";
import { PageHeader } from "../../shell/PageHeader.js";
import { usePageHeader } from "../../shell/ShellContext.js";
import { McSession } from "./McSession.js";
import { SpeakingSession } from "./SpeakingSession.js";
import { WritingSession } from "./WritingSession.js";
import { useExamAttempts } from "./Exam.js";
import { pct } from "../../format.js";
import "./exam.css";

const MODE_LABEL = { exam: "Mock exam", practice: "Practice" } as const;

/** A generated item as a one-item group (ids prefixed "ai-"). */
export function generatedGroup(part: ExamItemPart, view: GeneratedExamView, id: string): McGroup {
  const questions = view.item.questions.map((q, i) => ({
    ...q,
    id: `${id}-${i}`,
    explain: q.explain || "—",
  }));
  if (part === "lezen") {
    const item: ReadingText = {
      id,
      set: 0,
      kind: "notice",
      title: view.item.title,
      text: view.item.text,
      vocab: view.item.vocab,
      questions,
    };
    return { kind: "text", item };
  }
  const item: ListeningFragment = {
    id,
    set: 0,
    kind: "dialogue",
    context: view.item.text,
    lines: view.item.lines,
    vocab: view.item.vocab,
    questions,
  };
  return { kind: "fragment", item };
}

export function ExamPartRoute() {
  const { part } = useParams({ from: "/exam/$part" });
  const search = useSearch({ from: "/exam/$part" });
  if (!(EXAM_PARTS as readonly string[]).includes(part)) {
    return (
      <div className="page page--narrow exam">
        <EmptyState
          title="No such exam part"
          action={
            <Link to="/exam" className="k-btn k-btn--secondary">
              Back to Exam
            </Link>
          }
        />
      </div>
    );
  }
  return <ExamPartScreen part={part as ExamPart} {...search} />;
}

function ExamPartScreen({
  part,
  mode,
  set,
  theme,
}: {
  part: ExamPart;
  mode?: string;
  set?: string;
  theme?: string;
}) {
  const info = examPartInfo(part);
  const navigate = useNavigate();
  usePageHeader(info.nl, { parent: { label: "Exam", to: "/exam" } });
  const [generated, setGenerated] = useState<{ group: McGroup } | null>(null);
  const exit = () => {
    setGenerated(null);
    void navigate({ to: "/exam/$part", params: { part } });
  };
  const m = mode === "exam" || mode === "practice" ? mode : null;
  const setN = Number(set ?? "1") || 1;
  const bank = examBank();
  const limitMs = info.minutes * 60_000;

  if (generated && (part === "lezen" || part === "luisteren")) {
    return (
      <div className="page page--narrow exam">
        <McSession
          part={part}
          mode="practice"
          groups={[generated.group]}
          setId="ai"
          title="AI practice text"
          limitMs={limitMs}
          onExit={exit}
        />
      </div>
    );
  }

  if (m) {
    const title = theme
      ? `${MODE_LABEL[m]} · ${bank.knm.find((t) => t.id === theme)?.title ?? theme}`
      : `${MODE_LABEL[m]} · set ${setN}`;
    const setId = theme ? `theme:${theme}` : `set:${setN}`;
    let body;
    if (part === "lezen" || part === "luisteren" || part === "knm") {
      const groups = mcGroups(part, theme ? { theme } : { set: setN });
      body = groups.length ? (
        <McSession
          key={setId + m}
          part={part}
          mode={m}
          groups={groups}
          setId={setId}
          title={title}
          limitMs={limitMs}
          onExit={exit}
        />
      ) : null;
    } else if (part === "schrijven") {
      const tasks = theme
        ? bank.schrijven.tasks.filter((t) => t.id === theme)
        : bank.schrijven.tasks.filter((t) => t.set === setN);
      body = tasks.length ? (
        <WritingSession
          key={setId + m}
          mode={m}
          tasks={tasks}
          setId={theme ? `task:${theme}` : setId}
          title={theme ? `${MODE_LABEL[m]} · ${tasks[0]!.title}` : title}
          limitMs={limitMs}
          onExit={exit}
        />
      ) : null;
    } else {
      const prompts = bank.spreken.prompts.filter((p) => p.set === setN);
      body = prompts.length ? (
        <SpeakingSession
          key={setId + m}
          mode={m}
          prompts={prompts}
          setId={setId}
          title={title}
          onExit={exit}
        />
      ) : null;
    }
    return (
      <div className="page page--narrow exam">
        {body ?? (
          <EmptyState
            title="This practice set does not exist"
            action={
              <Button onClick={exit}>
                <ArrowLeft size={16} aria-hidden /> Back
              </Button>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="page page--narrow exam">
      <PageHeader
        title={
          <>
            <span lang="nl">{info.nl}</span> <span className="exam-title-en">{info.en}</span>
          </>
        }
        lede={info.format}
      />
      <p className="exam-part-facts">
        <Chip>{info.minutes} min</Chip> <Chip>{info.items}</Chip>{" "}
        <span className="exam-muted">
          Pass: {info.passRule}. {info.marking}
        </span>
      </p>

      <section aria-labelledby="exam-sets-h">
        <h2 id="exam-sets-h" className="exam-h2">
          Mock exams
        </h2>
        <ul className="exam-sets">
          {examSets(part).map((n) => (
            <li key={n} className="exam-set">
              <span className="exam-set-name">Set {n}</span>
              <span className="exam-muted">{setSize(part, n)}</span>
              <span className="exam-set-actions">
                <Link
                  to="/exam/$part"
                  params={{ part }}
                  search={{ mode: "practice", set: String(n) }}
                  className="k-btn k-btn--secondary k-btn--sm"
                >
                  Practise
                </Link>
                <Link
                  to="/exam/$part"
                  params={{ part }}
                  search={{ mode: "exam", set: String(n) }}
                  className="k-btn k-btn--primary k-btn--sm"
                >
                  <Timer size={14} aria-hidden /> Mock exam
                </Link>
              </span>
            </li>
          ))}
        </ul>
        <p className="exam-muted">
          Practice gives feedback after each answer. The mock exam is timed and shows your result at
          the end{part === "luisteren" ? "; each fragment can be played twice" : ""}.
        </p>
      </section>

      {part === "knm" ? (
        <section aria-labelledby="exam-themes-h">
          <h2 id="exam-themes-h" className="exam-h2">
            Practise by theme
          </h2>
          <ul className="exam-chips">
            {bank.knm.map((t) => (
              <li key={t.id}>
                <Link
                  to="/exam/$part"
                  params={{ part }}
                  search={{ mode: "practice", theme: t.id }}
                  className="exam-theme-link"
                >
                  <span lang="nl">{t.title}</span>
                  <span className="exam-muted">{t.questions.length}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {part === "schrijven" ? (
        <section aria-labelledby="exam-tasks-h">
          <h2 id="exam-tasks-h" className="exam-h2">
            Practise one task
          </h2>
          <ul className="exam-chips">
            {bank.schrijven.tasks.map((t) => (
              <li key={t.id}>
                <Link
                  to="/exam/$part"
                  params={{ part }}
                  search={{ mode: "practice", theme: t.id }}
                  className="exam-theme-link"
                >
                  <span lang="nl">{t.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {part === "lezen" || part === "luisteren" ? (
        <GenerateItem part={part} onReady={(group) => setGenerated({ group })} />
      ) : null}

      <History part={part} />
    </div>
  );
}

function setSize(part: ExamPart, n: number): string {
  const bank = examBank();
  if (part === "lezen" || part === "luisteren" || part === "knm") {
    const groups = mcGroups(part, { set: n });
    const qs = groups.reduce(
      (k, g) => k + (g.kind === "knm" ? g.questions.length : g.item.questions.length),
      0,
    );
    return part === "knm"
      ? `${qs} questions`
      : `${groups.length} ${part === "lezen" ? "texts" : "fragments"}, ${qs} questions`;
  }
  if (part === "schrijven")
    return `${bank.schrijven.tasks.filter((t) => t.set === n).length} tasks`;
  return `${bank.spreken.prompts.filter((p) => p.set === n).length} questions`;
}

/** "Generate a new practice text": only with an AI provider. */
function GenerateItem({ part, onReady }: { part: ExamItemPart; onReady: (g: McGroup) => void }) {
  const services = useServices();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  const gen = useMutation({
    mutationFn: () => services.generateExamItem(part),
    onSuccess: (view) => onReady(generatedGroup(part, view, `ai-${Date.now()}`)),
  });
  if (!status.data?.configured) return null;
  return (
    <section aria-labelledby="exam-ai-h" className="exam-ai-gen">
      <h2 id="exam-ai-h" className="exam-h2">
        A new practice {part === "lezen" ? "text" : "fragment"}
      </h2>
      <p className="exam-muted">
        Written by your AI provider at A2 around the words you know, and checked against your
        vocabulary.
      </p>
      <Button onClick={() => gen.mutate()} disabled={gen.isPending}>
        <Sparkles size={16} aria-hidden />{" "}
        {gen.isPending ? "Writing…" : "Generate a new practice text"}
      </Button>
      {gen.isError ? (
        <p className="exam-error" role="alert">
          {errorText(gen.error)}
        </p>
      ) : null}
    </section>
  );
}

function History({ part }: { part: ExamPart }) {
  const attempts = useExamAttempts();
  const mine = (attempts.data ?? []).filter((a) => a.part === part).reverse();
  if (mine.length === 0) return null;
  const pass = examPartInfo(part).passEstimate;
  return (
    <section aria-labelledby="exam-history-h">
      <h2 id="exam-history-h" className="exam-h2">
        Your results
      </h2>
      <ul className="exam-history">
        {mine.slice(0, 12).map((a) => (
          <li key={a.id}>
            <span>{a.mode === "exam" ? "Mock exam" : "Practice"}</span>
            <span className="exam-muted">{labelOf(a.setId)}</span>
            <span className="exam-muted">
              {new Date(a.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
            <Chip tone={a.total && a.correct / a.total >= pass ? "success" : "neutral"}>
              {a.correct}/{a.total} · {pct(a.total ? a.correct / a.total : 0)}
            </Chip>
          </li>
        ))}
      </ul>
    </section>
  );
}

function labelOf(setId: string): string {
  const [kind, value] = setId.split(":");
  if (kind === "set") return `Set ${value}`;
  if (kind === "theme") return examBank().knm.find((t) => t.id === value)?.title ?? value ?? "";
  if (kind === "task") return examBank().schrijven.tasks.find((t) => t.id === value)?.title ?? "";
  return setId === "ai" ? "AI text" : setId;
}
