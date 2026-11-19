import { pct } from "../format.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowRight, BookmarkPlus, ChevronRight, MessagesSquare, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type AddDeckChoice,
  AddToAnki,
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
import { useDeckChoice } from "./useDeckChoice.js";
import { PageHeader } from "../shell/PageHeader.js";
import { readLastText } from "../lastText.js";
import { pickContinue } from "./Home.js";
import "./converse.css";

/** A suggested way to start a conversation. */
interface TalkStart {
  id: string;
  title: string;
  hint: string;
  topic: string;
  words: string[];
}

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
  addDeck,
}: {
  m: ChatMessageView;
  added: Set<string>;
  onAdd: (w: NewWord) => void;
  /** Destination deck and picker (absent while loading: a plain button). */
  addDeck?: AddDeckChoice | undefined;
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
            {pct(m.coverage)} known
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
          {addDeck && !added.has(w.lemma) ? (
            <AddToAnki
              {...addDeck}
              size="sm"
              variant="secondary"
              subject={w.lemma}
              onAdd={() => onAdd(w)}
            />
          ) : (
            <Button
              size="sm"
              disabled={added.has(w.lemma)}
              onClick={() => onAdd(w)}
              aria-label={`Add ${w.lemma} to Anki`}
            >
              {added.has(w.lemma) ? "Added" : "Add to Anki"}
            </Button>
          )}
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

/** A topic as a title: sentence case ("ordering coffee" → "Ordering coffee"). */
export function topicTitle(topic: string): string {
  const t = topic.trim();
  return t ? t[0]!.toLocaleUpperCase() + t.slice(1) : "Conversation";
}

/** A conversation as a reading text: one paragraph per turn, as a Dutch dialogue (— …). */
export function conversationText(c: ConversationView): string {
  return c.messages
    .map((m) => m.text.trim())
    .filter(Boolean)
    .map((t) => `— ${t}`)
    .join("\n\n");
}

/** Talk (route /talk): talk with a partner who keeps to words you know (needs an AI provider in Settings). */
export function Converse() {
  const services = useServices();
  const navigate = useNavigate();
  // Seeds from Practice, Words, a course unit or a text: /talk?words=a,b&topic=…
  const seed: { words?: string; topic?: string } = useSearch({ from: "/talk" });
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
  const [topic, setTopic] = useState(seed.topic ?? "");
  const [targets, setTargets] = useState<string | null>(
    seed.words
      ? seed.words
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean)
          .join(", ")
      : null,
  );
  const [savedAs, setSavedAs] = useState<{ conv: string; textId: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [conv?.messages.length, pending]);

  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const [starting, setStarting] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: (opts: { topic: string; targetWords: string[] }) =>
      services.startConversation(opts),
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
  const save = useMutation({
    mutationFn: (c: ConversationView) =>
      services.importText({
        kind: "talk",
        title: `Talk: ${topicTitle(c.topic)}`,
        content: conversationText(c),
        ref: `talk:${c.id}`,
      }),
    onSuccess: async (textId, c) => {
      setSavedAs({ conv: c.id, textId });
      toast("Saved to your Library", "Read it again later, with its new words highlighted.");
      await qc.invalidateQueries({ queryKey: ["texts"] });
    },
    onError: (e) => toast("Could not save the conversation", message(e)),
  });
  const deckChoice = useDeckChoice("converse");
  const add = useMutation({
    mutationFn: (w: NewWord) =>
      services.addConversationWord(w, deckChoice.chosen ? { deck: deckChoice.chosen } : undefined),
    onSuccess: (r, w) => {
      setAdded((s) => new Set(s).add(w.lemma));
      toast(`Added “${w.lemma}” to ${r.deck}`);
    },
    onError: (e) => toast("Could not add the word to Anki", message(e)),
  });

  if (!status.data) {
    return (
      <div className="page page--list">
        <Skeleton style={{ height: 160 }} />
      </div>
    );
  }
  if (!status.data.configured) {
    return (
      <div className="page page--list">
        <EmptyState
          icon={<MessagesSquare size={20} />}
          title="Talk in Dutch"
          description={
            status.data.locked
              ? "Your API key is locked. Unlock it in Settings to start talking."
              : "Talk with a partner who keeps to words you know, with gentle corrections. Add an AI provider and your own key in Settings first."
          }
          action={
            <Link to="/settings" search={{ section: "ai" }} className="k-btn k-btn--primary">
              Open Settings
            </Link>
          }
        />
      </div>
    );
  }

  if (!conv) {
    const words = suggested.data ?? [];
    const reading = texts.data ? pickContinue(texts.data, readLastText()) : null;
    const starts: TalkStart[] = [
      ...(reading
        ? [
            {
              id: "text",
              title: `About ${reading.text.title}`,
              hint: reading.started ? "The text you are reading" : "The next text in your Library",
              topic: reading.text.title,
              words: words.slice(0, 5),
            },
          ]
        : []),
      ...(words.length
        ? [
            {
              id: "words",
              title: "Your words to learn",
              hint: words.slice(0, 5).join(", "),
              topic: "my week",
              words: words.slice(0, 5),
            },
          ]
        : []),
      {
        id: "everyday",
        title: "Everyday life",
        hint: "Shopping, the weather, your weekend",
        topic: "everyday life",
        words: [],
      },
    ];
    const seeded = Boolean(seed.topic || seed.words);
    return (
      <div className="page page--list">
        <PageHeader
          title="Talk"
          lede="A short chat in Dutch that stays within the words you know, with corrections of your own messages."
        />
        <div className="page-split">
          <div className="cv-start">
            <ul className="k-list" aria-label="Ways to start">
              {starts.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="k-row"
                    disabled={start.isPending}
                    onClick={() => {
                      setStarting(s.id);
                      start.mutate({ topic: s.topic, targetWords: s.words });
                    }}
                  >
                    <MessagesSquare size={16} className="k-row-go" aria-hidden />
                    <span className="k-row-main">
                      <span className="k-row-title">{s.title}</span>
                      <span className="k-row-hint" lang={s.id === "words" ? "nl" : undefined}>
                        {s.hint}
                      </span>
                    </span>
                    {start.isPending && starting === s.id ? (
                      <Spinner label="Starting" />
                    ) : (
                      <ArrowRight size={16} className="k-row-go" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <details className="k-disclosure cv-own" open={seeded || undefined}>
              <summary>
                <ChevronRight size={16} className="k-disclosure-icon" aria-hidden />
                Your own topic
              </summary>
              <form
                className="stack k-disclosure-body"
                onSubmit={(e) => {
                  e.preventDefault();
                  setStarting("own");
                  start.mutate({
                    topic: topic.trim() || "everyday life",
                    targetWords: (targets ?? words.join(", "))
                      .split(/[,\n]/)
                      .map((w) => w.trim())
                      .filter(Boolean),
                  });
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
                  value={targets ?? words.join(", ")}
                  hint="Comma separated. The partner works these in."
                  onChange={(e) => setTargets(e.target.value)}
                />
                <div className="row">
                  <Button type="submit" variant="primary" disabled={start.isPending}>
                    {start.isPending && starting === "own" ? <Spinner label="Starting" /> : null}
                    Start conversation
                  </Button>
                </div>
              </form>
            </details>
            {start.isError ? (
              <p role="alert" className="error-text" style={{ margin: 0 }}>
                {message(start.error)}
              </p>
            ) : null}
          </div>
          <section className="page-aside" aria-labelledby="cv-past-h">
            <h2 id="cv-past-h">Earlier conversations</h2>
            {past.data && past.data.length > 0 ? (
              <ul className="cv-past">
                {past.data.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={async () => {
                        const v = await services.getConversation(c.id);
                        if (v) setConv(v);
                      }}
                    >
                      <span className="cv-past-title">{topicTitle(c.topic)}</span>
                      <span className="cv-past-hint">
                        {c.messages} messages · {c.preview}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : past.data ? (
              <p>No conversations yet. Your chats are kept here to come back to.</p>
            ) : (
              <Skeleton style={{ height: 48 }} />
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--list cv-page">
      <PageHeader
        title={topicTitle(conv.topic)}
        lede={
          conv.targetWords.length ? (
            <>
              Practising <span lang="nl">{conv.targetWords.join(", ")}</span>
            </>
          ) : (
            "A short chat within the words you know."
          )
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => setConv(null)}>
              <Plus size={16} aria-hidden /> New
            </Button>
            {savedAs?.conv === conv.id ? (
              <Button
                variant="secondary"
                onClick={() =>
                  void navigate({ to: "/read/$textId", params: { textId: savedAs.textId } })
                }
              >
                Read in Library
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={save.isPending || conv.messages.length === 0}
                onClick={() => save.mutate(conv)}
              >
                <BookmarkPlus size={16} aria-hidden />{" "}
                {save.isPending ? "Saving…" : "Save to Library"}
              </Button>
            )}
          </>
        }
      />
      <div className="cv-list" aria-live="polite">
        {conv.messages.map((m) =>
          m.role === "assistant" ? (
            <PartnerMessage
              key={m.id}
              m={m}
              added={added}
              onAdd={(w) => add.mutate(w)}
              addDeck={deckChoice.addDeck}
            />
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
