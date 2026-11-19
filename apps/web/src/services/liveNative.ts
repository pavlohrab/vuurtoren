/**
 * Native mode: the review queue and answers, deck options, imports (.apkg files and the move
 * from Anki) and FSRS tuning. Cards live in the repository; the scheduler and the optimizer
 * run on this device.
 */
import {
  type AnkiConnectClient,
  type AnkiCollection,
  type CreateSqlite,
  type NativeImport,
  type OpenSqlite,
  buildNativeImport,
  NOTE_FIELDS,
  NOTE_TYPE,
  collectionFromAnki,
  moveToAnki,
  packageDecks,
  readAnkiPackage,
  writeAnkiPackage,
} from "@app/anki";
import {
  type CardRating,
  type CardSchedule,
  DEFAULT_FSRS_PARAMS,
  type LanguageProfile,
  NORMAL_WEEK,
  type WeekLoad,
  answerCard,
  balanceInterval,
  clozeNumbers,
  dailyLoad,
  mondayFirst,
  paramsDecay,
  destinationDecks,
  formatInterval,
  normalizeKey,
  previewCard,
  profileMode,
  renderTemplate,
  replayReviews,
  trainingSequences,
} from "@app/core";
import type { KenningRepository, NativeCardChange, NativeCardView } from "@app/db";
import type { NlpClient } from "@app/nlp-client";
import type { RunOptimizer } from "../native/optimizer.js";
import { MIN_TRAINING_REVIEWS } from "../native/optimize.js";
import type {
  ImportSummary,
  NativeServices,
  ReviewCard,
  TuningInfo,
  TuningResult,
} from "./nativeTypes.js";

export interface LiveNativeDeps {
  repo: KenningRepository;
  lang: () => Promise<"nl">;
  profile: () => Promise<LanguageProfile>;
  saveProfile: (p: LanguageProfile) => Promise<void>;
  anki: () => Promise<AnkiConnectClient>;
  nlp: () => Promise<NlpClient>;
  /** The learner model changed. */
  changed: () => void;
  optimizer: RunOptimizer;
  /** SQLite for reading package files. */
  sqlite: () => { open: OpenSqlite; create: CreateSqlite; dispose: () => void };
  /** How much of the usual load each weekday takes, Monday first (Settings). */
  reviewWeek?: () => Promise<readonly number[]>;
  now?: () => number;
}

const DAY_MS = 86_400_000;
/** Cards fetched per queue request. */
const QUEUE_LIMIT = 30;
/** Tune again after this long… */
const RETUNE_MS = 30 * DAY_MS;
/** …or after this many new answers. */
const RETUNE_REVIEWS = 500;
/** First tuning by itself once the history has this many answers. */
const FIRST_TUNE_REVIEWS = 400;
const CHANGES_PER_EVENT = 500;
/** Target recalls the deck table offers, with the load each means. */
export const LOAD_RETENTIONS = [0.8, 0.85, 0.87, 0.9, 0.92, 0.95, 0.97];
/** Texts searched for a sentence with the word (newest first). */
const OWN_TEXTS = 200;

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  flac: "audio/flac",
};

