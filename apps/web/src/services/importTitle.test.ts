import { describe, expect, it } from "vitest";
import { fileTitle, headingOf, pageTitle, pdfTitle, usefulMetaTitle } from "./importTitle.js";

describe("import titles", () => {
  it("ignores PDF metadata titles that name the file or the tool", () => {
    for (const junk of [
      "untitled",
      "Microsoft Word - brief.docx",
      "Document1",
      "scan0003",
      "les3.pdf",
      "",
    ])
      expect(usefulMetaTitle(junk)).toBeNull();
    expect(usefulMetaTitle("De trein naar Amsterdam")).toBe("De trein naar Amsterdam");
  });

  it("takes a short first line without a full stop as the heading", () => {
    expect(headingOf("De trein naar Amsterdam\n\nElke maandag neem ik de trein.")).toBe(
      "De trein naar Amsterdam",
    );
    expect(headingOf("Elke maandag neem ik de trein. De reis duurt een uur.")).toBeNull();
  });

  it("a PDF is called by its real title, else its heading, else its file name", () => {
    const body = "De trein naar Amsterdam\n\nElke maandag neem ik de trein naar Amsterdam.";
    expect(pdfTitle("untitled", body, "trein.pdf")).toBe("De trein naar Amsterdam");
    expect(pdfTitle("untitled", "Elke maandag neem ik de trein.", "les_3-de_trein.pdf")).toBe(
      "les 3-de trein",
    );
    expect(pdfTitle("Hoofdstuk 2", body, "x.pdf")).toBe("Hoofdstuk 2");
    expect(fileTitle("a_b.PDF")).toBe("a b");
  });

  it("drops the site's own name from a web page's title, keeps other endings", () => {
    expect(pageTitle("Vuurtoren - Wikipedia", "https://nl.wikipedia.org/wiki/Vuurtoren")).toBe(
      "Vuurtoren",
    );
    expect(pageTitle("Kabinet valt | NOS", "https://nos.nl/artikel/1")).toBe("Kabinet valt");
    expect(pageTitle("Koken - een recept", "https://example.nl/koken")).toBe("Koken - een recept");
    expect(pageTitle("Nieuws", "https://nos.nl")).toBe("Nieuws");
  });
});
