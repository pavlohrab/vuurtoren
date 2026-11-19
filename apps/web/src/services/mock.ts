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
import { textDifficulty } from "@app/core";
import type { ActivityEntry, StoredText, SuggestedWord, WordInfo } from "@app/db";
import { groupActivity, knownByWeek } from "./activity.js";
import { suggestionEntry } from "./suggestions.js";
import { pickTextWords } from "./textWordSet.js";
import { createMockCourses } from "./mockCourses.js";
import { applySampleMorph } from "./mockMorph.js";
import { createMockAI } from "./mockAI.js";
import { createMockExam, demoAttempts } from "./mockExam.js";
import { createMockLibrary } from "./mockLibrary.js";
import { createMockProfile } from "./mockProfile.js";
import { createMockNative } from "./mockNative.js";
import { createMockGrammar } from "./mockGrammar.js";
import { createMockPractice } from "./mockPractice.js";
import { ImportCancelledError, type OcrReviewDoc } from "./ocrReview.js";
import type { OcrFlag } from "@app/nlp-client";
import type {
  AnkiStatus,
  AppServices,
  ImportInput,
  InspectorEntry,
  LearnerSummary,
  ReadingView,
  Settings,
  TextListItem,
  TextWordItem,
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
  /** Simulated live Anki state (what `cardStatus` would report). */
  anki: SimAnki;
  /** State Anki itself reports (what applies again after a reset). */
  ankiState: { state: WordState; pKnown: number };
  /** A manual state (Ignore, Mark known) overrides it. */
  overridden: boolean;
}

interface SimAnki {
  status: InspectorEntry["anki"]["status"];
  detail?: string;
  deck?: string;
  prioritized: boolean;
  markedKnown: boolean;
}

const FREQ_DECK = "A Frequency Dictionary of Dutch";
/** Demo words that show each inspector state: key -> simulated Anki state. */
const DEMO_ANKI: Record<string, Partial<SimAnki>> = {
  neemt: { status: "new", deck: FREQ_DECK, detail: `New card · in ${FREQ_DECK}` },
  meenemen: { status: "new", deck: FREQ_DECK, detail: `New card · in ${FREQ_DECK}` },
  reis: { status: "suspended", deck: FREQ_DECK, detail: "Suspended" },
  boek: {
    status: "unavailable",
    detail: "cannot reach http://127.0.0.1:8765 (is Anki running with AnkiConnect?)",
  },
  bel: { status: "learning", detail: "Learning" },
  opbellen: { status: "learning", detail: "Learning" },
};

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

