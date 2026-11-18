import { describe, expect, it, vi } from "vitest";
import { CURATED_MODELS, listModels, modelOptions } from "./models.js";

const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("listModels", () => {
  it("reads OpenAI-compatible lists, drops non-chat models, sends the key", async () => {
    const f = vi.fn((_u: string | URL | Request, _i?: RequestInit) =>
      reply({ data: [{ id: "gpt-5-mini" }, { id: "text-embedding-3-small" }, { id: "gpt-5" }] }),
    );
    const out = await listModels(
      { provider: "openai", baseUrl: "https://api.openai.com/v1/", apiKey: "sk" },
      f as unknown as typeof fetch,
    );
    expect(out.map((m) => m.id)).toEqual(["gpt-5", "gpt-5-mini"]);
    expect(String(f.mock.calls[0]![0])).toBe("https://api.openai.com/v1/models");
    expect(new Headers(f.mock.calls[0]![1]?.headers).get("authorization")).toBe("Bearer sk");
  });

  it("uses Anthropic's /v1/models with the browser headers and display names", async () => {
    const f = vi.fn((_u: string | URL | Request, _i?: RequestInit) =>
      reply({ data: [{ id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }] }),
    );
    const out = await listModels(
      { provider: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "k" },
      f as unknown as typeof fetch,
    );
    expect(out).toEqual([{ id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }]);
    expect(String(f.mock.calls[0]![0])).toContain("/v1/models");
    const h = new Headers(f.mock.calls[0]![1]?.headers);
    expect(h.get("x-api-key")).toBe("k");
    expect(h.get("anthropic-dangerous-direct-browser-access")).toBe("true");
  });

  it("strips Gemini's models/ prefix; falls back to Ollama's /api/tags", async () => {
    const g = () => reply({ data: [{ id: "models/gemini-2.5-flash" }] });
    expect(
      await listModels(
        { provider: "gemini", baseUrl: "https://g/v1beta/openai", apiKey: "k" },
        g as unknown as typeof fetch,
      ),
    ).toEqual([{ id: "gemini-2.5-flash" }]);
    const urls: string[] = [];
    const o = (u: string | URL | Request) => {
      urls.push(String(u));
      return String(u).endsWith("/api/tags")
        ? reply({ models: [{ name: "llama3.2:latest" }] })
        : reply({}, 404);
    };
    const out = await listModels(
      { provider: "ollama", baseUrl: "http://localhost:11434/v1" },
      o as unknown as typeof fetch,
    );
    expect(out).toEqual([{ id: "llama3.2:latest" }]);
    expect(urls).toEqual(["http://localhost:11434/v1/models", "http://localhost:11434/api/tags"]);
  });

  it("fails without a needed key or on network errors (callers fall back)", async () => {
    const f = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(
      listModels({ provider: "openai", baseUrl: "https://x/v1" }, f as unknown as typeof fetch),
    ).rejects.toThrow(/key/);
    expect(f).not.toHaveBeenCalled();
    await expect(
      listModels({ provider: "groq", baseUrl: "https://x", apiKey: "k" }, f as unknown as typeof fetch),
    ).rejects.toThrow();
  });
});

describe("modelOptions", () => {
  it("puts the recommended default first, curated list when listing failed", () => {
    const curated = modelOptions("anthropic", null);
    expect(curated[0]).toEqual({ id: "claude-haiku-5-5", recommended: true });
    expect(curated.map((m) => m.id)).toEqual([...CURATED_MODELS.anthropic]);
    const live = modelOptions("openai", [{ id: "gpt-5" }, { id: "gpt-5-mini" }]);
    expect(live.map((m) => [m.id, m.recommended ?? false])).toEqual([
      ["gpt-5-mini", true],
      ["gpt-5", false],
    ]);
    expect(modelOptions("custom", null)).toEqual([]);
  });
});
