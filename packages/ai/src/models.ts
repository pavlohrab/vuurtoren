/**
 * Model lists for the model picker in Settings → AI: the provider's own list when it can be
 * fetched from the browser (needs the key, and CORS), else a short curated list per preset.
 * The preset's default model always comes first, marked recommended.
 */
import { ANTHROPIC_VERSION } from "./anthropic.js";
import { presetFor } from "./presets.js";
import type { FetchLike, ProviderId } from "./types.js";

export interface ModelOption {
  id: string;
  /** Human name when the provider gives one (Anthropic's display_name). */
  label?: string;
  /** The preset's default: cheap and fast enough for everything Kenning does. */
  recommended?: boolean;
}

/** Hand-picked fallbacks (names change; free text stays allowed in the picker). */
export const CURATED_MODELS: Record<ProviderId, readonly string[]> = {
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5"],
  openai: ["gpt-5-mini", "gpt-5-nano", "gpt-5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
  openrouter: [
    "google/gemini-2.5-flash",
    "anthropic/claude-haiku-5-5",
    "openai/gpt-5-mini",
    "meta-llama/llama-3.3-70b-instruct:free",
  ],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  deepseek: ["deepseek-chat"],
  mistral: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
  ollama: ["llama3.2", "qwen2.5", "gemma3"],
  lmstudio: ["local-model"],
  custom: [],
};

/** Not chat models: embeddings, speech, images, moderation... */
const NOT_CHAT =
  /(embed|tts|whisper|dall-e|moderation|transcribe|audio|realtime|image|imagen|veo|search|rerank|guard)/i;

export interface ListModelsInput {
  provider: ProviderId;
  baseUrl: string;
  apiKey?: string | undefined;
}

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>) {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as unknown;
}

/**
 * Fetch the provider's model ids. Throws when the list cannot be read (no key, CORS,
 * offline); callers fall back to {@link CURATED_MODELS}.
 */
export async function listModels(
  input: ListModelsInput,
  fetchImpl: FetchLike = (...a) => globalThis.fetch(...a),
): Promise<ModelOption[]> {
  const base = input.baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("No address");
  const preset = presetFor(input.provider);
  if (preset.needsKey && !input.apiKey) throw new Error("No key");
  let out: ModelOption[];
  if (input.provider === "anthropic") {
    const body = (await getJson(fetchImpl, `${base}/v1/models?limit=1000`, {
      "x-api-key": input.apiKey ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    })) as { data?: { id: string; display_name?: string }[] };
    out = (body.data ?? []).map((m) => ({
      id: m.id,
      ...(m.display_name ? { label: m.display_name } : {}),
    }));
  } else {
    const auth: Record<string, string> = input.apiKey
      ? { authorization: `Bearer ${input.apiKey}` }
      : {};
    try {
      const body = (await getJson(fetchImpl, `${base}/models`, auth)) as {
        data?: { id: string }[];
      };
      // Gemini's OpenAI-compatible list names models "models/<id>".
      out = (body.data ?? []).map((m) => ({ id: m.id.replace(/^models\//, "") }));
    } catch (e) {
      if (input.provider !== "ollama") throw e;
      // Older Ollama: its native list at the server root.
      const root = base.replace(/\/v1$/, "");
      const body = (await getJson(fetchImpl, `${root}/api/tags`, {})) as {
        models?: { name: string }[];
      };
      out = (body.models ?? []).map((m) => ({ id: m.name }));
    }
  }
  const ids = new Set<string>();
  return out
    .filter((m) => m.id && !NOT_CHAT.test(m.id) && !ids.has(m.id) && ids.add(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The picker's options: the recommended default first, then `listed` (or the curated list
 * when listing failed). The default is kept even when the provider's list lacks it.
 */
export function modelOptions(
  provider: ProviderId,
  listed: readonly ModelOption[] | null,
): ModelOption[] {
  const def = presetFor(provider).defaultModel;
  const rest = listed ?? CURATED_MODELS[provider].map((id) => ({ id }));
  const fromList = rest.find((m) => m.id === def);
  const head: ModelOption[] = def ? [{ ...(fromList ?? { id: def }), recommended: true }] : [];
  return [...head, ...rest.filter((m) => m.id !== def)];
}