/** IMPORT_SAMPLE as OCR might read it, with the words a review would flag (no page picture). */
function demoOcrReview(): OcrReviewDoc {
  const misread: [string, string, OcrFlag["reason"], string[]][] = [
    ["huis", "hu1s", "unknown", ["huis"]],
    ["maakt", "rnaakt", "unknown", ["maakt"]],
    ["soep", "soep", "low", []],
    ["vrienden", "vrienclen", "unknown", ["vrienden"]],
  ];
  let text = IMPORT_SAMPLE;
  for (const [word, read] of misread) text = text.replace(word, read);
  const flags: OcrFlag[] = misread.map(([, read, reason, suggestions], i) => {
    const start = text.indexOf(read);
    return {
      start,
      end: start + read.length,
      word: read,
      reason,
      conf: reason === "low" ? 0.41 : 0.88,
      suggestions,
      box: { page: 1, x: 0.1, y: 0.1 + i * 0.1, w: 0.12, h: 0.04 },
    };
  });
  return { text, flags, pages: [] };
}

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
export function createMockServices(
  options: {
    latencyMs?: number;
    /** Start as if Anki was synced an hour ago (the ?demo app). */
    synced?: boolean;
    /** Seed more texts, shelves and image covers for the bookshelf (the ?demo app). */
    demoLibrary?: boolean;
    /** Start in native mode (Kenning holds the cards); connected to Anki by default. */
    native?: boolean;
  } = {},
): AppServices {
  const latency = options.latencyMs ?? 40;
  const wait = () => (latency > 0 ? delay(latency) : Promise.resolve());

  const lexicon = new Map<string, LexEntry>();
  // Demo: two words Claude suggested over MCP (Words → Suggested by Claude).
  const suggestions = new Map<string, SuggestedWord>(
    [
      {
        key: "reis",
        word: "de reis",
        gloss: "journey",
        sentence: "De reis naar Utrecht duurt een uur.",
      },
      { key: "wind", word: "de wind", gloss: "wind", note: "from the weather story" },
    ].map((s, i) => [s.key, { ...s, lang: "nl", by: "claude-code", id: String(i) }]),
  );
  const bySurface = new Map<string, string>();
  for (const [surface, key, pos, gloss, state, pKnown, planLabel, article] of SPECS) {
    const demo = DEMO_ANKI[key];
    const inDeck = state === "known" || state === "learning" || demo?.status === "new";
    const entry: LexEntry = {
      key,
      pos,
      gloss,
      state,
      pKnown,
      decks: demo?.deck ? [demo.deck] : inDeck || demo ? [DECK] : [],
      inAnki: inDeck || demo !== undefined,
      lookups: 0,
      anki: {
        status: inDeck ? "review" : "absent",
        ...(inDeck
          ? {
              detail:
                state === "known" ? "In review · due in 41 days" : "In review · due in 6 days",
            }
          : {}),
        prioritized: false,
        markedKnown: false,
        ...demo,
      },
      ankiState: { state, pKnown },
      overridden: false,
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
      anki: unknownWord
        ? { status: "absent", prioritized: false, markedKnown: false }
        : {
            status: "review",
            detail: "In review · due in 41 days",
            prioritized: false,
            markedKnown: false,
          },
      ankiState: { state: unknownWord ? "unknown" : "known", pKnown: unknownWord ? 0 : 0.96 },
      overridden: false,
    });
    bySurface.set(s, s);
    return { key: s, pos: "X" };
  };

  const texts = new Map<string, StoredText>();
  const lastSegments = new Map<string, number>();
  let created = Date.now() - 86_400_000 * SAMPLE_TEXTS.length;
  for (const t of SAMPLE_TEXTS) {
    const tokens = tokenize(t.content, (s) => ensure(s), t.particles);
    applySampleMorph(t.id, tokens);
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

  // Words looked up per text, seeded for ?demo.
  const lookedUp = new Map<string, Set<string>>([["t-utrecht", new Set(["meenemen", "reis"])]]);

  const settings: Settings = {
    ankiUrl: "http://127.0.0.1:8765",
    nlpUrl: "http://127.0.0.1:8000",
    lang: "nl",
    targetDeck: "Kenning::Reading",
    theme: "system",
    help: 0.25,
    newWords: "auto",
    glossClozes: false,
    grammarMarks: true,
  };
  let staircase: StaircaseState = { targetCoverage: 0.98, newWordBudget: 3 };
  let lastSync: number | null = options.synced ? Date.now() - 60 * 60 * 1000 : null;
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
      // The new-word budget: only the first N distinct words to introduce keep their amber
      // treatment on this page; the rest fall back to a plain translated word.
      const budget = settings.newWords === "auto" ? staircase.newWordBudget : settings.newWords;
      const introduced = new Set<string>();
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
        let label = labelOf(e);
        if (label === "introduce") {
          if (introduced.has(e.key) || introduced.size < budget) introduced.add(e.key);
          else label = "gloss";
        }
        return {
          i: t.i,
          label,
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
        // Like the planner: words not studied yet (learning words are not new).
        newTypes: uniq(
          counted
            .filter((p) => ["new", "introduce", "gloss"].includes(p.label) && p.pKnown < 0.5)
            .map((p) => p.key),
        ),
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

  const infoOf = (e: LexEntry): WordInfo => ({
    key: e.key,
    state: e.state,
    pKnown: e.pKnown,
    source: e.decks.includes(DECK) ? "anki" : "app",
    ...(e.gloss ? { gloss: e.gloss } : {}),
    ...(e.article ? { article: e.article } : {}),
    decks: e.decks,
    lookups: e.lookups,
    noteIds: e.anki.status === "absent" ? [] : [1],
  });

  const listItem = (t: StoredText): TextListItem => {
    const plans = buildPlans(t);
    const { coverage, newTypes } = textDifficulty(plans);
    const { content: _c, tokens: _t, ...summary } = t;
    void _c;
    void _t;
    return {
      ...summary,
      lastSegment: lastSegments.get(t.id) ?? 0,
      coverage,
      newTypes,
      pages: plans.length,
    };
  };

  /** The inspector entry of one occurrence of a word (shared by inspect and textWords). */
  const entryOf = (
    t: StoredText,
    tokens: AnalyzedToken[],
    tok: Pick<AnalyzedToken, "i" | "start" | "end" | "sent">,
    e: LexEntry,
  ): InspectorEntry => {
    const sentToks = tokens.filter((x) => x.sent === tok.sent);
    const first = sentToks[0]?.start ?? 0;
    const last = sentToks[sentToks.length - 1]?.end ?? t.content.length;
    return {
      textId: t.id,
      tokenIndex: tok.i,
      surface: t.content.slice(tok.start, tok.end),
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
      anki: {
        status: e.anki.status,
        ...(e.anki.detail ? { detail: e.anki.detail } : {}),
        ...(e.anki.deck ? { deck: e.anki.deck } : {}),
        noteIds: e.anki.status === "absent" ? [] : [1],
        cardIds: e.anki.status === "absent" ? [] : [10],
        prioritized: e.anki.prioritized,
        markedKnown: e.anki.markedKnown,
        overridden: e.overridden,
      },
      sentence: t.content.slice(first, last),
      sentenceHighlight: [tok.start - first, tok.end - first],
    };
  };

  const addText = (
    title: string,
    content: string,
    kind: StoredText["sourceKind"],
    ref?: string,
  ): string => {
    const id = `t-${Date.now().toString(36)}-${texts.size}`;
    const tokens = tokenize(content, (s) => ensure(s, true), []);
    texts.set(id, {
      id,
      title,
      lang: "nl",
      sourceKind: kind,
      ...(ref ? { sourceRef: ref } : {}),
      createdAt: Date.now(),
      wordCount: tokens.filter((x) => x.is_word && !x.is_num).length,
      analyzed: true,
      lastSegment: 0,
      content,
      tokens,
    });
    return id;
  };

  const practice = createMockPractice(wait);
  const library = createMockLibrary(wait, {
    texts,
    addText,
    lastSegments,
    demo: options.demoLibrary === true,
  });
  /** What was done in this demo session, for the Home week strip. */
  const sessionActivity: ActivityEntry[] = [];
  const ai = createMockAI(wait, { saveText: (title, content) => addText(title, content, "ai") });
  const profile = createMockProfile(wait, options.native ? "native" : "connected");
  const native = createMockNative(wait, {
    current: profile.current,
    save: (p) => profile.services.saveLanguageProfile(p),
  });
  const grammar = createMockGrammar(
    wait,
    () => [...texts.values()],
    (lemma) => lexicon.get(lemma)?.article,
  );

  const services: AppServices = {
    ...profile.services,
    ...native,
    ...practice,
    ...createMockCourses({ latencyMs: latency }),
    ...ai,
    ...createMockExam(wait, options.synced ? demoAttempts() : []),
    ...grammar,
    ...library,
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

    async importText(input: ImportInput, onProgress, opts = {}) {
      onProgress?.("Fetching content");
      await delay(latency * 3);
      let title: string;
      let content: string;
      let kind: StoredText["sourceKind"] = input.kind;
      if (input.kind === "paste" || input.kind === "talk") {
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
        if (opts.review) {
          // The demo has no OCR: show the review with a few typical misreadings.
          const checked = await opts.review(demoOcrReview());
          if (checked === null) throw new ImportCancelledError();
          content = checked;
        }
        title = input.title?.trim() || input.file.name;
        kind = input.kind;
      }
      if (!content) throw new Error("There is no text to import.");
      onProgress?.("Analysing words");
      await delay(latency * 3);
      const id = addText(
        title,
        content,
        kind,
        input.kind === "paste" || input.kind === "talk" ? input.ref : undefined,
      );
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
      const out: Record<number, { text: string }> = {};
      for (const i of tokenIndices) {
        const tok = tokens[i];
        if (!tok) continue;
        const e = entryFor(tok, tokens) ?? lexicon.get(ensure(tok.text).key);
        if (e?.gloss) out[i] = { text: e.gloss };
      }
      return out;
    },

    async inspect(textId, tokenIndex): Promise<InspectorEntry> {
      await wait();
      const t = texts.get(textId);
      const tokens = t?.tokens ?? [];
      const clicked = tokens[tokenIndex];
      if (!t || !clicked) throw new Error("Unknown token");
      // A detached particle stands for its verb, like in the live services.
      const tok = clicked.particle_of != null ? (tokens[clicked.particle_of] ?? clicked) : clicked;
      const e = entryFor(tok, tokens) ?? lexicon.get(ensure(tok.text).key);
      if (!e) throw new Error("Unknown word");
      return entryOf(t, tokens, tok, e);
    },

    async textWords(textId): Promise<TextWordItem[]> {
      await wait();
      const t = texts.get(textId);
      if (!t) throw new Error("Text not found");
      const tokens = t.tokens ?? [];
      const picked = pickTextWords(
        { tokens, plans: buildPlans(t) },
        lookedUp.get(textId) ?? new Set(),
      );
      return picked.flatMap(({ key, tokenIndex, source }) => {
        const e = lexicon.get(key);
        if (!e) return [];
        const entry = entryOf(t, tokens, tokens[tokenIndex]!, e);
        return [
          {
            key,
            lemma: entry.lemma,
            ...(entry.article ? { article: entry.article } : {}),
            pos: entry.pos,
            glosses: entry.glosses,
            sentence: entry.sentence,
            sentenceHighlight: entry.sentenceHighlight,
            tokenIndex: entry.tokenIndex,
            source,
            entry,
          },
        ];
      });
    },

    async wordsToDecide({ limit } = {}) {
      await wait();
      const keys = new Set<string>();
      for (const t of [...texts.values()].sort((a, b) => b.createdAt - a.createdAt)) {
        const view = { tokens: t.tokens ?? [], plans: buildPlans(t) };
        for (const w of pickTextWords(view, new Set())) keys.add(w.key);
      }
      return [...keys]
        .flatMap((k) => {
          const e = lexicon.get(k);
          return e && e.anki.status === "absent" && e.state !== "ignored" ? [infoOf(e)] : [];
        })
        .slice(0, limit);
    },

    async suggestedWords() {
      return [...suggestions.values()];
    },
    async addSuggestedToAnki(key, opts) {
      const s = suggestions.get(key);
      if (!s) throw new Error("That suggestion is gone.");
      suggestions.delete(key);
      return services.addToAnki(suggestionEntry(await services.inspectWord(key), s), opts);
    },
    async dismissSuggestion(key) {
      suggestions.delete(key);
    },
    async addToAnki(entry, opts) {
      await wait();
      sessionActivity.push({ kind: "added", at: Date.now() });
      const e = lexicon.get(entry.key);
      const noteId = nextNoteId++;
      const deck = profile.deckFor("reading", opts?.deck);
      if (e) {
        e.inAnki = true;
        e.decks = [...new Set([...e.decks, deck])];
        e.anki = {
          ...e.anki,
          status: "new",
          deck,
          detail: `New card · in ${deck}`,
        };
        e.state = "learning";
        e.pKnown = 0.2;
        e.ankiState = { state: "learning", pKnown: 0.2 };
      }
      return { noteId, deck };
    },

    async learnNext(entry) {
      await wait();
      const e = lexicon.get(entry.key);
      if (!e) throw new Error("Unknown word");
      e.anki = {
        ...e.anki,
        status: "new",
        prioritized: true,
        detail: `New card · next in ${e.anki.deck ?? ""}`,
      };
      e.state = "learning";
      e.pKnown = 0.2;
      e.ankiState = { state: "learning", pKnown: 0.2 };
      return { deck: e.anki.deck ?? "" };
    },

    async markKnown(entry, opts) {
      await wait();
      const deck = profile.deckFor("reading", opts?.deck);
      const e = lexicon.get(entry.key);
      if (!e) throw new Error("Unknown word");
      const added = e.anki.status === "absent";
      e.state = "known";
      e.pKnown = 0.95;
      e.overridden = true;
      e.ankiState = { state: "known", pKnown: 0.95 };
      e.anki = {
        ...e.anki,
        status: "review",
        markedKnown: true,
        detail: "In review · due in 28 days",
      };
      if (added) {
        e.inAnki = true;
        e.decks = [...new Set([...e.decks, deck])];
      }
      delete e.planLabel;
      return added ? { addedToDeck: deck } : {};
    },

    async resetWordState(key) {
      await wait();
      const e = lexicon.get(key);
      if (!e) return;
      e.state = e.ankiState.state;
      e.pKnown = e.ankiState.pKnown;
      e.overridden = false;
      e.anki = { ...e.anki, markedKnown: false };
    },

    async setWordState(key, state) {
      await wait();
      const e = lexicon.get(key);
      if (!e) return;
      e.state = state;
      e.overridden = true;
      e.pKnown = state === "known" ? 0.95 : state === "ignored" ? 1 : e.pKnown;
      delete e.planLabel;
    },

    async recordLookup(textId, key) {
      lookedUp.set(textId, (lookedUp.get(textId) ?? new Set()).add(key));
      const e = lexicon.get(key);
      if (e) e.lookups += 1;
    },

    async recordClozeAnswer() {
      // The demo keeps no per-word evidence.
    },

    async finishSegment(textId, segment, outcome) {
      await wait();
      sessionActivity.push({ kind: "page", at: Date.now() });
      // Same semantic as the database projection: the NEXT segment to read.
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
      return { connected: true, state: "connected", version: 6 };
    },

    async connectAnki() {
      await delay(latency * 4);
      return { denied: false, status: { connected: true, state: "connected", version: 6 } };
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

    async activity(days = 7) {
      await wait();
      // Demo: a calm, plausible week (nothing yesterday), plus what was done in this session.
      const now = Date.now();
      const day = 86_400_000;
      const plan = [
        [2, 12, 3],
        [1, 0, 0],
        [0, 0, 0],
        [3, 20, 5],
        [1, 8, 2],
        [0, 0, 0],
      ];
      const entries: ActivityEntry[] = [];
      plan.forEach(([pages, exercises, added], k) => {
        const at = now - (plan.length - k) * day;
        for (let i = 0; i < pages!; i++) entries.push({ kind: "page", at });
        for (let i = 0; i < exercises!; i++) entries.push({ kind: "exercise", at });
        for (let i = 0; i < added!; i++) entries.push({ kind: "added", at });
      });
      // Earlier weeks (Progress): a few pages on most days.
      for (let k = plan.length + 1; k < days; k++) {
        const pages = (k * 7) % 5 === 0 ? 0 : (k % 3) + (k < 40 ? 1 : 0);
        for (let i = 0; i < pages; i++) entries.push({ kind: "page", at: now - k * day });
      }
      return groupActivity([...entries, ...sessionActivity], now, days);
    },

    async knownOverTime(weeks = 12) {
      await wait();
      // Demo: a steady climb to today's count.
      const known = summaryOf().known;
      const day = 86_400_000;
      const now = Date.now();
      const firsts = Array.from({ length: known }, (_, i) =>
        i < known * 0.7 ? null : now - Math.round(((known - i) / (known * 0.3)) * weeks * 7) * day,
      );
      return knownByWeek(firsts, now, weeks);
    },

    async inspectWord(key: string): Promise<InspectorEntry> {
      await wait();
      const e = lexicon.get(key);
      if (!e) throw new Error("Unknown word");
      for (const t of texts.values()) {
        const tokens = t.tokens ?? [];
        const tok = tokens.find((x) => x.is_word && lexicon.get(ensure(x.text).key) === e);
        if (tok) return entryOf(t, tokens, tok, e);
      }
      const empty = {
        id: "",
        title: "",
        lang: "nl",
        sourceKind: "paste",
        createdAt: 0,
        wordCount: 0,
        analyzed: true,
        lastSegment: 0,
        content: "",
        tokens: [],
      } satisfies StoredText;
      const fake = { i: -1, start: 0, end: 0, sent: -1 };
      return { ...entryOf(empty, [], fake, e), surface: key, tokenIndex: -1 };
    },

    async inspectForm(form: string, sentence?: string): Promise<InspectorEntry> {
      const { key } = ensure(form, true);
      const entry = await this.inspectWord(key);
      if (!sentence) return { ...entry, surface: form };
      const at = sentence.toLowerCase().indexOf(form.toLowerCase());
      return {
        ...entry,
        surface: form,
        sentence,
        sentenceHighlight: at >= 0 ? [at, at + form.length] : [0, 0],
      };
    },

    async words(opts = {}) {
      await wait();
      const q = opts.query?.trim().toLowerCase();
      const only = opts.keys ? new Set(opts.keys) : null;
      const rows: WordInfo[] = [...lexicon.values()]
        .filter((e) => (only ? only.has(e.key) : true))
        .filter((e) => (opts.state ? e.state === opts.state : true))
        .filter((e) => (q ? e.key.includes(q) || e.gloss.toLowerCase().includes(q) : true))
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(infoOf);
      const offset = opts.offset ?? 0;
      return rows.slice(offset, offset + (opts.limit ?? 100));
    },
  };
  return services;
}
