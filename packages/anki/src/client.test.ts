import { describe, expect, it } from "vitest";
import { AnkiConnectClient, AnkiConnectError, exactDeckQuery } from "./client.js";

function fakeFetch(
  handler: (body: Record<string, unknown>, url: string) => unknown,
  status = 200,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(handler(body, String(url))), { status });
  }) as typeof fetch;
}

describe("AnkiConnectClient", () => {
  it("sends legacy actions with version 6 and api key", async () => {
    let seen: Record<string, unknown> = {};
    const c = new AnkiConnectClient({
      apiKey: "k",
      fetch: fakeFetch((b) => ((seen = b), { result: 6, error: null })),
    });
    expect(await c.version()).toBe(6);
    expect(seen).toMatchObject({ action: "version", version: 6, key: "k" });
  });

  it("throws AnkiConnectError on API errors", async () => {
    const c = new AnkiConnectClient({ fetch: fakeFetch(() => ({ result: null, error: "boom" })) });
    await expect(c.deckNames()).rejects.toBeInstanceOf(AnkiConnectError);
  });

  it("explains 403 as an origin problem", async () => {
    const c = new AnkiConnectClient({ fetch: fakeFetch(() => ({}), 403) });
    await expect(c.version()).rejects.toThrow(/origin not allowed/);
  });

  it("chunks notesInfo requests", async () => {
    const calls: number[] = [];
    const c = new AnkiConnectClient({
      fetch: fakeFetch((b) => {
        const notes = (b["params"] as { notes: number[] }).notes;
        calls.push(notes.length);
        return { result: notes.map((noteId) => ({ noteId })), error: null };
      }),
    });
    const ids = Array.from({ length: 1201 }, (_, i) => i);
    expect((await c.notesInfo(ids)).length).toBe(1201);
    expect(calls).toEqual([500, 500, 201]);
  });

  it("detects v1 via api.describe", async () => {
    const yes = new AnkiConnectClient({
      fetch: fakeFetch((_b, url) => (url.endsWith("/api/v1") ? { result: {} } : {})),
    });
    expect(await yes.hasV1()).toBe(true);
    const no = new AnkiConnectClient({ fetch: fakeFetch(() => ({}), 404) });
    expect(await no.hasV1()).toBe(false);
  });
});

describe("review log and FSRS", () => {
  it("returns the latest review timestamp per card", async () => {
    const c = new AnkiConnectClient({
      fetch: fakeFetch(() => ({
        result: { "1": [{ id: 100 }, { id: 300 }, { id: 200 }], "2": [] },
        error: null,
      })),
    });
    const last = await c.lastReviews([1, 2]);
    expect(last.get(1)).toBe(300);
    expect(last.has(2)).toBe(false);
  });

  it("batches scheduling.get and tolerates FSRS-off and errors", async () => {
    const batches: number[] = [];
    const c = new AnkiConnectClient({
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        const reqs = JSON.parse(String(init?.body)) as { id: number; params: { cardId: string } }[];
        batches.push(reqs.length);
        const body = reqs.map((r) =>
          r.params.cardId === "3"
            ? { jsonrpc: "2.0", id: r.id, error: { code: 1, message: "notFound" } }
            : {
                jsonrpc: "2.0",
                id: r.id,
                result: {
                  type: "review",
                  intervalDays: 5,
                  desiredRetention: null,
                  fsrsMemory: r.params.cardId === "1" ? { difficulty: 5, stabilityDays: 12 } : null,
                },
              },
        );
        return new Response(JSON.stringify(body));
      }) as typeof fetch,
    });
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const mem = await c.fsrsMemory(ids);
    expect(batches).toEqual([100, 50]);
    expect(mem.get(1)).toEqual({ difficulty: 5, stabilityDays: 12 });
    expect(mem.get(2)).toBeNull();
    expect(mem.get(3)).toBeNull();
  });
});

describe("exactDeckQuery", () => {
  it("escapes and excludes subdecks", () => {
    expect(exactDeckQuery('Dutch*"A"')).toBe('"deck:Dutch\\*\\"A\\"" -"deck:Dutch\\*\\"A\\"::*"');
    expect(exactDeckQuery("NL::Words")).toBe('"deck:NL::Words" -"deck:NL::Words::*"');
  });
});
