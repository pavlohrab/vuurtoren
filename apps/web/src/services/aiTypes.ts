/** Contract of the AI services (M6). Keys never appear here except as write-only arguments. */
import type { Correction, NewWord, ProviderId } from "@app/ai";

export type { Correction, NewWord, ProviderId };

/** Provider choice, stored per device (never in the database or backups). */
export interface AISettings {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  /** Free text the user keeps about their monthly spend limit. */
  budgetNote: string;
}

export interface AIStatus {
  /** A provider is usable right now (key present or not needed, and unlocked). */
  configured: boolean;
  /** A passphrase-encrypted key is saved but not yet unlocked this session. */
  locked: boolean;
  keySaved: boolean;
  encrypted: boolean;
  needsKey: boolean;
  label: string;
}

/** Rough local tally of this month's calls (not the provider's bill). */
export interface AIUsage {
  month: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ConversationListItem {
  id: string;
  topic: string;
  messages: number;
  preview: string;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Assistant: share of words you know, null when the language server was unavailable. */
  coverage?: number | null;
  rewritten?: boolean;
  /** Assistant: words you may not know in this reply, with glosses where found. */
  unknown?: string[];
  glosses?: Record<string, string>;
  newWords?: NewWord[];
  /** User: corrections of this message (given in the partner's next reply). */
  corrections?: Correction[];
  parseFailed?: boolean;
}

export interface ConversationView {
  id: string;
  topic: string;
  targetWords: string[];
  messages: ChatMessageView[];
}

export interface SimplifyView {
  simplified: string;
  before: number | null;
  after: number | null;
  unknown: string[];
}

/** The AI part of AppServices. */
export interface AIServices {
  getAISettings(): Promise<AISettings>;
  saveAISettings(patch: Partial<AISettings>): Promise<void>;
  aiStatus(): Promise<AIStatus>;
  /** Save the key on this device; with a passphrase it is stored encrypted. */
  saveAIKey(key: string, passphrase?: string): Promise<void>;
  clearAIKey(): Promise<void>;
  /** Decrypt the saved key for this session. Throws on a wrong passphrase. */
  unlockAI(passphrase: string): Promise<void>;
  /** One tiny request to check the key, model and address. */
  testAI(): Promise<{ text: string; ms: number }>;
  aiUsage(): Promise<AIUsage>;
  listConversations(): Promise<ConversationListItem[]>;
  getConversation(id: string): Promise<ConversationView | null>;
  /** Create a conversation and get the partner's opening message. */
  startConversation(input: { topic: string; targetWords?: string[] }): Promise<ConversationView>;
  /** Send your message; resolves with the whole conversation including the partner's reply. */
  sendConversationMessage(id: string, text: string): Promise<ConversationView>;
  /** Words you are learning, as default practice targets. */
  suggestTargetWords(): Promise<string[]>;
  /** Make a card for a word the partner introduced (uses the Anki target deck). */
  addConversationWord(word: NewWord): Promise<{ deck: string }>;
  aiExplainSentence(sentence: string): Promise<string>;
  aiSimplify(text: string): Promise<SimplifyView>;
}
