/**
 * The end of a text: a calm panel with what happened (new words met, in Anki, still to decide)
 * and where to go next — Words from this text, Practise these words, Talk about this text,
 * Next text. No confetti.
 */
import { useEffect } from "react";
import { play as playSound } from "../practice/feel.js";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Dumbbell,
  ListChecks,
  MessagesSquare,
  RotateCcw,
} from "lucide-react";
import { Button, Skeleton, useNativeMode } from "@app/ui";
import { readLastText } from "../lastText.js";
import { useServices } from "../services/context.js";
import { pickContinue } from "../textPages.js";
import { useAIReady } from "./StoryForm.js";

const fmt = (n: number) => n.toLocaleString("en");

export function TextComplete({
  textId,
  title,
  wordCount,
  onReadAgain,
}: {
  textId: string;
  title: string;
  wordCount: number;
  onReadAgain: () => void;
}) {
  const services = useServices();
  const native = useNativeMode();
  // Talk needs the learner's own AI: without one the link would lead to a setup page.
  const aiReady = useAIReady();
  const words = useQuery({
    queryKey: ["textWords", textId],
    queryFn: () => services.textWords(textId),
    retry: false,
  });
  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const others = (texts.data ?? []).filter((t) => t.id !== textId);
  const last = readLastText();
  const next = pickContinue(others, last === textId ? null : last);

  const list = words.data ?? [];
  const inAnki = list.filter(
    (w) => w.entry.anki.status !== "absent" && w.entry.anki.status !== "unavailable",
  ).length;
  const toDecide = list.filter((w) => w.entry.anki.status === "absent").length;
  const keys = list.map((w) => w.key);
  const talkWords = list.slice(0, 6).map((w) => w.lemma);

  useEffect(() => {
    playSound("done");
  }, []);

  return (
    <section className="text-done" aria-labelledby="text-done-h">
      {/* A checkmark that draws itself, with the three-note chime (mock-reader-book-2.html). */}
      <svg className="text-done-check" viewBox="0 0 90 90" aria-hidden>
        <circle cx="45" cy="45" r="40" />
        <path d="M27 46 l12 12 l24 -26" />
      </svg>
      <p className="k-overline">Finished</p>
      <h2 id="text-done-h" className="text-done-title">
        {title}
      </h2>
      <p className="text-done-lede">
        You read all {fmt(wordCount)} words. Here is what you met and where to go next.
      </p>
      {words.isPending ? (
        <Skeleton style={{ height: 72, width: "100%" }} />
      ) : (
        <dl className="text-done-stats">
          <div>
            <dt>New words</dt>
            <dd>{fmt(list.length)}</dd>
          </div>
          <div>
            <dt>{native ? "In your words" : "In Anki"}</dt>
            <dd className="text-done-known">{fmt(inAnki)}</dd>
          </div>
          <div>
            <dt>Still to decide</dt>
            <dd className="text-done-learn">{fmt(toDecide)}</dd>
          </div>
        </dl>
      )}
      <nav className="text-done-next" aria-label="Next steps">
        <Link
          to="/read/$textId/words"
          params={{ textId }}
          className="k-btn k-btn--primary text-done-primary"
        >
          <ListChecks size={16} aria-hidden /> Words from this text
        </Link>
        <Link
          to="/practice"
          search={keys.length ? { words: keys.join(",") } : {}}
          className="practice-next-link"
        >
          <Dumbbell size={18} aria-hidden />
          <span>Practise these words</span>
          <ArrowRight size={16} aria-hidden />
        </Link>
        {aiReady ? (
          <Link
            to="/talk"
            search={{ topic: title, ...(talkWords.length ? { words: talkWords.join(",") } : {}) }}
            className="practice-next-link"
          >
            <MessagesSquare size={18} aria-hidden />
            <span>Talk about this text</span>
            <ArrowRight size={16} aria-hidden />
          </Link>
        ) : null}
        {next ? (
          <Link to="/read/$textId" params={{ textId: next.text.id }} className="practice-next-link">
            <BookOpen size={18} aria-hidden />
            <span>
              Next text
              <small>{next.text.title}</small>
            </span>
            <ArrowRight size={16} aria-hidden />
          </Link>
        ) : (
          <Link to="/" className="practice-next-link">
            <BookOpen size={18} aria-hidden />
            <span>
              Next text
              <small>Pick a story or one of your texts</small>
            </span>
            <ArrowRight size={16} aria-hidden />
          </Link>
        )}
      </nav>
      <Button variant="ghost" size="sm" onClick={onReadAgain}>
        <RotateCcw size={14} aria-hidden /> Read it again
      </Button>
    </section>
  );
}
