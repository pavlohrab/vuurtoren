import { defaultProfile } from "@app/core";
import { describe, expect, it } from "vitest";
import { addWord, markNativeKnown, studyNativeFirst } from "./native.js";

describe("native word commands", () => {
  it("Add to my words records a Vuurtoren note and card in the profile's deck", async () => {
    const events: unknown[] = [];
    const anki = () => Promise.reject(new Error("Anki must not be asked"));
    const res = await addWord(anki, async (e) => events.push(e), {
      profile: defaultProfile("nl"),
      context: { source: "reading" },
      word: "de fiets",
      gloss: "bicycle",
      sentence: "Ik pak de <b>fiets</b>.",
    });
    expect(res).toMatchObject({
      deck: "Vuurtoren::Nederlands::Reading",
      key: "fiets",
      cardIds: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "NativeNotesAdded",
      origin: "vuurtoren",
      notes: [{ key: "fiets", gloss: "bicycle", sentence: "Ik pak de fiets." }],
      cards: [{ deck: "Vuurtoren::Nederlands::Reading", ord: 0 }],
    });
  });

  it("Add to Anki is used in connected mode", async () => {
    const anki = () => Promise.reject(new Error("asked Anki"));
    await expect(
      addWord(anki, async () => undefined, {
        profile: defaultProfile("nl", [], "connected"),
        context: { source: "reading" },
        word: "huis",
      }),
    ).rejects.toThrow("asked Anki");
  });

  it("Mark known gives cards a mature interval; Study first moves them to the front", async () => {
    const events: { changes: { schedule?: { scheduledDays: number }; position?: number }[] }[] = [];
    const record = async (e: unknown) => events.push(e as (typeof events)[number]);
    await markNativeKnown(record, { lang: "nl", key: "huis", cardIds: [7] }, 1000);
    expect(events[0]?.changes[0]?.schedule?.scheduledDays).toBeGreaterThanOrEqual(21);
    await studyNativeFirst(record, { lang: "nl", cardIds: [7] }, 5000);
    expect(events[1]?.changes[0]?.position).toBe(-5000);
  });
});
