import { describe, expect, it } from "vitest";
import { createProvider } from "./provider.js";
import { PRESETS } from "./presets.js";
import { AIError } from "./types.js";

function stubFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Anthropic adapter", () => {
  const cfg = {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-haiku-5-5",
    apiKey: "sk-test",
  } as const;

  it("sends browser-access header, caching block on the static system text, no sampling params", async () => {
    const { f, calls } = stubFetch({
      content: [{ type: "text", text: "hoi" }],
      usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 100 },
    });
    const res = await createProvider(cfg, f).chat({
      system: { cached: "STATIC", extra: "VOLATILE" },
      messages: [{ role: "user", content: "hi" }],
    });
    const call = calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    const h = call.init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("sk-test");
    expect(h["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(h["anthropic-version"]).toBeTruthy();
    const body = JSON.parse(call.init.body as string);
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system[0]).toEqual({
      type: "text",
      text: "STATIC",
      cache_control: { type: "ephemeral" },
    });
    expect(body.system[1]).toEqual({ type: "text", text: "VOLATILE" });
    expect(body).not.toHaveProperty("temperature");
    expect(res.text).toBe("hoi");
    expect(res.usage).toEqual({ inputTokens: 105, outputTokens: 2, cachedTokens: 100 });
  });

  it("maps HTTP errors to AIError kinds", async () => {
    const { f } = stubFetch({ error: { message: "bad key" } }, 401);
    const err = await createProvider(cfg, f)
      .chat({ system: "s", messages: [{ role: "user", content: "x" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIError);
    expect((err as AIError).kind).toBe("auth");
    expect((err as AIError).message).toContain("bad key");
  });

  it("says when the answer ran out of room before any text", async () => {
    const { f } = stubFetch({ content: [{ type: "thinking" }], stop_reason: "max_tokens" });
    const err = await createProvider(cfg, f)
      .chat({ system: "s", messages: [{ role: "user", content: "x" }] })
      .catch((e: unknown) => e);
    expect((err as AIError).message).toContain("whole answer length");
  });
});

describe("OpenAI-compatible adapter, empty answers", () => {
  it("says when a reasoning model spent the whole length thinking", async () => {
    const { f } = stubFetch({ choices: [{ message: { content: "" }, finish_reason: "length" }] });
    const err = await createProvider(
      { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-x", apiKey: "k" },
      f,
    )
      .chat({ system: "s", messages: [{ role: "user", content: "x" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIError);
    expect((err as AIError).message).toContain("whole answer length");
  });
});

describe("OpenAI-compatible adapter", () => {
  it("posts chat/completions with bearer key and JSON mode", async () => {
    const { f, calls } = stubFetch({
      choices: [{ message: { content: '{"a":1}' } }],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    });
    const p = createProvider(
      { provider: "groq", baseUrl: "https://api.groq.com/openai/v1/", model: "m", apiKey: "k" },
      f,
    );
    const res = await p.chat({
      system: { cached: "S", extra: "E" },
      messages: [{ role: "user", content: "hi" }],
      json: true,
    });
    const call = calls[0]!;
    expect(call.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((call.init.headers as Record<string, string>)["authorization"]).toBe("Bearer k");
    const body = JSON.parse(call.init.body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "S\n\nE" });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBeDefined();
    expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it("uses max_completion_tokens for OpenAI and skips JSON mode where unsupported", async () => {
    const a = stubFetch({ choices: [{ message: { content: "x" } }] });
    await createProvider(
      { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "m", apiKey: "k" },
      a.f,
    ).chat({ system: "s", messages: [], json: true });
    const bodyA = JSON.parse(a.calls[0]!.init.body as string);
    expect(bodyA.max_completion_tokens).toBeDefined();
    expect(bodyA).not.toHaveProperty("max_tokens");

    const b = stubFetch({ choices: [{ message: { content: "x" } }] });
    await createProvider(
      { provider: "lmstudio", baseUrl: "http://localhost:1234/v1", model: "m" },
      b.f,
    ).chat({ system: "s", messages: [], json: true });
    const call = b.calls[0]!;
    expect(JSON.parse(call.init.body as string)).not.toHaveProperty("response_format");
    expect(call.init.headers as Record<string, string>).not.toHaveProperty("authorization");
  });

  it("reports an unreachable host as a network/CORS problem", async () => {
    const f = (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    const err = await createProvider(
      { provider: "ollama", baseUrl: "http://localhost:11434/v1", model: "m" },
      f,
    )
      .chat({ system: "s", messages: [] })
      .catch((e: unknown) => e);
    expect((err as AIError).kind).toBe("cors");
  });
});

describe("createProvider validation and presets", () => {
  it("requires a key for hosted providers but not local ones", () => {
    expect(() => createProvider({ provider: "openai", baseUrl: "https://x", model: "m" })).toThrow(
      /key/i,
    );
    expect(() =>
      createProvider({ provider: "ollama", baseUrl: "http://localhost:11434/v1", model: "m" }),
    ).not.toThrow();
  });
  it("has the Ollama preset on the standard port and a Claude Haiku 5.5 default", () => {
    expect(PRESETS.find((p) => p.id === "ollama")?.baseUrl).toBe("http://localhost:11434/v1");
    expect(PRESETS.find((p) => p.id === "anthropic")?.defaultModel).toBe("claude-haiku-5-5");
  });
});
