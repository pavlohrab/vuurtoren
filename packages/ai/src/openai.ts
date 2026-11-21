import { postJson } from "./http.js";
import { presetFor } from "./presets.js";
import {
  AIError,
  type AIProvider,
  type ChatRequest,
  type ChatResult,
  type FetchLike,
  type ProviderConfig,
  splitSystem,
} from "./types.js";

interface CompletionBody {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/**
 * Adapter for any OpenAI Chat Completions compatible endpoint (OpenAI, OpenRouter, Groq,
 * DeepSeek, Mistral, Gemini's compat layer, Ollama, LM Studio, ...).
 */
export function createOpenAICompatible(
  config: ProviderConfig,
  fetchImpl: FetchLike = (...a) => globalThis.fetch(...a),
): AIProvider {
  const base = config.baseUrl.replace(/\/$/, "");
  const jsonMode = presetFor(config.provider).jsonMode;
  // OpenAI's newer models reject `max_tokens`; every other host still expects it.
  const limitField = config.provider === "openai" ? "max_completion_tokens" : "max_tokens";
  return {
    config,
    async chat(req: ChatRequest): Promise<ChatResult> {
      const sys = splitSystem(req.system);
      const system = sys.extra ? `${sys.cached}\n\n${sys.extra}` : sys.cached;
      const body: Record<string, unknown> = {
        model: config.model,
        messages: [{ role: "system", content: system }, ...req.messages],
        [limitField]: req.maxTokens ?? 2048,
        ...(req.json && jsonMode ? { response_format: { type: "json_object" } } : {}),
      };
      const headers: Record<string, string> = config.apiKey
        ? { authorization: `Bearer ${config.apiKey}` }
        : {};
      const res = (await postJson(
        fetchImpl,
        `${base}/chat/completions`,
        headers,
        body,
        req.signal,
      )) as CompletionBody;
      const choice = res.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        if (choice?.finish_reason === "length")
          throw new AIError(
            "The model used its whole answer length before writing any text (reasoning models think first). Choose a model without long thinking, or try again.",
            "server",
          );
        throw new AIError("The model returned no text.", "server");
      }
      const u = res.usage;
      return {
        text,
        ...(u
          ? {
              usage: {
                inputTokens: u.prompt_tokens ?? 0,
                outputTokens: u.completion_tokens ?? 0,
                ...(u.prompt_tokens_details?.cached_tokens !== undefined
                  ? { cachedTokens: u.prompt_tokens_details.cached_tokens }
                  : {}),
              },
            }
          : {}),
      };
    },
  };
}
