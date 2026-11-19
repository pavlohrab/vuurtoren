/** Provider-neutral contracts for the BYOK AI layer (docs/ai.md). */

/** Supported provider families. `custom` is any OpenAI-compatible endpoint. */
export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "groq"
  | "deepseek"
  | "mistral"
  | "ollama"
  | "lmstudio"
  | "custom";

/** Everything needed to talk to one provider. The key lives elsewhere (see keystore.ts). */
export interface ProviderConfig {
  provider: ProviderId;
  /** Base URL without trailing slash (e.g. https://api.openai.com/v1). */
  baseUrl: string;
  model: string;
  /** Missing for keyless local servers (Ollama, LM Studio). */
  apiKey?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * System prompt split in two: `cached` is the static block (rules, level, vocabulary list); it
 * gets an Anthropic cache breakpoint and must not change between turns of a conversation.
 * `extra` is volatile text appended after it.
 */
export interface SystemPrompt {
  cached: string;
  extra?: string;
}

export interface ChatRequest {
  system: SystemPrompt | string;
  messages: ChatMessage[];
  /** Ask for a single JSON object (provider JSON mode where available; the prompt must say so). */
  json?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the provider's prompt cache, when reported. */
  cachedTokens?: number;
}

export interface ChatResult {
  text: string;
  usage?: Usage;
}

/** The one interface every adapter implements. */
export interface AIProvider {
  readonly config: ProviderConfig;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export type AIErrorKind = "auth" | "rate-limit" | "network" | "cors" | "bad-request" | "server";

/** A provider call failed; `kind` lets the UI say something useful. */
export class AIError extends Error {
  override readonly name = "AIError";
  constructor(
    message: string,
    readonly kind: AIErrorKind,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type FetchLike = typeof fetch;

/** Normalise the two system-prompt shapes. */
export function splitSystem(s: SystemPrompt | string): SystemPrompt {
  return typeof s === "string" ? { cached: s } : s;
}
