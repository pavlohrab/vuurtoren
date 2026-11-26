import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFS, prefsStyle, readPrefs } from "./readerPrefs.js";

const KEY = "vuurtoren-reader-prefs";
afterEach(() => localStorage.clear());

describe("book settings", () => {
  it("turn pages by default, follow the finger, two pages when wide, justified, no volume keys", () => {
    expect(readPrefs()).toMatchObject({
      pages: "turn",
      turn: "follow",
      spread: true,
      justify: true,
      volumeKeys: false,
      margins: "normal",
    });
    expect(DEFAULT_PREFS.pages).toBe("turn");
  });

  it("keeps the choices and drops unknown ones", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        pages: "scroll",
        turn: "flip",
        spread: false,
        justify: "yes",
        volumeKeys: true,
      }),
    );
    expect(readPrefs()).toMatchObject({
      pages: "scroll",
      turn: "flip",
      spread: false,
      justify: true,
      volumeKeys: true,
    });
    localStorage.setItem(KEY, JSON.stringify({ pages: "fold", turn: "curl" }));
    expect(readPrefs()).toMatchObject({ pages: "turn", turn: "follow" });
  });

  it("turns the old line width into margins: a wide line is narrow margins", () => {
    localStorage.setItem(KEY, JSON.stringify({ width: "wide" }));
    expect(readPrefs().margins).toBe("narrow");
    localStorage.setItem(KEY, JSON.stringify({ width: "narrow" }));
    expect(readPrefs().margins).toBe("wide");
    // The line length in scroll mode stays what it was.
    expect(prefsStyle(readPrefs())["--measure"]).toBe("36rem");
    localStorage.setItem(KEY, JSON.stringify({ width: "narrow", margins: "normal" }));
    expect(readPrefs().margins).toBe("normal");
  });
});
