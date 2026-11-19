import type { ProviderId } from "./types.js";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  baseUrl: string;
  /** A cheap, fast model; the user can change it (model names change often). */
  defaultModel: string;
  /** Local servers need no key. */
  needsKey: boolean;
  /** Does the endpoint accept `response_format: {type: "json_object"}`? */
  jsonMode: boolean;
  /** One-line help shown under the provider picker. */
  note: string;
}

export const PRESETS: readonly ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-haiku-5-5",
    needsKey: true,
    jsonMode: false,
    note: "Needs an API key from console.anthropic.com (a claude.ai login does not work here).",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5-mini",
    needsKey: true,
    jsonMode: true,
    note: "Needs an API key from platform.openai.com.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    needsKey: true,
    jsonMode: true,
    note: "Needs a Google AI Studio key.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.5-flash",
    needsKey: true,
    jsonMode: false,
    note: "One key for many models; some are free (rate limited).",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    needsKey: true,
    jsonMode: true,
    note: "Very fast open models.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    needsKey: true,
    jsonMode: true,
    note: "Low price per token.",
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    needsKey: true,
    jsonMode: true,
    note: "EU-hosted.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    needsKey: false,
    jsonMode: true,
    note: "Runs on your computer. Start Ollama with OLLAMA_ORIGINS set to this site's address.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
    needsKey: false,
    jsonMode: false,
    note: "Start the local server in LM Studio and enable CORS.",
  },
  {
    id: "custom",
    label: "Other (OpenAI-compatible)",
    baseUrl: "",
    defaultModel: "",
    needsKey: false,
    jsonMode: false,
    note: "Any server that speaks the OpenAI Chat Completions API.",
  },
];

/** Preset by id (always exists for a valid ProviderId). */
export function presetFor(id: ProviderId): ProviderPreset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}
