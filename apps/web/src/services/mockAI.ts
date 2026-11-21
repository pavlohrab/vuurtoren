/** In-memory AI services for the demo build and UI tests (no network, no key handling). */
import { modelOptions } from "@app/ai";
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
import type { ExamItemPart, ExamServices, GeneratedExamItem } from "./examTypes.js";

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

/** The demo's generated exam items. */
const MOCK_EXAM_ITEM: Record<ExamItemPart, GeneratedExamItem> = {
  lezen: {
    title: "Nieuwe openingstijden",
    text: "Supermarkt De Hoek\n\nVanaf 1 mei zijn we op zondag open van 12.00 tot 18.00 uur.\nOp maandag t/m zaterdag blijven we open van 8.00 tot 21.00 uur.\n\nTot ziens in de winkel!",
    lines: [],
    questions: [
      {
        q: "Wat is er nieuw?",
        options: [
          "De winkel is op zondag open.",
          "De winkel gaat eerder dicht.",
          "De winkel verhuist.",
        ],
        answer: 0,
        explain: "From 1 May the shop opens on Sundays.",
      },
      {
        q: "Hoe laat gaat de winkel op zaterdag dicht?",
        options: ["Om 18.00 uur.", "Om 12.00 uur.", "Om 21.00 uur."],
        answer: 2,
        explain: "Monday to Saturday 8.00–21.00.",
      },
    ],
    vocab: { openingstijden: "opening hours", blijven: "to stay" },
  },
  luisteren: {
    title: "Bij de kapper",
    text: "Een vrouw belt de kapper.",
    lines: [
      { who: "Kapper", voice: "m", text: "Kapsalon Knip, goedemiddag." },
      { who: "Vrouw", voice: "f", text: "Hallo, kan ik morgen om tien uur komen?" },
      { who: "Kapper", voice: "m", text: "Om tien uur niet, maar om elf uur wel." },
      { who: "Vrouw", voice: "f", text: "Elf uur is goed. Tot morgen!" },
    ],
    questions: [
      {
        q: "Hoe laat gaat de vrouw morgen naar de kapper?",
        options: ["Om 10.00 uur.", "Om 11.00 uur.", "Om 12.00 uur."],
        answer: 1,
        explain: "Ten is full; she takes eleven.",
      },
    ],
    vocab: { kapper: "hairdresser" },
  },
};

export function createMockAI(
  wait: () => Promise<void>,
  opts: MockAIOptions = {},
): AIServices &
  Pick<ExamServices, "generateExamItem" | "examFeedback"> & {
    added: NewWord[];
    stories: StoryInput[];
  } {
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
    async generateExamItem(part) {
      await wait();
      return { item: MOCK_EXAM_ITEM[part], coverage: 0.97, rewritten: false };
    },
    async examFeedback(input) {
      await wait();
      return {
        summary: "Your message is clear and polite. Two small verb errors.",
        points: input.points.map((point, i) => ({
          point,
          ok: i !== input.points.length - 1,
          note: i !== input.points.length - 1 ? "Done." : "Add this to get the full mark.",
        })),
        corrections: [{ wrong: "ik komen", right: "ik kom", why: "The verb agrees with ik." }],
        improved: input.answer.replace(/\bik komen\b/gi, "ik kom"),
        parseFailed: false,
      };
    },
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
    async listAIModels(input) {
      return { options: modelOptions(input.provider, null), live: false };
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
      return { deck: opts?.deck ?? "Vuurtoren::Nederlands::Converse" };
    },
    async aiExplainSentence(sentence, grammar) {
      await wait();
      const points = grammar?.length
        ? grammar.map((g) => `- ${g.title}: ${g.note}`).join("\n")
        : "- Word order: verb second.";
      return `Meaning of "${sentence}": a mock explanation.\n${points}`;
    },
    async aiAskAboutSentence(_sentence, _explanation, turns, question) {
      await wait();
      return `Answer ${turns.length + 1}: about "${question}", **keek** comes second.`;
    },
    async aiSimplify(text): Promise<SimplifyView> {
      await wait();
      return { simplified: `Simpel: ${text.slice(0, 80)}`, before: 0.88, after: 0.97, unknown: [] };
    },
  };
}
