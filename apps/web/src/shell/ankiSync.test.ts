import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProfile } from "@app/core";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";
import { resetAnkiSyncForTests, runAnkiSync, shouldAutoSync } from "./ankiSync.js";

const HOUR = 60 * 60 * 1000;

function services(over: Partial<AppServices> = {}): AppServices {
  const base = createMockServices({ latencyMs: 0 });
  const profile = {
    ...defaultProfile("nl", [], "connected"),
    sources: [{ deck: "Dutch" }],
  };
  return {
    ...base,
    languageProfile: () => Promise.resolve(profile),
    ankiStatus: () => Promise.resolve({ connected: true, state: "connected" as const }),
    ...over,
  };
}

afterEach(() => resetAnkiSyncForTests());

describe("automatic Anki import", () => {
  it("never runs in native mode", async () => {
    const native = { ...defaultProfile("nl"), sources: [{ deck: "Dutch" }] };
    expect(await shouldAutoSync(services({ languageProfile: () => Promise.resolve(native) }))).toBe(
      false,
    );
  });

  it("imports when the decks were never read and Anki is open", async () => {
    expect(await shouldAutoSync(services())).toBe(true);
  });

  it("waits while the last import is recent", async () => {
    const s = services();
    const summary = await s.learnerSummary();
    const recent = { ...summary, lastSync: Date.now() - HOUR };
    expect(await shouldAutoSync({ ...s, learnerSummary: () => Promise.resolve(recent) })).toBe(
      false,
    );
    const old = { ...summary, lastSync: Date.now() - 7 * HOUR };
    expect(await shouldAutoSync({ ...s, learnerSummary: () => Promise.resolve(old) })).toBe(true);
  });

  it("does nothing without confirmed decks or with Anki closed", async () => {
    expect(await shouldAutoSync(services({ languageProfile: () => Promise.resolve(null) }))).toBe(
      false,
    );
    const closed = services({
      ankiStatus: () => Promise.resolve({ connected: false, state: "not-running" as const }),
    });
    expect(await shouldAutoSync(closed)).toBe(false);
  });

  it("runs one import at a time", async () => {
    const s = services();
    const sync = vi.spyOn(s, "syncAnki");
    const qc = new QueryClient();
    const [a, b] = await Promise.all([runAnkiSync(s, qc), runAnkiSync(s, qc)]);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});
