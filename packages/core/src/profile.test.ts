import { describe, expect, it } from "vitest";
import {
  defaultProfile,
  destinationDecks,
  isLanguageProfile,
  migratedProfile,
  noteTags,
  resolveDeck,
  wordKey,
} from "./profile.js";

describe("language profile", () => {
  it("default profile routes each source to its own subdeck", () => {
    const p = defaultProfile("nl");
    expect(resolveDeck(p, { source: "reading" })).toBe("Kenning::Nederlands::Reading");
    expect(resolveDeck(p, { source: "converse" })).toBe("Kenning::Nederlands::Converse");
    expect(resolveDeck(p, { source: "ai" })).toBe("Kenning::Nederlands::Stories");
    expect(resolveDeck(p, { source: "mcp" })).toBe("Kenning::Nederlands");
    expect(destinationDecks(p)[0]).toBe("Kenning::Nederlands");
  });

  it("course words follow the course rule", () => {
    const p = defaultProfile("nl");
    const course = { title: "Nederlands in gang", unitTitle: "1: Kennismaken" };
    expect(resolveDeck(p, { source: "course", course })).toBe(
      "Kenning::Nederlands::Nederlands in gang::1: Kennismaken",
    );
    expect(resolveDeck({ ...p, courseDecks: "course" }, { source: "course", course })).toBe(
      "Kenning::Nederlands::Nederlands in gang",
    );
    expect(resolveDeck({ ...p, courseDecks: "default" }, { source: "course", course })).toBe(
      "Kenning::Nederlands",
    );
    // "::" in a title must not create extra levels
    expect(
      resolveDeck(p, { source: "course", course: { title: 'A::B "x"', unitTitle: "U" } }),
    ).toBe("Kenning::Nederlands::A B x::U");
  });

  it("an explicit picker choice wins", () => {
    expect(resolveDeck(defaultProfile("nl"), { source: "reading", deck: " Mine " })).toBe("Mine");
  });

  it("migrates old settings without changing behaviour", () => {
    const p = migratedProfile("nl", "Kenning::Reading", [
      "Dutch 5000",
      "Kenning::Reading",
      "Dutch 5000",
    ]);
    expect(p.sources).toEqual([{ deck: "Dutch 5000" }]);
    for (const source of ["reading", "converse", "ai", "mcp"] as const) {
      expect(resolveDeck(p, { source })).toBe("Kenning::Reading");
    }
    expect(resolveDeck(p, { source: "course", course: { title: "C", unitTitle: "U" } })).toBe(
      "Kenning::Reading",
    );
    expect(migratedProfile("nl", undefined, []).destinations.default).toBe("Kenning::Nederlands");
    expect(isLanguageProfile(p)).toBe(true);
    expect(isLanguageProfile({ lang: "nl" })).toBe(false);
  });

  it("tags and the key rule", () => {
    expect(noteTags(defaultProfile("nl"), "converse")).toEqual(["nl", "kenning::from::converse"]);
    expect(wordKey("nl", "de fiets")).toBe("fiets");
    expect(wordKey("nl", "zich vergissen")).toBe("vergissen");
    expect(wordKey("nl", "Het")).toBe("het");
    expect(wordKey("nl", "de fiets", "Fietsen")).toBe("fietsen");
    expect(wordKey("nl", "’s Morgens")).toBe("'s morgens");
  });
});
