import { describe, expect, it } from "vitest";
import { NlpClient } from "./index.js";

interface Call {
  url: string;
  init: RequestInit;
}

function mockClient(response: unknown, status = 200): { client: NlpClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response), { status });
  }) as typeof fetch;
  return { client: new NlpClient({ url: "http://nlp.test/", fetch: fetchImpl }), calls };
}

describe("NlpClient import + gloss endpoints", () => {
  it("extractUrl posts JSON", async () => {
    const { client, calls } = mockClient({ title: "T", text: "x", url: "https://a.nl/" });
    const res = await client.extractUrl("https://a.nl/");
    expect(res.title).toBe("T");
    expect(calls[0]?.url).toBe("http://nlp.test/extract/url");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ url: "https://a.nl/" });
  });

  it("extractPdf and ocr send multipart with the file", async () => {
    const { client, calls } = mockClient({ text: "", pages: 1, needs_ocr: true, title: "" });
    await client.extractPdf(new Blob(["%PDF-"]));
    expect(calls[0]?.url).toBe("http://nlp.test/extract/pdf");
    const form = calls[0]?.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("file")).toBeInstanceOf(Blob);

    await client.ocr(new Blob(["img"]), "uk");
    expect(calls[1]?.url).toBe("http://nlp.test/ocr?lang=uk");
  });

  it("gloss posts lang and words", async () => {
    const { client, calls } = mockClient({
      fiets: [{ pos: "noun", article: "de", glosses: ["bicycle"] }],
    });
    const res = await client.gloss("nl", ["fiets"]);
    expect(res["fiets"]?.[0]?.article).toBe("de");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ lang: "nl", words: ["fiets"] });
  });

  it("gloss passes compound entries with parts through", async () => {
    const compound = {
      pos: "noun",
      article: "de",
      glosses: ["souvenir shop (souvenir + winkel)"],
      compound: true,
      parts: [
        { part: "souvenir", gloss: "souvenir" },
        { part: "winkel", gloss: "shop, store" },
      ],
    };
    const { client } = mockClient({
      souvenirwinkel: [compound],
      fiets: [{ pos: "noun", article: "de", glosses: ["bicycle"] }],
    });
    const res = await client.gloss("nl", ["souvenirwinkel", "fiets"]);
    const entry = res["souvenirwinkel"]?.[0];
    expect(entry?.compound).toBe(true);
    expect(entry?.parts?.map((p) => p.part)).toEqual(["souvenir", "winkel"]);
    expect(res["fiets"]?.[0]?.compound).toBeUndefined();
  });

  it("surfaces HTTP errors with the server detail", async () => {
    const { client } = mockClient({ detail: "Tesseract OCR is not available" }, 503);
    await expect(client.ocr(new Blob(["x"]))).rejects.toThrow(/503.*Tesseract/);
  });
});
