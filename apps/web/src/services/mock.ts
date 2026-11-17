/**
 * In-memory mock of AppServices with a few short Dutch texts, so every screen works without a
 * backend. Tokens are produced by a tiny regex tokenizer; labels come from a hand-made lexicon so
 * the sample texts exercise every TokenLabel, a separable verb and clozes.
 */
import type {
  AnalyzedToken,
  PlannedToken,
  SegmentPlan,
  StaircaseState,
  TokenLabel,
  WordState,
} from "@app/core";
import type { StoredText, WordInfo } from "@app/db";
import type {
  AnkiStatus,
  AppServices,
  ImportInput,
  InspectorEntry,
  LearnerSummary,
  ReadingView,
  Settings,
  TextListItem,
} from "./types.js";

interface LexEntry {
  key: string;
  pos: string;
  gloss: string;
  article?: string;
  state: WordState;
  pKnown: number;
  /** How the planner would present the word while it is not known/ignored. */
  planLabel?: TokenLabel;
  decks: string[];
  inAnki: boolean;
  lookups: number;
}

/** [surface, key, pos, gloss, state, pKnown, planLabel?, article?] */
type Spec = [string, string, string, string, WordState, number, (TokenLabel | undefined)?, string?];

const DECK = "Dutch::Core 2k";
const SPECS: Spec[] = [
  ["bel", "opbellen", "VERB", "to phone someone", "learning", 0.55, "learning"],
  ["zus", "zus", "NOUN", "sister", "known", 0.9, undefined, "de"],
  ["woont", "wonen", "VERB", "to live", "known", 0.92],
  ["mooie", "mooi", "ADJ", "beautiful", "known", 0.9, "cloze"],
  ["stad", "stad", "NOUN", "city", "known", 0.92, undefined, "de"],
  ["grachten", "gracht", "NOUN", "canals", "unknown", 0, "gloss", "de"],
  ["staat", "opstaan", "VERB", "to get up", "known", 0.9],
  ["vroeg", "vroeg", "ADJ", "early", "known", 0.9, "cloze"],
  ["trein", "trein", "NOUN", "train", "learning", 0.6, "learning", "de"],
  ["vertrekt", "vertrekken", "VERB", "to depart", "unknown", 0, "introduce"],
  ["uur", "uur", "NOUN", "hour", "known", 0.95, undefined, "het"],
  ["neemt", "meenemen", "VERB", "to take along", "unknown", 0, "new"],
  ["boek", "boek", "NOUN", "book", "known", 0.95, undefined, "het"],
  ["reis", "reis", "NOUN", "journey", "unknown", 0, "new", "de"],
  ["duurt", "duren", "VERB", "to last", "learning", 0.4, "learning"],
  ["lang", "lang", "ADJ", "long", "known", 0.95],
  ["markt", "markt", "NOUN", "market", "known", 0.9, undefined, "de"],
  ["zaterdag", "zaterdag", "NOUN", "Saturday", "known", 0.85, undefined, "de"],
  ["buurvrouw", "buurvrouw", "NOUN", "neighbour (f.)", "unknown", 0, "new", "de"],
  ["koopt", "kopen", "VERB", "to buy", "known", 0.9],
  ["verse", "vers", "ADJ", "fresh", "learning", 0.5, "learning"],
  ["kaas", "kaas", "NOUN", "cheese", "known", 0.92, undefined, "de"],
  ["brood", "brood", "NOUN", "bread", "known", 0.92, undefined, "het"],
  ["kinderen", "kind", "NOUN", "children", "known", 0.95, undefined, "het"],
  ["hond", "hond", "NOUN", "dog", "known", 0.93, "cloze", "de"],
  ["blaft", "blaffen", "VERB", "to bark", "unknown", 0, "introduce"],
  ["hard", "hard", "ADV", "loudly", "known", 0.85],
  ["langskomt", "langskomen", "VERB", "to come by", "unknown", 0, "gloss"],
  ["regent", "regenen", "VERB", "to rain", "learning", 0.5, "learning"],
  ["wind", "wind", "NOUN", "wind", "unknown", 0, "new", "de"],
  ["koud", "koud", "ADJ", "cold", "known", 0.9],
  ["lucht", "lucht", "NOUN", "sky, air", "learning", 0.3, "learning", "de"],
  ["grijs", "grijs", "ADJ", "grey", "unknown", 0, "introduce"],
  ["misschien", "misschien", "ADV", "maybe", "known", 0.9, "cloze"],
  ["weerman", "weerman", "NOUN", "weatherman", "unknown", 0, "gloss", "de"],
  ["utrecht", "utrecht", "PROPN", "", "ignored", 1],
];

