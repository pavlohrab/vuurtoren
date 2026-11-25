import { describe, expect, it } from "vitest";
import { removeNativeWord } from "./native.js";

describe("removeNativeWord", () => {
  it("records the note's removal, the card goes with it in the store", async () => {
    const events: unknown[] = [];
    await removeNativeWord(async (e) => void events.push(e), { lang: "nl", noteId: 42 });
    expect(events).toEqual([{ type: "NativeNotesRemoved", lang: "nl", noteIds: [42] }]);
  });
});
