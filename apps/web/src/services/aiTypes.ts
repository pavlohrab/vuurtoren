/** Contract of the AI services. Keys never appear here except as write-only arguments. */
import type { GenerateUnitResult } from "./courseTypes.js";
import type {
  StoryMix,
  SentenceTurn,
  Correction,
  ModelOption,
  NewWord,
  ProviderId,
  StoryLength,
  StoryStyle,
} from "@app/ai";

export type { Correction, NewWord, StoryLength, StoryStyle };

/** Models offered by the picker; `live` when they came from the provider itself. */
export interface ModelChoices {
  options: ModelOption[];
  live: boolean;
}

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

interface ConversationListItem {
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
  /** User: the whole message, corrected (with corrections only). */
  corrected?: string;
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
  /**
   * Models for the picker: the provider's own list (with `key`, else the saved key), cached per
   * provider and address for this session; the curated list when it cannot be read.
   */
  listAIModels(
    input: { provider: ProviderId; baseUrl: string },
    key?: string,
  ): Promise<ModelChoices>;
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
  /** Make a card for a word the partner introduced (Converse deck of the profile, or `opts.deck`). */
  addConversationWord(word: NewWord, opts?: { deck?: string }): Promise<{ deck: string }>;
  /**
   * Explain a sentence. `grammar`: constructions detected in it (topic title + note), passed to
   * the model as context.
   */
  aiExplainSentence(sentence: string, grammar?: ExplainGrammar[]): Promise<string>;
  /** A follow-up question about an explained sentence; `turns` are the earlier questions. */
  aiAskAboutSentence(
    sentence: string,
    explanation: string,
    turns: readonly SentenceTurn[],
    question: string,
  ): Promise<string>;
  aiSimplify(text: string): Promise<SimplifyView>;
  /** Suggested target words for a story (empty for a grammar topic: it features the topic). */
  storyTargets(source: StoryTargetSource): Promise<string[]>;
  /**
   * Write a story with the provider, check it against your vocabulary (one rewrite at most) and
   * save it to the Library as an AI text. `onProgress` gets short status lines.
   */
  createStory(input: StoryInput, onProgress?: (msg: string) => void): Promise<StoryView>;
  /**
   * "Generate exercises like this unit": new exercises of the book's kinds with the unit's
   * words and grammar, each sentence checked by the language server, stored as an event and
   * graded by the book checkers.
   */
  generateUnitExercises(
    courseId: string,
    unitN: number,
    onProgress?: (msg: string) => void,
  ): Promise<GenerateUnitResult>;
}

/** Where a story's target words come from. */
export type StoryTargetSource =
  | { kind: "learn-now"; limit?: number }
  | { kind: "unit"; courseId: string; unitN: number }
  | { kind: "grammar"; topicId: string };

export interface StoryInput {
  /** The topic; empty: the AI chooses one. */
  topic: string;
  length: StoryLength;
  style?: StoryStyle;
  /** Words the story should use (at most 20 are sent). */
  targetWords: string[];
  /** Grammar topic page id to feature. */
  grammarTopic?: string;
  /** Share of learning and new words (0–1 each); the rest are known words. */
  mix?: StoryMix;
  /** The learner's note for the writer. */
  notes?: string;
}

export interface StoryView {
  textId: string;
  title: string;
  /** Coverage of the saved text, null when the language server was unavailable. */
  coverage: number | null;
  rewritten: boolean;
  /** Target words that the text does not contain (checked by the language server). */
  missingTargets: string[];
  /** The model did not answer in the expected format; its raw text was saved. */
  parseFailed: boolean;
}

/** What "Fill gaps with AI sentences" did for one practice session. */
export interface AISentenceReport {
  /** Words (or topics) a request was made for. */
  requested: number;
  /** Sentences that passed validation and were saved. */
  accepted: number;
  /** Sentences the validator dropped. */
  rejected: number;
  /** Earlier AI sentences reused from your data. */
  reused: number;
  /** Set when the provider failed (generation stopped; practice continues without it). */
  error?: string;
}

/** A grammar construction detected in the sentence to explain. */
export interface ExplainGrammar {
  title: string;
  note: string;
}
