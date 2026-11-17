import { describe, expect, it } from "vitest";
import {
  cleanField,
  decodeEntities,
  extractMarked,
  firstAlternative,
  sentenceUnits,
} from "./clean.js";

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

describe("review fixes", () => {
  it.each([
    ["lopen<div>liep</div>", "lopen liep"],
    ["caf&eacute; ide&euml;n &Eacute;&eacute;n", "café ideën Één"],
    ["&#99999999; &#xD800; ok", "&#99999999; &#xD800; ok"],
    ["{{c1::op\nbellen}}", "op bellen"],
    ["&euro;5 &ldquo;ja&rdquo;", "€5 “ja”"],
  ])("%s -> %s", (input, expected) => {
    expect(cleanField(input)).toBe(expected);
  });

  it("extracts bold with attributes", () => {
    expect(extractMarked('Ik <b style="color:red">bel</b> je.')).toEqual(["bel"]);
  });
});

describe("firstAlternative", () => {
  it.each([
    ["a) bank b) bench, sofa", "bank"],
    ["1. lopen 2. wandelen", "lopen"],
    ["a) De bank verhoogt de rente. b) Ik zit op de bank.", "De bank verhoogt de rente."],
    ["gewoon een zin", "gewoon een zin"],
    ["a) alleen", "alleen"],
  ])("%s -> %s", (input, expected) => {
    expect(firstAlternative(input)).toBe(expected);
  });
});

describe("sentenceUnits", () => {
  it("splits lines and sentences in order", () => {
    expect(sentenceUnits("Wij lopen. Echt waar.<br>Tweede regel.")).toEqual([
      "Wij lopen.",
      "Echt waar.",
      "Tweede regel.",
    ]);
    expect(sentenceUnits("")).toEqual([]);
  });
});