const SAMPLE_TEXTS: {
  id: string;
  title: string;
  sourceKind: StoredText["sourceKind"];
  content: string;
  /** [particleWordIndex, verbWordIndex], counting word tokens from 0. */
  particles: [number, number][];
}[] = [
  {
    id: "t-utrecht",
    title: "Een dag in Utrecht",
    sourceKind: "paste",
    content:
      "Ik bel mijn zus op. Ze woont in Utrecht, een mooie stad met veel grachten.\n\nVandaag staat zij vroeg op omdat de trein om acht uur vertrekt. Ze neemt een boek mee, want de reis duurt lang.",
    particles: [
      [4, 1],
      [19, 16],
      [31, 28],
    ],
  },
  {
    id: "t-markt",
    title: "Op de markt",
    sourceKind: "url",
    content:
      "De markt is elke zaterdag open. Mijn buurvrouw koopt daar verse kaas en brood.\n\nHaar man heeft twee kinderen en een grote hond. De hond blaft hard als iemand langskomt.",
    particles: [],
  },
  {
    id: "t-weer",
    title: "Het weer",
    sourceKind: "pdf",
    content:
      "Het regent al drie dagen. De wind is koud en de lucht is grijs.\n\nMorgen wordt het misschien beter, zegt de weerman.",
    particles: [],
  },
];

const IMPORT_SAMPLE =
  "De fiets staat voor het huis. Mijn vader werkt vandaag thuis en maakt een grote pot soep.\n\nTegen de avond komen onze vrienden langs voor het eten.";

const TOKEN_RE = /\p{L}+(?:-\p{L}+)*|\d+|[^\s\p{L}\d]/gu;
const SENTENCE_END = new Set([".", "!", "?"]);

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Tokenize `text` into AnalyzedTokens; `lookup` supplies lemma/pos for each word surface. */
function tokenize(
  text: string,
  lookup: (surface: string) => { key: string; pos: string },
  particles: [number, number][],
): AnalyzedToken[] {
  const tokens: AnalyzedToken[] = [];
  const wordIdx: number[] = [];
  let sent = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const surface = m[0];
    const i = tokens.length;
    const isNum = /^\d+$/.test(surface) || ["twee", "drie", "acht"].includes(surface.toLowerCase());
    const isWord = /[\p{L}\d]/u.test(surface);
    const info = isWord && !isNum ? lookup(surface) : { key: surface.toLowerCase(), pos: "NUM" };
    if (isWord) wordIdx.push(i);
    tokens.push({
      i,
      text: surface,
      lemma: isWord ? info.key : surface,
      alt_lemmas: [],
      pos: isWord ? info.pos : "PUNCT",
      morph: "",
      dep: "",
      head: i,
      sent,
      start: m.index,
      end: m.index + surface.length,
      is_word: isWord,
      is_propn: info.pos === "PROPN",
      is_num: isNum,
      particle_of: null,
      zipf: 4.5,
    });
    if (SENTENCE_END.has(surface)) sent += 1;
  }
  for (const [p, v] of particles) {
    const pt = tokens[wordIdx[p] as number];
    const vt = wordIdx[v];
    if (pt && vt !== undefined) {
      pt.particle_of = vt;
      pt.lemma = pt.text.toLowerCase();
    }
  }
  return tokens;
}

const STATE_COUNT_BASE = { known: 1840, learning: 412, unknown: 5120 };

