/**
 * Conversation projection: folds ConversationStarted / MessageAdded events into conversations.
 * Pure and table-free, so it needs no schema migration and works the same for the local and
 * the HTTP repository (both serve `conversationEvents()`).
 */
import type { StoredEvent } from "./types.js";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  lang: string;
  topic: string;
  targetWords: string[];
  messages: ConversationMessage[];
}

/** Conversations in start order (oldest first). Messages for unknown conversations are dropped. */
export function projectConversations(events: readonly StoredEvent[]): Conversation[] {
  const byId = new Map<string, Conversation>();
  for (const { event: e } of events) {
    if (e.type === "ConversationStarted") {
      byId.set(e.conversationId, {
        id: e.conversationId,
        lang: e.lang,
        topic: e.topic,
        targetWords: e.targetWords,
        messages: [],
      });
    } else if (e.type === "MessageAdded") {
      const c = byId.get(e.conversationId);
      if (!c || c.messages.some((m) => m.id === e.messageId)) continue;
      c.messages.push({
        id: e.messageId,
        role: e.role,
        text: e.text,
        ...(e.meta ? { meta: e.meta } : {}),
      });
    }
  }
  return [...byId.values()];
}
