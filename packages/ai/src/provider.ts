import { createAnthropic } from "./anthropic.js";
import { createOpenAICompatible } from "./openai.js";
import { type AIProvider, type FetchLike, type ProviderConfig } from "./types.js";

/**
 * Build the adapter for a config. Throws a plain Error when it is incomplete (no model, no
 * address, or a missing key for a hosted provider) so the UI can show it as a setup problem.
 */
export function createProvider(config: ProviderConfig, fetchImpl?: FetchLike): AIProvider {
  if (!config.model.trim()) throw new Error("Choose a model first.");
  if (!config.baseUrl.trim()) throw new Error("Enter the provider address first.");
  const keyless = ["ollama", "lmstudio", "custom"].includes(config.provider);
  if (!keyless && !config.apiKey) throw new Error("Add your API key first.");
  return config.provider === "anthropic"
    ? createAnthropic(config, fetchImpl)
    : createOpenAICompatible(config, fetchImpl);
}
