import { describe, expect, it } from "vitest";
import { describeError, errorText } from "./errors.js";

describe("describeError", () => {
  it("turns an NLP 502 into a plain cause with the raw text as details", () => {
    const f = describeError(new Error("NLP /analyze/text: HTTP 502, not JSON: <html>"));
    expect(f.source).toBe("nlp");
    expect(f.message).toMatch(/language server is not reachable/);
    expect(f.next).toMatch(/Settings/);
    expect(f.details).toBe("NLP /analyze/text: HTTP 502, not JSON: <html>");
  });

  it("recognises an unreachable or slow NLP server", () => {
    expect(describeError(new Error("NLP service unreachable at http://x (TypeError)")).source).toBe(
      "nlp",
    );
    expect(describeError(new Error("NLP /analyze/text: no answer within 120s")).message).toMatch(
      /took too long/,
    );
  });

  it("maps AnkiConnect transport errors", () => {
    expect(
      describeError(
        new Error("AnkiConnect deckNames: cannot reach http://127.0.0.1:8765 (is Anki running?)"),
      ).message,
    ).toBe("Anki is not reachable.");
    expect(describeError(new Error("AnkiConnect findNotes: no answer within 30s")).next).toMatch(
      /dialog/,
    );
    expect(
      describeError(new Error("AnkiConnect version: origin not allowed (webCorsOriginList)"))
        .message,
    ).toMatch(/refused/);
  });

  it("shows the language server's own reason for a 4xx, and keeps JSON out of it", () => {
    const f = describeError(
      new Error("NLP /extract/url: HTTP 422 The page could not be fetched (HTTP 404)."),
    );
    expect(f.message).toBe("The page could not be fetched (HTTP 404).");
    expect(f.details).toMatch(/extract\/url/);
    const raw = describeError(new Error('NLP /analyze/text: HTTP 422 [{"loc":["body"]}]'));
    expect(raw.message).toBe("The language server could not process this.");
  });

  it("keeps plain messages as they are, without details", () => {
    const f = describeError(new Error("Its card is no longer new in Anki"));
    expect(f).toEqual({ source: "other", message: "Its card is no longer new in Anki" });
  });

  it("hides other technical messages behind the fallback", () => {
    const f = describeError(new Error("TypeError: x is undefined at foo (bar.js:1)"), "Oops.");
    expect(f.message).toBe("Oops.");
    expect(f.details).toMatch(/TypeError/);
    expect(describeError(new TypeError("Failed to fetch")).source).toBe("network");
  });

  it("errorText joins message and next step for toasts", () => {
    expect(errorText(new Error("AnkiConnect x: cannot reach y"))).toBe(
      "Anki is not reachable. Open Anki with the AnkiConnect add-on installed, then try again.",
    );
  });
});