/** Create a mock services implementation with fresh in-memory state. */
export function createMockServices(options: { latencyMs?: number } = {}): AppServices {
  const latency = options.latencyMs ?? 40;
  const wait = () => (latency > 0 ? delay(latency) : Promise.resolve());

  const lexicon = new Map<string, LexEntry>();
  const bySurface = new Map<string, string>();
  for (const [surface, key, pos, gloss, state, pKnown, planLabel, article] of SPECS) {
    const entry: LexEntry = {
      key,
      pos,
      gloss,
      state,
      pKnown,
      decks: state === "unknown" || state === "ignored" ? [] : [DECK],
      inAnki: state === "known" || state === "learning",
      lookups: 0,
    };
    if (planLabel) entry.planLabel = planLabel;
    if (article) entry.article = article;
    lexicon.set(key, entry);
    bySurface.set(surface, key);
  }

  /** Find or lazily create the entry for a surface (function words are known). */
  const ensure = (surface: string, imported = false): { key: string; pos: string } => {
    const s = surface.toLowerCase();
    const existing = bySurface.get(s);
    if (existing) return { key: existing, pos: lexicon.get(existing)?.pos ?? "X" };
    const unknownWord = imported && s.length > 5;
    lexicon.set(s, {
      key: s,
      pos: "X",
      gloss: "",
      state: unknownWord ? "unknown" : "known",
      pKnown: unknownWord ? 0 : 0.96,
      ...(unknownWord ? { planLabel: "new" as const } : {}),
      decks: unknownWord ? [] : [DECK],
      inAnki: !unknownWord,
      lookups: 0,
    });
    bySurface.set(s, s);
    return { key: s, pos: "X" };
  };

  const texts = new Map<string, StoredText>();
  const lastSegments = new Map<string, number>();
  let created = Date.now() - 86_400_000 * SAMPLE_TEXTS.length;
  for (const t of SAMPLE_TEXTS) {
    const tokens = tokenize(t.content, (s) => ensure(s), t.particles);
    texts.set(t.id, {
      id: t.id,
      title: t.title,
      lang: "nl",
      sourceKind: t.sourceKind,
      createdAt: (created += 86_400_000),
      wordCount: tokens.filter((x) => x.is_word && !x.is_num).length,
      analyzed: true,
      lastSegment: 0,
      content: t.content,
      tokens,
    });
  }

  const settings: Settings = {
    ankiUrl: "http://127.0.0.1:8765",
    nlpUrl: "http://127.0.0.1:8000",
    lang: "nl",
    targetDeck: "Kenning::Reading",
    theme: "system",
    help: 0.25,
    newWords: "auto",
  };
  let staircase: StaircaseState = { targetCoverage: 0.98, newWordBudget: 6 };
  let lastSync: number | null = null;
  let nextNoteId = 1_700_000_000_000;

  const entryFor = (tok: AnalyzedToken, tokens: AnalyzedToken[]): LexEntry | undefined => {
    const base = tok.particle_of != null ? (tokens[tok.particle_of] ?? tok) : tok;
    return lexicon.get(base.lemma);
  };

  const labelOf = (e: LexEntry): TokenLabel => {
    if (e.state === "ignored") return "ignored";
    if (e.planLabel === "cloze") return "cloze";
    if (e.state === "known") return "known";
    return e.planLabel ?? (e.state === "learning" ? "learning" : "new");
  };

  const buildPlans = (text: StoredText): SegmentPlan[] => {
    const tokens = text.tokens ?? [];
    const ranges: [number, number][] = [];
    let from = 0;
    for (const m of text.content.matchAll(/\n[ \t]*\n/g)) {
      ranges.push([from, m.index]);
      from = m.index + m[0].length;
    }
    ranges.push([from, text.content.length]);
    return ranges.map(([charStart, charEnd], index) => {
      const inRange = tokens.filter((t) => t.start >= charStart && t.end <= charEnd);
      const planned: PlannedToken[] = inRange.map((t) => {
        const e = t.is_word ? entryFor(t, tokens) : undefined;
        if (!e || t.is_num) {
          return {
            i: t.i,
            label: t.is_word ? "ignored" : "nonword",
            key: null,
            pKnown: t.is_word ? 1 : 0,
          };
        }
        return {
          i: t.i,
          label: labelOf(e),
          key: e.key,
          pKnown: e.state === "ignored" ? 1 : e.pKnown,
        };
      });
      const counted = planned.filter((p) => p.label !== "ignored" && p.label !== "nonword");
      const coverage = counted.length
        ? counted.reduce((sum, p) => sum + p.pKnown, 0) / counted.length
        : 1;
      const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
      return {
        segment: {
          index,
          tokenStart: inRange[0]?.i ?? 0,
          tokenEnd: (inRange[inRange.length - 1]?.i ?? -1) + 1,
          charStart,
          charEnd,
        },
        tokens: planned,
        coverage,
        newTypes: uniq(counted.filter((p) => p.pKnown < 0.5).map((p) => p.key)),
        introduce: uniq(planned.filter((p) => p.label === "introduce").map((p) => p.key)),
        gloss: uniq(planned.filter((p) => p.label === "gloss").map((p) => p.key)),
        clozes: planned.filter((p) => p.label === "cloze").map((p) => p.i),
      };
    });
  };

  const summaryOf = (): LearnerSummary => {
    const count = (s: WordState) => [...lexicon.values()].filter((e) => e.state === s).length;
    return {
      known: STATE_COUNT_BASE.known + count("known"),
      learning: STATE_COUNT_BASE.learning + count("learning"),
      unknown: STATE_COUNT_BASE.unknown + count("unknown"),
      vocabEstimate: 2650,
      lastSync,
      sources: lastSync ? [DECK, "Dutch::Sentences"] : [],
    };
  };

  const listItem = (t: StoredText): TextListItem => {
    const plans = buildPlans(t);
    const all = plans
      .flatMap((p) => p.tokens)
      .filter((p) => p.label !== "ignored" && p.label !== "nonword");
    const coverage = all.length ? all.reduce((s, p) => s + p.pKnown, 0) / all.length : null;
    const newTypes = new Set(plans.flatMap((p) => p.newTypes)).size;
    const { content: _c, tokens: _t, ...summary } = t;
    void _c;
    void _t;
    return {
      ...summary,
      lastSegment: lastSegments.get(t.id) ?? 0,
      coverage,
      newTypes,
    };
  };

  return {
    async listTexts() {
      await wait();
      return [...texts.values()].sort((a, b) => b.createdAt - a.createdAt).map(listItem);
    },

    async getReading(textId): Promise<ReadingView | null> {
      await wait();
      const t = texts.get(textId);
      if (!t) return null;
      return {
        text: { ...t, lastSegment: lastSegments.get(t.id) ?? 0 },
        tokens: t.tokens ?? [],
        plans: buildPlans(t),
        staircase,
      };
    },

    async importText(input: ImportInput, onProgress) {
      onProgress?.("Fetching content");
      await delay(latency * 3);
      let title: string;
      let content: string;
      let kind: StoredText["sourceKind"] = input.kind;
      if (input.kind === "paste") {
        content = input.content.trim();
        title = input.title?.trim() || content.split(/\s+/).slice(0, 5).join(" ");
      } else if (input.kind === "url") {
        content = IMPORT_SAMPLE;
        try {
          title = new URL(input.url).hostname;
        } catch {
          title = input.url;
        }
      } else {
        onProgress?.(input.kind === "pdf" ? "Extracting text from PDF" : "Reading text from photo");
        await delay(latency * 3);
        content = IMPORT_SAMPLE;
        title = input.title?.trim() || input.file.name;
        kind = input.kind;
      }
      if (!content) throw new Error("There is no text to import.");
      onProgress?.("Analysing words");
      await delay(latency * 3);
      const id = `t-${Date.now().toString(36)}`;
      const tokens = tokenize(content, (s) => ensure(s, true), []);
      texts.set(id, {
        id,
        title,
        lang: "nl",
        sourceKind: kind,
        createdAt: Date.now(),
        wordCount: tokens.filter((x) => x.is_word && !x.is_num).length,
        analyzed: true,
        lastSegment: 0,
        content,
        tokens,
      });
      onProgress?.("Planning the reading");
      await delay(latency);
      return id;
    },

    async deleteText(textId) {
      await wait();
      texts.delete(textId);
    },

    async glosses(textId, tokenIndices) {
      await wait();
      const t = texts.get(textId);
      const tokens = t?.tokens ?? [];
      const out: Record<number, string> = {};
      for (const i of tokenIndices) {
        const tok = tokens[i];
        if (!tok) continue;
        const e = entryFor(tok, tokens) ?? lexicon.get(ensure(tok.text).key);
        if (e?.gloss) out[i] = e.gloss;
      }
      return out;
    },

    async inspect(textId, tokenIndex): Promise<InspectorEntry> {
      await wait();
      const t = texts.get(textId);
      const tokens = t?.tokens ?? [];
      const tok = tokens[tokenIndex];
      if (!t || !tok) throw new Error("Unknown token");
      const e = entryFor(tok, tokens) ?? lexicon.get(ensure(tok.text).key);
      if (!e) throw new Error("Unknown word");
      const sentToks = tokens.filter((x) => x.sent === tok.sent);
      const first = sentToks[0]?.start ?? 0;
      const last = sentToks[sentToks.length - 1]?.end ?? t.content.length;
      const surface = t.content.slice(tok.start, tok.end);
      return {
        textId,
        tokenIndex,
        surface,
        lemma: e.key,
        key: e.key,
        label: labelOf(e),
        state: e.state,
        pKnown: e.pKnown,
        pos: e.pos,
        ...(e.article ? { article: e.article } : {}),
        glosses: e.gloss ? [e.gloss] : [],
        decks: e.decks,
        inAnki: e.inAnki,
        sentence: t.content.slice(first, last),
        sentenceHighlight: [tok.start - first, tok.end - first],
      };
    },

    async addToAnki(entry) {
      await wait();
      const e = lexicon.get(entry.key);
      const noteId = nextNoteId++;
      if (e) {
        e.inAnki = true;
        e.decks = [...new Set([...e.decks, settings.targetDeck])];
      }
      return { noteId };
    },

    async setWordState(key, state) {
      await wait();
      const e = lexicon.get(key);
      if (!e) return;
      e.state = state;
      e.pKnown = state === "known" ? 0.95 : state === "ignored" ? 1 : e.pKnown;
      delete e.planLabel;
    },

    async recordLookup(_textId, key) {
      const e = lexicon.get(key);
      if (e) e.lookups += 1;
    },

    async finishSegment(textId, segment, outcome) {
      await wait();
      lastSegments.set(textId, segment + 1);
      const struggling = outcome.lookupsPer100 > 8 || (outcome.clozeAccuracy ?? 1) < 0.7;
      const target = staircase.targetCoverage + (struggling ? 0.005 : -0.005);
      staircase = {
        ...staircase,
        targetCoverage: Math.min(0.99, Math.max(0.92, Math.round(target * 1000) / 1000)),
      };
      return staircase;
    },

    async getSettings() {
      await wait();
      return { ...settings };
    },

    async saveSettings(patch) {
      await wait();
      Object.assign(settings, patch);
    },

    async ankiStatus(): Promise<AnkiStatus> {
      await delay(latency * 4);
      return { connected: true, version: 6 };
    },

    async syncAnki(onProgress) {
      onProgress?.("Reading decks");
      await delay(latency * 4);
      onProgress?.("Matching words to your texts");
      await delay(latency * 4);
      lastSync = Date.now();
      return summaryOf();
    },

    async learnerSummary() {
      await wait();
      return summaryOf();
    },

    async words(opts = {}) {
      await wait();
      const q = opts.query?.trim().toLowerCase();
      const rows: WordInfo[] = [...lexicon.values()]
        .filter((e) => (opts.state ? e.state === opts.state : true))
        .filter((e) => (q ? e.key.includes(q) || e.gloss.toLowerCase().includes(q) : true))
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((e) => ({
          key: e.key,
          state: e.state,
          pKnown: e.pKnown,
          source: e.decks.includes(DECK) ? ("anki" as const) : ("app" as const),
          ...(e.gloss ? { gloss: e.gloss } : {}),
          ...(e.article ? { article: e.article } : {}),
          decks: e.decks,
          lookups: e.lookups,
        }));
      const offset = opts.offset ?? 0;
      return rows.slice(offset, offset + (opts.limit ?? 100));
    },
  };
}
