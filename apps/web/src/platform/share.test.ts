import { describe, expect, it } from "vitest";
import { parseShared } from "./share.js";

describe("parseShared", () => {
  it("a link, alone or with its title, is a web page to fetch", () => {
    expect(parseShared("https://nos.nl/artikel/1")).toEqual({
      kind: "url",
      url: "https://nos.nl/artikel/1",
    });
    expect(parseShared("Kabinet valt\nhttps://nos.nl/artikel/1.")).toEqual({
      kind: "url",
      url: "https://nos.nl/artikel/1",
    });
  });

  it("other text is pasted as it is; nothing shared is nothing", () => {
    const long = `${"Ik woon in Utrecht. ".repeat(20)}Meer op https://example.nl`;
    expect(parseShared(long)).toEqual({ kind: "paste", text: long });
    expect(parseShared("Mijn buurman heet Joost.")).toEqual({
      kind: "paste",
      text: "Mijn buurman heet Joost.",
    });
    expect(parseShared("   ")).toBeNull();
  });
});
