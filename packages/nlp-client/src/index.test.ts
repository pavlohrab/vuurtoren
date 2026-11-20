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

    await client.ocr(new Blob(["img"]));
    expect(calls[1]?.url).toBe("http://nlp.test/ocr?lang=nl");
    await client.ocr(new Blob(["img"]), "nl", "p.png", { review: true });
    expect(calls[2]?.url).toBe("http://nlp.test/ocr?lang=nl&review=true");
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
      glosses: ["souvenir shop"],
      compound: true,
      origin: "compound",
      formed: "souvenir + winkel",
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
    expect(entry?.formed).toBe("souvenir + winkel");
    expect(res["fiets"]?.[0]?.compound).toBeUndefined();
  });

  it("align posts texts with word spans", async () => {
    const aligned = [
      {
        text: "Hij keek woordeloos.",
        translation: "He looked wordless.",
        words: [{ start: 9, end: 19, text: "wordless", confidence: 0.9 }],
      },
    ];
    const { client, calls } = mockClient(aligned);
    const res = await client.align([{ text: "Hij keek woordeloos.", spans: [[9, 19]] }]);
    expect(res[0]?.words[0]?.text).toBe("wordless");
    expect(calls[0]?.url).toBe("http://nlp.test/translate/align");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      source: "nl",
      target: "en",
      items: [{ text: "Hij keek woordeloos.", spans: [[9, 19]] }],
    });
  });

  it("surfaces HTTP errors with the server detail", async () => {
    const { client } = mockClient({ detail: "Text recognition (RapidOCR) is not installed" }, 503);
    await expect(client.ocr(new Blob(["x"]))).rejects.toThrow(/503.*RapidOCR/);
  });
});

describe("NlpClient translate", () => {
  it("posts source/target/texts and returns pairs", async () => {
    const { client, calls } = mockClient([{ text: "Hallo", translation: "Hello" }]);
    const res = await client.translate(["Hallo"]);
    expect(res[0]?.translation).toBe("Hello");
    expect(calls[0]?.url).toBe("http://nlp.test/translate");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      source: "nl",
      target: "en",
      context: false,
      texts: ["Hallo"],
    });
  });

  it("splits large inputs by text count and total characters", async () => {
    const { client, calls } = mockClient([]);
    await client.translate(Array.from({ length: 130 }, () => "a"));
    expect(calls).toHaveLength(3);
    await client.translate([
      "x".repeat(2000),
      ...Array.from({ length: 10 }, () => "y".repeat(2000)),
    ]);
    expect(calls.length).toBe(5);
  });
});

describe("NlpClient practice data", () => {
  it("forms posts {lemma,pos} pairs and returns WordForms", async () => {
    const { client, calls } = mockClient({
      lopen: { participle: "gelopen", aux: "both", past: ["liep", "liepen"] },
    });
    const res = await client.forms("nl", [{ lemma: "lopen", pos: "VERB" }]);
    expect(res["lopen"]?.past).toEqual(["liep", "liepen"]);
    expect(calls[0]?.url).toBe("http://nlp.test/forms");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      lang: "nl",
      lemmas: [{ lemma: "lopen", pos: "VERB" }],
    });
  });

  it("sentences sends only the options that were given", async () => {
    const sentence = {
      text: "Ik loop.",
      translation: "I walk.",
      target: [3, 7],
      source: "tatoeba",
    };
    const { client, calls } = mockClient({ lopen: [sentence] });
    const res = await client.sentences("nl", ["lopen"], { limit: 2 });
    expect(res["lopen"]?.[0]?.target).toEqual([3, 7]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      lang: "nl",
      lemmas: ["lopen"],
      limit: 2,
    });
  });

  it("similar posts words and k", async () => {
    const { client, calls } = mockClient({ hond: ["kat", "paard"] });
    const res = await client.similar("nl", [{ lemma: "hond", pos: "NOUN" }], 2);
    expect(res["hond"]).toEqual(["kat", "paard"]);
    expect(calls[0]?.url).toBe("http://nlp.test/similar");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      lang: "nl",
      words: [{ lemma: "hond", pos: "NOUN" }],
      k: 2,
    });
  });

  it("splits more than 500 lemmas into several requests and merges the results", async () => {
    const { client, calls } = mockClient({});
    await client.sentences(
      "nl",
      Array.from({ length: 1001 }, (_, i) => `w${i}`),
    );
    expect(calls).toHaveLength(3);
  });

  it("forms surfaces the 503 guidance", async () => {
    const { client } = mockClient({ detail: "Rebuild it with: build_dictionary.py" }, 503);
    await expect(client.forms("nl", [{ lemma: "a", pos: "VERB" }])).rejects.toThrow(/503.*Rebuild/);
  });
});

describe("NlpClient grammar endpoints", () => {
  const hit = {
    topic: "inversion",
    tokens: [1, 2],
    sent: 0,
    sentence: "Morgen ga ik naar school.",
    start: 0,
    end: 25,
    note: "«Morgen» comes first.",
  };

  it("grammar posts lang and texts and returns one hit list per text", async () => {
    const { client, calls } = mockClient([[hit], []]);
    const res = await client.grammar("nl", ["Morgen ga ik naar school.", ""]);
    expect(res).toEqual([[hit], []]);
    expect(calls[0]?.url).toBe("http://nlp.test/grammar");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      lang: "nl",
      texts: ["Morgen ga ik naar school.", ""],
    });
  });

  it("grammar splits large inputs and keeps the order", async () => {
    const calls: string[][] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const texts = (JSON.parse(String(init?.body)) as { texts: string[] }).texts;
      calls.push(texts);
      return new Response(JSON.stringify(texts.map((t) => [{ ...hit, sentence: t }])));
    }) as typeof fetch;
    const client = new NlpClient({ url: "http://nlp.test", fetch: fetchImpl, batchSize: 2 });
    const res = await client.grammar("nl", ["a", "b", "c"]);
    expect(calls).toEqual([["a", "b"], ["c"]]);
    expect(res.map((r) => r[0]?.sentence)).toEqual(["a", "b", "c"]);
    expect(await client.grammar("nl", [])).toEqual([]);
  });

  it("grammarExamples gets the topic with a clamped limit", async () => {
    const example = {
      text: "Morgen ga ik.",
      translation: "Tomorrow I go.",
      marks: [[7, 9]],
      note: "n",
      source: "tatoeba",
    };
    const { client, calls } = mockClient([example]);
    const res = await client.grammarExamples("relative-pronouns", 50);
    expect(res[0]?.marks[0]).toEqual([7, 9]);
    expect(calls[0]?.url).toBe("http://nlp.test/grammar/examples?topic=relative-pronouns&limit=10");
    expect(calls[0]?.init.method).toBeUndefined();
    await client.grammarExamples("er", 3);
    expect(calls[1]?.url).toBe("http://nlp.test/grammar/examples?topic=er&limit=3");
  });

  it("grammarExamples surfaces a 503 as NlpError", async () => {
    const { client } = mockClient({ detail: "Sentence database not found" }, 503);
    await expect(client.grammarExamples("er")).rejects.toMatchObject({
      name: "NlpError",
      status: 503,
    });
  });
});
