import type { Conversation } from "@app/db";
import type { ChatMessageView, ConversationView, Correction, NewWord } from "./aiTypes.js";

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Turn the stored conversation into what the screen shows. The corrections the partner gave
 * with a reply belong to the learner message before it, so they are attached there.
 */
export function toConversationView(c: Conversation): ConversationView {
  const messages: ChatMessageView[] = c.messages.map((m) => {
    const meta = m.meta ?? {};
    if (m.role === "user") return { id: m.id, role: "user", text: m.text };
    return {
      id: m.id,
      role: "assistant",
      text: m.text,
      coverage: typeof meta["coverage"] === "number" ? meta["coverage"] : null,
      rewritten: meta["rewritten"] === true,
      unknown: arr<string>(meta["unknown"]),
      glosses: (meta["glosses"] as Record<string, string> | undefined) ?? {},
      newWords: arr<NewWord>(meta["newWords"]),
      parseFailed: meta["parseFailed"] === true,
    };
  });
  c.messages.forEach((m, i) => {
    if (m.role !== "assistant") return;
    const corrections = arr<Correction>(m.meta?.["corrections"]);
    const prev = messages[i - 1];
    if (corrections.length && prev?.role === "user") prev.corrections = corrections;
  });
  return { id: c.id, topic: c.topic, targetWords: c.targetWords, messages };
}
