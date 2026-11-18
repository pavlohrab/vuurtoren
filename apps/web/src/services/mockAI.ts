/** In-memory AI services for the demo build and UI tests (no network, no key handling). */
import type {
  AIServices,
  AISettings,
  ChatMessageView,
  ConversationView,
  NewWord,
  SimplifyView,
  StoryInput,
  StoryView,
} from "./aiTypes.js";

export interface MockAIOptions {
  /** Start with a provider configured (default true). */
  configured?: boolean;
  /** Store a story in the (mock) library; returns its id. */
  saveText?: (title: string, content: string) => string;
}

/** The demo's story (uses only common words plus the target words). */
export const MOCK_STORY = {
  title: "Een dag op de markt",
  text:
    "Op zaterdag ga ik naar de markt. Het is druk en gezellig. Bij een kraam koop ik brood en kaas.\n\n" +
    'De man achter de kraam is vriendelijk. Hij vraagt: "Wilt u nog iets?" Ik zeg: "Nee, dank u." ' +
    "Dan drink ik koffie met een vriendin. We praten over het weer.",
};

export const MOCK_NEW_WORD: NewWord = {
  lemma: "gezellig",
  gloss: "cosy, pleasant",
  example: "Het is hier gezellig.",
};

export function createMockAI(
  wait: () => Promise<void>,
  opts: MockAIOptions = {},
): AIServices & { added: NewWord[]; stories: StoryInput[] } {
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
  const stories: StoryInput[] = [];

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
    stories,
    async generateUnitExercises(_courseId, _unitN, onProgress) {
      onProgress?.("Writing exercises…");
      await wait();
      return { added: 6, rejected: 1, grammarTopic: "Presens" };
    },
    async storyTargets(source) {
      await wait();
      if (source.kind === "grammar") return [];
      if (source.kind === "unit") return ["kraam", "vriendelijk"];
      return ["gezellig", "kraam", "afspraak"];
    },
    async createStory(input, onProgress): Promise<StoryView> {
      onProgress?.("Writing the story…");
      await wait();
      onProgress?.("Checking it against your words…");
      await wait();
      stories.push(input);
      const missing = input.targetWords.filter(
        (w) => !MOCK_STORY.text.toLowerCase().includes(w.toLowerCase()),
      );
      const title = input.topic.trim() ? `${MOCK_STORY.title}` : MOCK_STORY.title;
      const textId = opts.saveText?.(title, MOCK_STORY.text) ?? `story-${stories.length}`;
      return {
        textId,
        title,
        coverage: 0.97,
        rewritten: false,
        missingTargets: missing,
        parseFailed: false,
      };
    },
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
    async addConversationWord(word, opts) {
      await wait();
      added.push(word);
      return { deck: opts?.deck ?? "Kenning::Nederlands::Converse" };
    },
    async aiExplainSentence(sentence, grammar) {
      await wait();
      const points = grammar?.length
        ? grammar.map((g) => `- ${g.title}: ${g.note}`).join("\n")
        : "- Word order: verb second.";
      return `Meaning of "${sentence}": a mock explanation.\n${points}`;
    },
    async aiSimplify(text): Promise<SimplifyView> {
      await wait();
      return { simplified: `Simpel: ${text.slice(0, 80)}`, before: 0.88, after: 0.97, unknown: [] };
    },
  };
}