/** Start of the study day (4:00 local time) that `now` falls in. */
export function studyDayStart(now: number): number {
  const d = new Date(now);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

export function createLiveNative(deps: LiveNativeDeps) {
  const { repo } = deps;
  const now = deps.now ?? Date.now;
  const opened = new Map<string, AnkiCollection>();
  let ownIndex: { lang: string; map: Map<string, ReviewCard["ownSentence"]> } | null = null;

  async function params(lang: string): Promise<number[]> {
    return (await repo.fsrsParams(lang))?.params ?? [...DEFAULT_FSRS_PARAMS];
  }

  /** Sentences with each word from the learner's analysed texts (first found per key). */
  async function ownSentences(lang: string): Promise<Map<string, ReviewCard["ownSentence"]>> {
    if (ownIndex?.lang === lang) return ownIndex.map;
    const map = new Map<string, ReviewCard["ownSentence"]>();
    const ids = (await repo.listTexts())
      .filter((t) => t.lang === lang && t.analyzed)
      .slice(0, OWN_TEXTS)
      .map((t) => t.id);
    for (const text of await repo.getTexts(ids)) {
      const tokens = text.tokens ?? [];
      const spans = new Map<number, [number, number]>();
      for (const t of tokens) {
        const s = spans.get(t.sent);
        if (s) s[1] = t.end;
        else spans.set(t.sent, [t.start, t.end]);
      }
      for (const t of tokens) {
        const key = normalizeKey(t.lemma);
        if (map.has(key) || !/\p{L}/u.test(t.text)) continue;
        const [s0, s1] = spans.get(t.sent) ?? [t.start, t.end];
        if (s1 - s0 > 300) continue;
        map.set(key, {
          text: text.content.slice(s0, s1),
          title: text.title,
          highlight: [t.start - s0, t.end - s0],
        });
      }
    }
    ownIndex = { lang, map };
    return map;
  }

  function reviewCard(
    v: NativeCardView,
    p: number[],
    at: number,
    own: Map<string, ReviewCard["ownSentence"]>,
    media: Record<string, string>,
  ): ReviewCard {
    const { card, note, notetype } = v;
    const fields = Object.fromEntries(notetype.fields.map((f, i) => [f, note.fields[i] ?? ""]));
    const cloze = notetype.kind === "cloze";
    const tmpl = cloze ? notetype.templates[0] : notetype.templates[card.ord];
    const front = tmpl
      ? renderTemplate(tmpl.front, fields, card.ord, false)
      : { html: note.fields[0] ?? "", audio: [] };
    const back = tmpl
      ? renderTemplate(tmpl.back, fields, card.ord, true, front.html)
      : { html: note.fields.slice(1).join("<br>"), audio: [] };
    const preview = previewCard(card.schedule, at, { options: v.options, params: p, fuzz: false });
    const intervals = {} as Record<CardRating, string>;
    for (const r of [1, 2, 3, 4] as const) intervals[r] = formatInterval(preview[r].due - at);
    // Kenning lays out a vocabulary card itself when it shows the word on the front (a
    // recognition card); other templates (production cards, clozes) keep their own layout.
    const vocab = notetype.vocab;
    const wordShown =
      !!vocab &&
      !cloze &&
      (tmpl?.front.includes(`{{${vocab.word}}}`) ?? false) &&
      stripTags(fields[vocab.word] ?? "") !== "";
    const out: ReviewCard = {
      cardId: card.id,
      deck: card.deck,
      isNew: !card.schedule,
      layout: wordShown
        ? "vocab"
        : cloze && clozeNumbers(note.fields).length
          ? "cloze"
          : "template",
      front: front.html,
      back: back.html,
      audioFront: front.audio,
      audioBack: back.audio,
      media,
      intervals,
    };
    if (wordShown && vocab) {
      out.word = stripTags(fields[vocab.word] ?? "");
      if (note.article && !out.word.toLowerCase().startsWith(`${note.article} `)) {
        out.article = note.article;
      }
      if (note.gloss) out.gloss = note.gloss;
      if (note.sentence) out.sentence = note.sentence;
      if (note.sentenceTranslation) out.sentenceTranslation = note.sentenceTranslation;
    }
    const sentence = note.key ? own.get(note.key) : undefined;
    if (sentence) out.ownSentence = sentence;
    return out;
  }

  /** Media names a card refers to. */
  const mediaNames = (v: NativeCardView): string[] => {
    const out: string[] = [];
    for (const f of [...v.note.fields, ...v.notetype.templates.flatMap((t) => [t.front, t.back])]) {
      for (const m of f.matchAll(/<img[^>]+src=["']?([^"'>]+)["']?/gi)) out.push(m[1]!);
      for (const m of f.matchAll(/\[sound:([^\]]+)\]/g)) out.push(m[1]!.trim());
    }
    return [...new Set(out)];
  };

  async function storeImport(lang: string, imp: NativeImport): Promise<ImportSummary> {
    for (const e of imp.events) await repo.append(e);
    if (imp.fsrsParams && !(await repo.fsrsParams(lang))) {
      // Anki's own trained parameters until Kenning tunes on the history.
      await repo.append({ type: "FsrsParamsSet", lang, params: imp.fsrsParams, reviews: 0 });
    }
    ownIndex = null;
    deps.changed();
    return {
      notes: imp.notes,
      cards: imp.cards,
      reviews: imp.reviews,
      vocabNotes: imp.vocabNotes,
      media: imp.media,
      skippedMedia: imp.skippedMedia,
    };
  }

  async function importDeps(lang: "nl", origin: "apkg" | "anki", onProgress?: (m: string) => void) {
    let nlp: NlpClient | null = null;
    try {
      nlp = await deps.nlp();
    } catch {
      nlp = null;
    }
    return {
      lang,
      origin,
      ...(nlp
        ? {
            detect: (texts: string[]) => nlp.detect(texts),
            analyzeTerms: (terms: string[]) => nlp.analyzeTerms(lang, terms),
          }
        : {}),
      putMedia: async (name: string, bytes: Uint8Array) => {
        const type = MIME[name.split(".").pop()?.toLowerCase() ?? ""];
        if (!type || bytes.length === 0) return null;
        return repo.putBlob(bytes, type);
      },
      ...(onProgress ? { onProgress } : {}),
    };
  }

  function info(
    rec: Awaited<ReturnType<KenningRepository["fsrsParams"]>>,
    history: number,
  ): TuningInfo {
    const out: TuningInfo = {
      tuned: !!rec && rec.reviews > 0,
      at: rec?.at ?? null,
      reviewsUsed: rec?.reviews ?? 0,
      history,
    };
    if (rec?.logLoss !== undefined) out.logLoss = rec.logLoss;
    if (rec?.rmse !== undefined) out.rmse = rec.rmse;
    if (rec?.previousLogLoss !== undefined) out.previousLogLoss = rec.previousLogLoss;
    if (rec?.previousRmse !== undefined) out.previousRmse = rec.previousRmse;
    return out;
  }

  /** Train, record the parameters and recompute every card's memory with them. */
  async function tune(onProgress?: (m: string) => void): Promise<TuningResult> {
    const lang = await deps.lang();
    const reviews = await repo.nativeReviews(lang);
    const offset = -new Date().getTimezoneOffset();
    const seqs = trainingSequences(reviews, offset);
    onProgress?.("Training on your reviews");
    const current = await params(lang);
    const r = await deps.optimizer(seqs, current, (done, total) =>
      onProgress?.(`Training on your reviews (${Math.round((100 * done) / Math.max(1, total))}%)`),
    );
    await repo.append({
      type: "FsrsParamsSet",
      lang,
      params: r.params,
      reviews: r.reviews,
      historySize: reviews.length,
      logLoss: r.logLoss,
      rmse: r.rmse,
      previousLogLoss: r.previousLogLoss,
      previousRmse: r.previousRmse,
    });
    if (r.improved) {
      onProgress?.("Updating your cards' memory");
      await recomputeMemory(lang, r.params, reviews);
    }
    deps.changed();
    return { ...info(await repo.fsrsParams(lang), reviews.length), improved: r.improved };
  }

  /**
   * Stability and difficulty of every card with a complete history, replayed with new
   * parameters. Due dates stay as they are.
   */
  async function recomputeMemory(
    lang: string,
    p: number[],
    reviews: Awaited<ReturnType<KenningRepository["nativeReviews"]>>,
  ): Promise<void> {
    const byCard = new Map<number, typeof reviews>();
    for (const r of reviews) byCard.set(r.cardId, [...(byCard.get(r.cardId) ?? []), r]);
    const changes: NativeCardChange[] = [];
    for (const [cardId, list] of byCard) {
      const first = list.find((r) => r.rating !== 0);
      if (!first || first.kind !== "learn") continue;
      const v = await repo.nativeCard(lang, cardId);
      const s = v?.card.schedule;
      if (!v || !s) continue;
      const replayed = replayReviews(list, { options: v.options, params: p });
      if (!replayed) continue;
      const next: CardSchedule = {
        ...s,
        stability: replayed.stability,
        difficulty: replayed.difficulty,
      };
      changes.push({ cardId, schedule: next });
    }
    for (let i = 0; i < changes.length; i += CHANGES_PER_EVENT) {
      await repo.append({
        type: "NativeCardsChanged",
        lang,
        reason: "memory",
        changes: changes.slice(i, i + CHANGES_PER_EVENT),
      });
    }
  }

  /**
   * A review answer's due date within its random spread: the lightest day, away from lighter
   * weekdays (`balanceInterval`).
   */
  async function balanced(
    lang: string,
    s: CardSchedule,
    prev: CardSchedule | undefined,
    at: number,
    maxInterval: number,
  ): Promise<CardSchedule> {
    const planned = s.scheduledDays;
    if (planned < 3) return s;
    const today = studyDayStart(at);
    const counts = await repo.nativeDueCounts(lang, today, Math.ceil(planned * 1.3) + 5);
    const week = (
      (await deps.reviewWeek?.())?.length === 7 ? await deps.reviewWeek!() : NORMAL_WEEK
    ) as WeekLoad;
    const elapsed = prev ? Math.max(0, Math.round((at - prev.lastReview) / DAY_MS)) : 0;
    const days = balanceInterval(
      planned,
      elapsed,
      maxInterval,
      (d) => counts[d] ?? 0,
      (d) => mondayFirst(new Date(today + d * DAY_MS + 12 * 3_600_000).getDay()),
      week,
    );
    return days === planned ? s : { ...s, scheduledDays: days, due: at + days * DAY_MS };
  }

  const services: NativeServices = {
    async reviewOverview() {
      if (profileMode(await deps.profile()) !== "native")
        return { native: false, due: 0, fresh: 0 };
      const lang = await deps.lang();
      const at = now();
      const q = await repo.nativeQueue(lang, at, studyDayStart(at), 0);
      return { native: true, due: q.due, fresh: q.fresh };
    },

    async reviewQueue() {
      const lang = await deps.lang();
      const at = now();
      const q = await repo.nativeQueue(lang, at, studyDayStart(at), QUEUE_LIMIT);
      const p = await params(lang);
      const own = await ownSentences(lang);
      const cards: ReviewCard[] = [];
      for (const v of q.cards) {
        const media = await repo.nativeMedia(lang, mediaNames(v));
        cards.push(reviewCard(v, p, at, own, media));
      }
      return { cards, due: q.due, fresh: q.fresh };
    },

    async answerReview(cardId, rating, durationMs) {
      const lang = await deps.lang();
      const v = await repo.nativeCard(lang, cardId);
      if (!v) throw new Error("This card no longer exists.");
      const at = now();
      const prev = v.card.schedule;
      let schedule = answerCard(prev, rating, at, {
        options: v.options,
        params: await params(lang),
        fuzz: false,
      });
      if (schedule.state === 2)
        schedule = await balanced(lang, schedule, prev, at, v.options.maxInterval);
      const stored = await repo.append({
        type: "CardReviewed",
        lang,
        cardId,
        rating,
        at,
        durationMs: Math.max(0, Math.round(durationMs)),
        schedule,
        ...(v.card.schedule ? { previous: v.card.schedule } : {}),
      });
      deps.changed();
      return { reviewId: stored.id };
    },

    async undoReview(cardId, reviewId) {
      await repo.append({ type: "CardReviewUndone", lang: await deps.lang(), cardId, reviewId });
      deps.changed();
    },

    async mediaFile(blobId) {
      const b = await repo.getBlob(blobId);
      return b ? new Blob([b.bytes as BlobPart], { type: b.type }) : null;
    },

    async nativeDecks() {
      const lang = await deps.lang();
      const decks = await repo.nativeDecks(lang, now());
      const { cards } = await repo.nativeCollection(lang, []);
      const decay = paramsDecay(await params(lang));
      const stabilities = new Map<string, number[]>();
      for (const c of cards) {
        if (c.schedule?.state !== 2 || c.suspended) continue;
        stabilities.set(c.deck, [...(stabilities.get(c.deck) ?? []), c.schedule.stability]);
      }
      return decks.map((d) => ({
        ...d,
        load: LOAD_RETENTIONS.map((retention) => ({
          retention,
          perDay: Math.round(
            dailyLoad(
              stabilities.get(d.name) ?? [],
              retention,
              decay,
              d.fresh > 0 ? d.options.newPerDay : 0,
              d.options.maxInterval,
            ),
          ),
        })),
      }));
    },

    async setDeckOptions(deck, options) {
      await repo.append({ type: "NativeDeckOptionsSet", lang: await deps.lang(), deck, options });
    },

    async openPackage(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sqlite = deps.sqlite();
      try {
        const col = await readAnkiPackage(bytes, sqlite.open);
        const token = `${file.name}:${now()}`;
        opened.clear();
        opened.set(token, col);
        return { token, decks: packageDecks(col) };
      } finally {
        sqlite.dispose();
      }
    },

    async importPackage(token, decks, onProgress) {
      const col = opened.get(token);
      if (!col) throw new Error("Open the file again.");
      const lang = await deps.lang();
      const imp = await buildNativeImport(col, decks, await importDeps(lang, "apkg", onProgress));
      opened.delete(token);
      return storeImport(lang, imp);
    },

    async moveFromAnki(onProgress) {
      const profile = await deps.profile();
      const lang = await deps.lang();
      const client = await deps.anki();
      const existing = new Set(await client.deckNames());
      const decks = [
        ...new Set([...profile.sources.map((s) => s.deck), ...destinationDecks(profile)]),
      ].filter((d) => existing.has(d));
      onProgress?.("Reading your decks in Anki");
      const col = await collectionFromAnki(client, decks, onProgress);
      const imp = await buildNativeImport(col, decks, await importDeps(lang, "anki", onProgress));
      const summary = await storeImport(lang, imp);
      await deps.saveProfile({ ...profile, mode: "native" });
      deps.changed();
      return summary;
    },

    async exportPackage(decks) {
      const lang = await deps.lang();
      const col = await repo.nativeCollection(lang, decks);
      const at = now();
      const sqlite = deps.sqlite();
      try {
        const { bytes, summary } = await writeAnkiPackage(
          {
            ...col,
            params: await params(lang),
            media: Object.entries(col.media).map(([name, blobId]) => ({
              name,
              bytes: async () => (await repo.getBlob(blobId))?.bytes ?? null,
            })),
            now: at,
          },
          sqlite.create,
        );
        const day = new Date(at).toISOString().slice(0, 10);
        const label = decks.length === 1 ? decks[0]!.replace(/::/g, "-") : "Kenning";
        const fileName = `${label.replace(/[^\p{L}\p{N}._-]+/gu, "_")}-${day}.apkg`;
        return { bytes, fileName, summary };
      } finally {
        sqlite.dispose();
      }
    },

    async moveToAnki(withHistory, onProgress) {
      const profile = await deps.profile();
      if (profileMode(profile) !== "native") throw new Error("Your words are already in Anki.");
      const lang = await deps.lang();
      const client = await deps.anki();
      const col = await repo.nativeCollection(lang, []);
      const r = await moveToAnki(
        client,
        { ...col, params: await params(lang), now: now(), withHistory },
        onProgress,
      );
      // Kenning reads the moved decks: its own note type where words were added.
      const kenningDecks = new Set(destinationDecks(profile));
      const sources = [...profile.sources];
      for (const deck of r.decks) {
        if (sources.some((s) => s.deck === deck) || kenningDecks.has(deck)) continue;
        sources.push({
          deck,
          modelName: NOTE_TYPE,
          wordField: NOTE_FIELDS[0],
          glossField: NOTE_FIELDS[1],
          sentenceField: NOTE_FIELDS[2],
        });
      }
      await deps.saveProfile({ ...profile, mode: "connected", sources });
      deps.changed();
      return {
        added: r.added,
        existing: r.existing,
        skipped: r.skipped,
        scheduled: r.scheduled,
        reviews: r.reviews,
      };
    },

    async tuning() {
      const lang = await deps.lang();
      return info(await repo.fsrsParams(lang), (await repo.nativeStats(lang)).reviews);
    },

    optimiseNow: tune,

    async autoTune() {
      if (profileMode(await deps.profile()) !== "native") return null;
      const lang = await deps.lang();
      const rec = await repo.fsrsParams(lang);
      const history = (await repo.nativeStats(lang)).reviews;
      const trained = rec && rec.reviews > 0;
      const due = trained
        ? (now() - rec.at >= RETUNE_MS && history > (rec.historySize ?? 0)) ||
          history - (rec.historySize ?? 0) >= RETUNE_REVIEWS
        : history >= FIRST_TUNE_REVIEWS;
      if (!due || history < MIN_TRAINING_REVIEWS) return null;
      return tune();
    },
  };

  return { services, invalidate: () => (ownIndex = null) };
}
