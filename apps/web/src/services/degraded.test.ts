import { NlpError } from "@app/nlp-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDegraded,
  degradedEntries,
  onDegradedRetry,
  reportDegraded,
  resetDegraded,
  retryDegraded,
  subscribeDegraded,
  watchClient,
} from "./degraded.js";
import { freshnessHeld, holdFreshness, onFreshnessReleased } from "./freshness.js";
import { nlpOutage } from "./liveSettings.js";

afterEach(() => resetDegraded());

describe("degraded signal", () => {
  it("keeps one entry per source with the first failure time", () => {
    const seen = vi.fn();
    const off = subscribeDegraded(seen);
    reportDegraded("nlp", "down", new Error("a"), 1000);
    reportDegraded("nlp", "down", new Error("b"), 2000);
    reportDegraded("anki", "closed", undefined, 3000);
    expect(degradedEntries()).toEqual([
      { source: "nlp", message: "down", detail: "b", since: 1000 },
      { source: "anki", message: "closed", since: 3000 },
    ]);
    clearDegraded("nlp");
    expect(degradedEntries().map((e) => e.source)).toEqual(["anki"]);
    expect(seen).toHaveBeenCalledTimes(4);
    off();
  });

  it("retry clears everything and notifies", () => {
    const retried = vi.fn();
    const off = onDegradedRetry(retried);
    reportDegraded("ai", "x");
    retryDegraded();
    expect(degradedEntries()).toEqual([]);
    expect(retried).toHaveBeenCalledOnce();
    off();
  });

  it("a watched client reports outages and clears on success", async () => {
    let fail: unknown = null;
    const client = watchClient(
      {
        ping: () => (fail ? Promise.reject(fail) : Promise.resolve("pong")),
      },
      "nlp",
      nlpOutage,
    );
    fail = new NlpError("NLP service unreachable", null);
    await expect(client.ping()).rejects.toBe(fail);
    expect(degradedEntries()[0]?.source).toBe("nlp");
    // A refused request (e.g. 503: dictionary not built) is not an outage.
    fail = new NlpError("NLP /gloss: HTTP 503", 503);
    await expect(client.ping()).rejects.toBe(fail);
    fail = null;
    await expect(client.ping()).resolves.toBe("pong");
    expect(degradedEntries()).toEqual([]);
  });
});

describe("freshness holds", () => {
  it("runs the deferred check when the last hold is released", () => {
    const released = vi.fn();
    const off = onFreshnessReleased(released);
    const a = holdFreshness();
    const b = holdFreshness();
    expect(freshnessHeld()).toBe(true);
    a();
    a();
    expect(released).not.toHaveBeenCalled();
    b();
    expect(freshnessHeld()).toBe(false);
    expect(released).toHaveBeenCalledOnce();
    off();
  });
});
