/**
 * A tiny stand-in for the language server (server/nlp) behind `/nlp`, enough for import,
 * reading, the inspector and practice: tokens, a few dictionary entries, no translations.
 */
import type { Page, Route } from "@playwright/test";
import type { GlossResult, TextAnalysis, Token } from "@app/nlp-client";

interface Lex {
  lemma: string;
  pos: string;
  morph?: string;
  gloss?: string;
  article?: "de" | "het";
}

const LEXICON: Record<string, Lex> = {
  de: { lemma: "de", pos: "DET", morph: "Definite=Def" },
  het: { lemma: "het", pos: "DET", morph: "Definite=Def" },
  een: { lemma: "een", pos: "DET", morph: "Definite=Ind" },
  buurvrouw: {
    lemma: "buurvrouw",
    pos: "NOUN",
    morph: "Gender=Com|Number=Sing",
    gloss: "neighbour",
    article: "de",
  },
  koopt: {
    lemma: "kopen",
    pos: "VERB",
    morph: "Number=Sing|Tense=Pres|VerbForm=Fin",
    gloss: "to buy",
  },
  verse: { lemma: "vers", pos: "ADJ", morph: "Degree=Pos", gloss: "fresh" },
  kaas: {
    lemma: "kaas",
    pos: "NOUN",
    morph: "Gender=Com|Number=Sing",
    gloss: "cheese",
    article: "de",
  },
  markt: {
    lemma: "markt",
    pos: "NOUN",
    morph: "Gender=Com|Number=Sing",
    gloss: "market",
    article: "de",
  },
  op: { lemma: "op", pos: "ADP" },
  brood: {
    lemma: "brood",
    pos: "NOUN",
    morph: "Gender=Neut|Number=Sing",
    gloss: "bread",
    article: "het",
  },
  en: { lemma: "en", pos: "CCONJ", gloss: "and" },
  zij: { lemma: "zij", pos: "PRON", morph: "Case=Nom|Person=3|PronType=Prs", gloss: "she" },
  fietst: {
    lemma: "fietsen",
    pos: "VERB",
    morph: "Number=Sing|Tense=Pres|VerbForm=Fin",
    gloss: "to cycle",
  },
  naar: { lemma: "naar", pos: "ADP", gloss: "to" },
  huis: {
    lemma: "huis",
    pos: "NOUN",
    morph: "Gender=Neut|Number=Sing",
    gloss: "house",
    article: "het",
  },
};

export const SAMPLE_TEXT =
  "De buurvrouw koopt verse kaas op de markt. Zij koopt een brood en fietst naar huis.";

function analyze(text: string): TextAnalysis {
  const tokens: Token[] = [];
  let sent = 0;
  for (const m of text.matchAll(/\p{L}+|\d+|[^\s\p{L}\d]/gu)) {
    const surface = m[0];
    const lower = surface.toLowerCase();
    const isWord = /\p{L}/u.test(surface);
    const lex = LEXICON[lower];
    const i = tokens.length;
    tokens.push({
      i,
      text: surface,
      lemma: lex?.lemma ?? lower,
      alt_lemmas: [],
      pos: lex?.pos ?? (isWord ? "NOUN" : "PUNCT"),
      morph: lex?.morph ?? "",
      dep: "dep",
      head: i,
      sent,
      start: m.index,
      end: m.index + surface.length,
      is_word: isWord,
      is_propn: false,
      is_num: /^\d+$/.test(surface),
      particle_of: null,
      zipf: 5,
    });
    if (/[.!?]/.test(surface)) sent++;
  }
  return { tokens };
}

function glosses(words: string[]): GlossResult {
  const byLemma = new Map(Object.values(LEXICON).map((l) => [l.lemma, l]));
  return Object.fromEntries(
    words.map((w) => {
      const l = byLemma.get(w);
      return [
        w,
        l?.gloss
          ? [{ pos: l.pos.toLowerCase(), article: l.article ?? null, glosses: [l.gloss] }]
          : [],
      ];
    }),
  );
}

async function handle(route: Route): Promise<void> {
  const req = route.request();
  const path = new URL(req.url()).pathname.replace(/^\/nlp/, "");
  const body = req.method() === "POST" ? (req.postDataJSON() as Record<string, unknown>) : {};
  const json = (data: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  const texts = (body["texts"] as string[] | undefined) ?? [];
  switch (path) {
    case "/health":
      return json({ status: "ok", version: "e2e" });
    case "/analyze/text":
      return json(texts.map(analyze));
    case "/gloss":
      return json(glosses((body["words"] as string[] | undefined) ?? []));
    case "/grammar":
      return json(texts.map(() => []));
    case "/forms":
    case "/sentences":
    case "/similar":
      return json({});
    default:
      // Optional features (translation, OCR, examples): "not available", as a fresh server.
      return json({ detail: "not available in the e2e fake" }, 503);
  }
}

/** Answer every `/nlp/*` request of the page from the fake. */
export async function fakeNlp(page: Page): Promise<void> {
  await page.route("**/nlp/**", handle);
}
