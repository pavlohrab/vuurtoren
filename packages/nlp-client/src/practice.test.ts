import { describe, expect, it, vi } from "vitest";
import { NlpClient, createPracticeData } from "./index.js";

const client = (url: string | (() => string), fetchFn: () => Promise<Response>) => () =>
  new NlpClient({
    url: typeof url === "string" ? url : url(),
    fetch: fetchFn as unknown as typeof fetch,
  });

describe("practice data wrapper", () => {
  const item = [{ lemma: "lopen", pos: "VERB" }];

  it("degrades to empty data on errors and does not cache them", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 404 }));
    const data = createPracticeData(client("/nlp", fetchFn));
    expect(await data.forms("nl", item)).toEqual({});
    expect(await data.forms("nl", item)).toEqual({});
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const failing = createPracticeData(
      client("/nlp", async () => {
        throw new TypeError("offline");
      }),
    );
    expect(await failing.similar("nl", [{ lemma: "huis", pos: "NOUN" }], 3)).toEqual({});
    expect(failing.degraded()).toBe(true);
  });

  it("does not cache failures, reports degraded, and recovers", async () => {
    let up = false;
    const fetchFn = vi.fn(async () =>
      up ? Response.json({ lopen: { participle: "gelopen" } }) : new Response("", { status: 503 }),
    );
    const data = createPracticeData(client("/nlp", fetchFn));
    expect(await data.forms("nl", item)).toEqual({});
    expect(data.degraded()).toBe(true);
    up = true;
    expect(await data.forms("nl", item)).toEqual({ lopen: { participle: "gelopen" } });
    expect(data.degraded()).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await data.forms("nl", item);
    expect(fetchFn).toHaveBeenCalledTimes(2); // successes are cached
  });

  it("keys the cache by server URL and sends the client's request shape", async () => {
    let base = "/a";
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({}));
    const data = createPracticeData(client(() => base, fetchFn as never));
    await data.sentences("nl", ["lopen"], { limit: 2, maxWords: 9 });
    base = "/b";
    await data.sentences("nl", ["lopen"], { limit: 2, maxWords: 9 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]?.[0]).toBe("/b/sentences");
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
      lang: "nl",
      lemmas: ["lopen"],
      limit: 2,
      maxWords: 9,
    });
  });
});
