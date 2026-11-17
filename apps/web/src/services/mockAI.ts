/** In-memory AI services for the demo build and UI tests (no network, no key handling). */
import type {
  AIServices,
  AISettings,
  ChatMessageView,
  ConversationView,
  NewWord,
  SimplifyView,
} from "./aiTypes.js";

export interface MockAIOptions {
  /** Start with a provider configured (default true). */
  configured?: boolean;
}

export const MOCK_NEW_WORD: NewWord = {
  lemma: "gezellig",
  gloss: "cosy, pleasant",
  example: "Het is hier gezellig.",
};

export function createMockAI(
  wait: () => Promise<void>,
  opts: MockAIOptions = {},
): AIServices & { added: NewWord[] } {
  let keySaved = opts.configured ?? true;
  let encrypted = false;
  let unlocked = true;
  let settings: AISettings = {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-haiku-5-5",
    budgetNote: "",
  };
  const convs = new Map<string, ConversationView>();
  const added: NewWord[] = [];

  const reply = (n: number): ChatMessageView => ({
    id: `a${n}`,
    role: "assistant",
    text: n === 0 ? "Hoi! Drink je graag koffie?" : "Wat leuk. Waar drink je koffie?",
    coverage: n === 0 ? 0.98 : 0.93,
    rewritten: n > 0,
    unknown: n > 0 ? ["café"] : [],
    glosses: n > 0 ? { café: "coffee shop" } : {},
    newWords: n === 0 ? [MOCK_NEW_WORD] : [],
  });

  return {
    added,
    async getAISettings() {
      return settings;
    },
    async saveAISettings(p) {
      settings = { ...settings, ...p };
    },
    async aiStatus() {
      return {
        configured: keySaved && unlocked,
        locked: keySaved && !unlocked,
        keySaved,
        encrypted,
        needsKey: true,
        label: "Anthropic (Claude)",
      };
    },
    async saveAIKey(_key, passphrase) {
      keySaved = true;
      encrypted = !!passphrase;
      unlocked = true;
    },
    async clearAIKey() {
      keySaved = false;
      encrypted = false;
    },
    async unlockAI(passphrase) {
      if (passphrase !== "secret") throw new Error("Wrong passphrase.");
      unlocked = true;
    },
    async testAI() {
      await wait();
      return { text: "OK", ms: 120 };
    },
    async aiUsage() {
      return { month: "2026-11", calls: 3, inputTokens: 4200, outputTokens: 300 };
    },
    async listConversations() {
      return [...convs.values()].map((c) => ({
        id: c.id,
        topic: c.topic,
        messages: c.messages.length,
        preview: c.messages.at(-1)?.text ?? "",
      }));
    },
    async getConversation(id) {
      return convs.get(id) ?? null;
    },
    async startConversation({ topic, targetWords = [] }) {
      await wait();
      const c: ConversationView = {
        id: `c${convs.size + 1}`,
        topic,
        targetWords,
        messages: [reply(0)],
      };
      convs.set(c.id, c);
      return c;
    },
    async sendConversationMessage(id, text) {
      await wait();
      const c = convs.get(id);
      if (!c) throw new Error("Conversation not found");
      const user: ChatMessageView = {
        id: `u${c.messages.length}`,
        role: "user",
        text,
        corrections: [{ original: "ik is", corrected: "ik ben", explanation: "zijn: ik ben" }],
      };
      const next = { ...c, messages: [...c.messages, user, reply(c.messages.length)] };
      convs.set(id, next);
      return next;
    },
    async suggestTargetWords() {
      return ["gezellig", "afspraak"];
    },
    async addConversationWord(word) {
      await wait();
      added.push(word);
      return { deck: "Kenning::Nederlands" };
    },
    async aiExplainSentence(sentence) {
      await wait();
      return `Meaning of "${sentence}": a mock explanation.\n- Word order: verb second.`;
    },
    async aiSimplify(text): Promise<SimplifyView> {
      await wait();
      return { simplified: `Simpel: ${text.slice(0, 80)}`, before: 0.88, after: 0.97, unknown: [] };
    },
  };
}
