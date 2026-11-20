import { describe, expect, it } from "vitest";
import { formOfTarget, glossHead, meaningSenses, shortGloss } from "./gloss.js";

describe("shortGloss", () => {
  it("drops explanations in brackets and after a semicolon or colon", () => {
    expect(glossHead("what (asking for a subject complement)")).toBe("what");
    expect(glossHead("to call; to telephone someone")).toBe("to call");
    expect(glossHead("what: e.g. asking for an object")).toBe("what");
    expect(glossHead("house [building]")).toBe("house");
  });

  it("keeps one short meaning by default", () => {
    expect(
      shortGloss([
        "what (asking for a subject complement)",
        "what (asking for a sentence object)",
        "something",
      ]),
    ).toBe("what");
  });

  it("keeps the first sense when it can be cut short", () => {
    expect(shortGloss(["to go, to move from one place to another", "to lead"])).toBe("to go");
    expect(
      shortGloss(["having an inviting and friendly ambiance; cosy, nice, pleasant, sociable"]),
    ).toBe("cosy, nice");
    expect(shortGloss(["also, too, moreover"])).toBe("also, too");
  });

  it("prefers a short sense over a long explanation", () => {
    expect(
      shortGloss(["used to introduce a clause that expresses a reason or cause", "because"]),
    ).toBe("because");
  });

  it("joins up to max meanings", () => {
    expect(shortGloss(["to call (on the phone)", "to ring", "to phone"], 2)).toBe(
      "to call, to ring",
    );
  });

  it("cuts a long only sense at its first comma, or shortens it", () => {
    expect(shortGloss(["a small boat, especially one used on canals in the past"])).toBe(
      "a small boat",
    );
    expect(shortGloss(["a person who takes care of the lighthouse and its lamp at night"])).toBe(
      "a person who takes care of the…",
    );
    expect(shortGloss(["the opposite of not, used to add positive emphasis"])).toBe(
      "the opposite of not",
    );
  });

  it("is empty for no senses", () => {
    expect(shortGloss([])).toBe("");
  });

  it("finds the word a form-of sense points to", () => {
    expect(formOfTarget("unstressed form of zij")).toBe("zij");
    expect(formOfTarget("neuter singular of de")).toBe("de");
    expect(formOfTarget("first/second/third-person singular present indicative of zullen")).toBe(
      "zullen",
    );
    expect(formOfTarget("adverbial form of met")).toBe("met");
    expect(formOfTarget("to go, to move from one place to another")).toBeNull();
    expect(formOfTarget("a house, home")).toBeNull();
    expect(meaningSenses(["alternative form of heel", "whole, entire"])).toEqual(["whole, entire"]);
  });
});
