import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Chip,
  EmptyState,
  Input,
  Skeleton,
  Spinner,
  difficultyBand,
  useToast,
} from "@app/ui";
import { useServices } from "../services/context.js";
import type { ChatMessageView, ConversationView, NewWord } from "../services/aiTypes.js";
import "./converse.css";

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : "Try again.");
const TONE = {
  comfortable: "success",
  stretch: "accent",
  challenging: "warm",
  weave: "warm",
} as const;

/** One partner message with its coverage chip, glosses and new-word chips. */
function PartnerMessage({
  m,
  added,
  onAdd,
}: {
  m: ChatMessageView;
  added: Set<string>;
  onAdd: (w: NewWord) => void;
}) {
  const glosses = Object.entries(m.glosses ?? {});
  const unknownWithout = (m.unknown ?? []).filter((u) => !(m.glosses ?? {})[u]);
  return (
    <div className="cv-msg">
      <div className="cv-bubble" lang="nl">
        {m.text}
      </div>
      <div className="cv-meta">
        {m.coverage !== null && m.coverage !== undefined ? (
          <Chip
            tone={TONE[difficultyBand(m.coverage)]}
            title="Share of the words in this reply that you know"
          >
            {Math.round(m.coverage * 100)}% known
          </Chip>
        ) : null}
        {m.rewritten ? <span>Simplified once to fit your vocabulary</span> : null}
        {m.parseFailed ? <span>The answer came in an unexpected format</span> : null}
        {glosses.map(([w, g]) => (
          <span key={w}>
            <b>{w}</b>: {g}
          </span>
        ))}
        {unknownWithout.length ? <span>Not sure of: {unknownWithout.join(", ")}</span> : null}
      </div>
      {(m.newWords ?? []).map((w) => (
        <div className="cv-new" key={w.lemma}>
          <Chip tone="warm">
            {w.lemma} · {w.gloss}
          </Chip>
          {w.example ? <span lang="nl">{w.example}</span> : null}
          <Button
            size="sm"
            disabled={added.has(w.lemma)}
            onClick={() => onAdd(w)}
            aria-label={`Add ${w.lemma} to Anki`}
          >
            {added.has(w.lemma) ? "Added" : "Add to Anki"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function UserMessage({ m }: { m: ChatMessageView }) {
  return (
    <div className="cv-msg cv-msg--user">
      <div className="cv-bubble" lang="nl">
        {m.text}
      </div>
      {(m.corrections ?? []).map((c, i) => (
        <div className="cv-fix" key={i} role="note">
          <span lang="nl">
            <del>{c.original}</del> <ins>{c.corrected}</ins>
          </span>
          {c.explanation ? <span>{c.explanation}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** Converse: talk with a partner who keeps to words you know (needs an AI provider in Settings). */
export function Converse() {
  const services = useServices();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  const past = useQuery({
    queryKey: ["conversations"],
    queryFn: () => services.listConversations(),
  });
  const suggested = useQuery({
    queryKey: ["ai-targets"],
    queryFn: () => services.suggestTargetWords(),
  });
  const [conv, setConv] = useState<ConversationView | null>(null);
  const [topic, setTopic] = useState("");
  const [targets, setTargets] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [conv?.messages.length, pending]);

  const start = useMutation({
    mutationFn: () =>
      services.startConversation({
        topic: topic.trim() || "everyday life",
        targetWords: (targets ?? (suggested.data ?? []).join(", "))
          .split(/[,\n]/)
          .map((w) => w.trim())
          .filter(Boolean),
      }),
    onSuccess: async (c) => {
      setConv(c);
      await qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
  const send = useMutation({
    mutationFn: (text: string) => {
      setPending(text);
      return services.sendConversationMessage(conv!.id, text);
    },
    onSuccess: (c) => {
      setConv(c);
      setDraft("");
    },
    onSettled: () => setPending(null),
  });
  const add = useMutation({
    mutationFn: (w: NewWord) => services.addConversationWord(w),
    onSuccess: (r, w) => {
      setAdded((s) => new Set(s).add(w.lemma));
      toast(`Added “${w.lemma}” to ${r.deck}`);
    },
    onError: (e) => toast("Could not add the word to Anki", message(e)),
  });

  if (!status.data) {
    return (
      <div className="page page--narrow">
        <Skeleton style={{ height: 160 }} />
      </div>
    );
  }
  if (!status.data.configured) {
    return (
      <div className="page page--narrow">
        <EmptyState
          icon={<MessagesSquare size={28} />}
          title="Converse"
          description={
            status.data.locked
              ? "Your API key is locked. Unlock it in Settings to start talking."
              : "Talk with a partner who keeps to words you know, with gentle corrections. Add an AI provider and your own key in Settings first."
          }
          action={
            <Link to="/settings" className="k-btn k-btn--primary">
              Open Settings
            </Link>
          }
        />
      </div>
    );
  }

  if (!conv) {
    return (
      <div className="page page--narrow">
        <h1>Converse</h1>
        <p className="page-lede">
          A short chat in Dutch that stays within the words you know, with corrections of your own
          messages.
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <Input
            label="Topic"
            value={topic}
            placeholder="Ordering coffee, my weekend, ..."
            onChange={(e) => setTopic(e.target.value)}
          />
          <Input
            label="Words to practise"
            value={targets ?? (suggested.data ?? []).join(", ")}
            hint="Comma separated. The partner works these in; new words can go to Anki."
            onChange={(e) => setTargets(e.target.value)}
          />
          <div className="row">
            <Button type="submit" variant="primary" disabled={start.isPending}>
              {start.isPending ? <Spinner label="Starting" /> : null}
              Start conversation
            </Button>
          </div>
          {start.isError ? (
            <p role="alert" className="error-text" style={{ margin: 0 }}>
              {message(start.error)}
            </p>
          ) : null}
        </form>
        {past.data && past.data.length > 0 ? (
          <section style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 19 }}>Earlier conversations</h2>
            <ul className="cv-past">
              {past.data.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={async () => {
                      const v = await services.getConversation(c.id);
                      if (v) setConv(v);
                    }}
                  >
                    <b>{c.topic}</b> <span className="k-hint">{c.messages} messages</span>
                    <br />
                    <span className="k-hint">{c.preview}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>{conv.topic}</h1>
        <Button variant="ghost" onClick={() => setConv(null)}>
          New conversation
        </Button>
      </div>
      <div className="cv-list" aria-live="polite">
        {conv.messages.map((m) =>
          m.role === "assistant" ? (
            <PartnerMessage key={m.id} m={m} added={added} onAdd={(w) => add.mutate(w)} />
          ) : (
            <UserMessage key={m.id} m={m} />
          ),
        )}
        {pending ? (
          <div className="cv-msg cv-msg--user">
            <div className="cv-bubble" lang="nl">
              {pending}
            </div>
            <Spinner label="Waiting for the reply" />
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      <form
        className="cv-compose stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !send.isPending) send.mutate(draft.trim());
        }}
      >
        <Input
          aria-label="Your message"
          value={draft}
          lang="nl"
          placeholder="Schrijf in het Nederlands..."
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="row">
          <Button type="submit" variant="primary" disabled={send.isPending || !draft.trim()}>
            Send
          </Button>
        </div>
        {send.isError ? (
          <p role="alert" className="error-text" style={{ margin: 0 }}>
            {message(send.error)} Your message is still in the box.
          </p>
        ) : null}
      </form>
    </div>
  );
}
