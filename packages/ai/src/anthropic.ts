import { postJson } from "./http.js";
import {
  AIError,
  type AIProvider,
  type ChatRequest,
  type ChatResult,
  type FetchLike,
  type ProviderConfig,
  splitSystem,
} from "./types.js";

/** Pinned API version (the Messages API contract). */
export const ANTHROPIC_VERSION = "2023-06-01";

interface MessagesBody {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/**
 * Native Anthropic Messages API adapter. Sends the browser-access header (CORS), puts a cache
 * breakpoint on the static system block, and sends no sampling parameters (newer models reject
 * non-default values). Short blocks below the model's minimum cacheable size are simply not cached.
 */
export function createAnthropic(
  config: ProviderConfig,
  fetchImpl: FetchLike = (...a) => globalThis.fetch(...a),
): AIProvider {
  const base = config.baseUrl.replace(/\/$/, "");
  return {
    config,
    async chat(req: ChatRequest): Promise<ChatResult> {
      const sys = splitSystem(req.system);
      const system: Record<string, unknown>[] = [
        { type: "text", text: sys.cached, cache_control: { type: "ephemeral" } },
      ];
      if (sys.extra) system.push({ type: "text", text: sys.extra });
      const body = {
        model: config.model,
        // Generous: models that think count thinking tokens against this limit.
        max_tokens: req.maxTokens ?? 4096,
        system,
        messages: req.messages,
      };
      const res = (await postJson(
        fetchImpl,
        `${base}/v1/messages`,
        {
          "x-api-key": config.apiKey ?? "",
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body,
        req.signal,
      )) as MessagesBody;
      const text = (res.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
      if (!text) {
        if (res.stop_reason === "max_tokens") throw new AIError("The model used its whole answer length before writing any text (reasoning models think first). Choose a model without long thinking, or try again.", "server");
        if (res.stop_reason === "refusal")
          throw new AIError("The model declined to write this. Try another topic.", "server");
        throw new AIError("The model returned no text.", "server");
      }
      const u = res.usage;
      return {
        text,
        ...(u
          ? {
              usage: {
                inputTokens:
                  (u.input_tokens ?? 0) +
                  (u.cache_read_input_tokens ?? 0) +
                  (u.cache_creation_input_tokens ?? 0),
                outputTokens: u.output_tokens ?? 0,
                cachedTokens: u.cache_read_input_tokens ?? 0,
              },
            }
          : {}),
      };
    },
  };
}
