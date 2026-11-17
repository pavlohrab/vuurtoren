import { describe, expect, it } from "vitest";
import { corsConfigLine, probeAnki, requestAnkiPermission } from "./connection.js";

interface Behaviour {
  /** Reply to a POSTed action; throw to simulate a network/CORS failure. */
  post: (action: string) => unknown;
  /** Whether the no-cors GET reaches a listening server. */
  reachable?: boolean;
  status?: number;
}

function fake(b: Behaviour): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "GET") {
      if (b.reachable) return new Response(null);
      throw new TypeError("Failed to fetch");
    }
    const body = JSON.parse(String(init?.body)) as { action: string };
    const out = b.post(body.action);
    return new Response(JSON.stringify(out), { status: b.status ?? 200 });
  }) as typeof fetch;
}
const down = (): never => {
  throw new TypeError("Failed to fetch");
};

describe("probeAnki", () => {
  it("connected", async () => {
    const r = await probeAnki({
      fetch: fake({ post: (a) => ({ result: a === "version" ? 6 : [], error: null }) }),
    });
    expect(r).toEqual({ state: "connected", version: 6 });
  });

  it("not running: POST and GET both fail", async () => {
    expect(await probeAnki({ fetch: fake({ post: down }) })).toEqual({ state: "not-running" });
  });

  it("not allowed: POST blocked by CORS but the server answers", async () => {
    const r = await probeAnki({ fetch: fake({ post: down, reachable: true }) });
    expect(r).toEqual({ state: "not-allowed" });
  });

  it("not allowed: HTTP 403", async () => {
    const r = await probeAnki({ fetch: fake({ post: () => ({}), status: 403 }) });
    expect(r).toEqual({ state: "not-allowed" });
  });

  it("needs key", async () => {
    const r = await probeAnki({
      fetch: fake({
        post: (a) =>
          a === "version"
            ? { result: 6, error: null }
            : { result: null, error: "valid api key must be provided" },
      }),
    });
    expect(r).toEqual({ state: "needs-key", version: 6 });
  });

  it("busy on timeout", async () => {
    const f = (async () => {
      throw new DOMException("t", "TimeoutError");
    }) as typeof fetch;
    expect(await probeAnki({ fetch: f })).toEqual({ state: "busy" });
  });
});

describe("requestAnkiPermission", () => {
  const perm = (permission: string, extra = {}) =>
    fake({ post: () => ({ result: { permission, version: 6, ...extra }, error: null }) });

  it("granted", async () => {
    const r = await requestAnkiPermission({ fetch: perm("granted", { requireApiKey: true }) });
    expect(r).toEqual({ outcome: "granted", requireApiKey: true, version: 6 });
  });
  it("denied", async () => {
    expect(await requestAnkiPermission({ fetch: perm("denied") })).toEqual({ outcome: "denied" });
  });
  it("not running", async () => {
    expect(await requestAnkiPermission({ fetch: fake({ post: down }) })).toEqual({
      outcome: "not-running",
    });
  });
});

describe("corsConfigLine", () => {
  it("includes the origin as JSON", () => {
    expect(corsConfigLine("http://localhost:8080")).toBe(
      '"webCorsOriginList": ["http://localhost", "http://localhost:8080"]',
    );
  });
});
