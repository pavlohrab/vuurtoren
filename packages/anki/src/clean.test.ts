import { describe, expect, it } from "vitest";
import { cleanField, decodeEntities, extractMarked } from "./clean.js";

describe("cleanField", () => {
  it.each([
    ["<b>de fiets</b>", "de fiets"],
    ["fiets[sound:fiets.mp3]", "fiets"],
    ["opbellen&nbsp;<br>to call", "opbellen to call"],
    ["{{c1::lopen::to walk}} is leuk", "lopen is leuk"],
    ["<div>huis</div><div>house</div>", "huis house"],
    ["huis [n]", "huis [n]"],
    ["日本語[にほんご]", "日本語"],
    ["café &amp; bar &#233; &#x41;", "café & bar é A"],
    ['<span style="color:red">rood</span>', "rood"],
  ])("%s -> %s", (input, expected) => {
    expect(cleanField(input)).toBe(expected);
  });

  it("leaves unknown entities alone", () => {
    expect(decodeEntities("&foo;")).toBe("&foo;");
  });
});

describe("extractMarked", () => {
  it("finds bold and cloze targets", () => {
    expect(extractMarked("Ik <b>bel</b> je {{c1::op}}.")).toEqual(["bel", "op"]);
  });
});
