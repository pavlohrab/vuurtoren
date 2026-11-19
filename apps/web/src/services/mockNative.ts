/** Native mode for the demo and screen tests: a few cards held in memory. */
import {
  type CardRating,
  type CardSchedule,
  DEFAULT_DECK_OPTIONS,
  DEFAULT_FSRS_PARAMS,
  type LanguageProfile,
  answerCard,
  formatInterval,
  previewCard,
} from "@app/core";
import type { NativeServices, ReviewCard, TuningInfo } from "./nativeTypes.js";

interface MockCard {
  card: Omit<ReviewCard, "intervals" | "isNew">;
  schedule?: CardSchedule;
}

const DECK = "Kenning::Nederlands";
const ctx = { options: DEFAULT_DECK_OPTIONS, params: DEFAULT_FSRS_PARAMS, fuzz: false };

const vocab = (
  cardId: number,
  word: string,
  gloss: string,
  sentence: string,
  extra: Partial<ReviewCard> = {},
): MockCard => ({
  card: {
    cardId,
    deck: DECK,
    layout: "vocab",
    word,
    gloss,
    sentence,
    front: "",
    back: "",
    audioFront: [],
    audioBack: [],
    media: {},
    ...extra,
  },
});

function demoCards(now: number): MockCard[] {
  const day = 86_400_000;
  const reviewed = (c: MockCard, daysAgo: number): MockCard => {
    let s = answerCard(undefined, 3, now - daysAgo * day, ctx);
    s = answerCard(s, 3, now - daysAgo * day + 600_000, ctx);
    return { ...c, schedule: { ...s, due: now - 1000 } };
  };
  return [
    reviewed(
      vocab(1, "de fiets", "bicycle", "Ik ga met de fiets naar mijn werk.", {
        sentenceTranslation: "I cycle to work.",
        ownSentence: {
          text: "Hij zet zijn fiets tegen de muur.",
          title: "Een dag in Utrecht",
          highlight: [13, 18],
        },
      }),
      3,
    ),
    reviewed(vocab(2, "gezellig", "cosy, pleasant", "Het was een gezellige avond."), 2),
    {
      card: {
        cardId: 3,
        deck: "Opmaat",
        layout: "cloze",
        front: 'Wij <span class="cloze">[…]</span> elke dag naar school.',
        back: 'Wij <span class="cloze">lopen</span> elke dag naar school.<br>We walk to school every day.',
        audioFront: [],
        audioBack: [],
        media: {},
      },
    },
    {
      card: {
        cardId: 4,
        deck: "Opmaat",
        layout: "template",
        front: "<div>Wat betekent <b>de afspraak</b>?</div>",
        back: "<div>Wat betekent <b>de afspraak</b>?</div><hr id=answer>the appointment",
        audioFront: [],
        audioBack: [],
        media: {},
      },
    },
  ];
}

export function createMockNative(
  wait: () => Promise<void>,
  profile: {
    current: () => LanguageProfile;
    save: (p: LanguageProfile) => Promise<void>;
  },
  now: () => number = Date.now,
): NativeServices {
  const cards = demoCards(now());
  const undo = new Map<string, { cardId: number; schedule: CardSchedule | undefined }>();
  let seq = 0;
  let tuning: TuningInfo = { tuned: false, at: null, reviewsUsed: 0, history: 6 };
  const isDue = (c: MockCard) => !c.schedule || c.schedule.due <= now();
  const view = (c: MockCard): ReviewCard => {
    const p = previewCard(c.schedule, now(), ctx);
    const intervals = {} as Record<CardRating, string>;
    for (const r of [1, 2, 3, 4] as const) intervals[r] = formatInterval(p[r].due - now());
    return { ...c.card, isNew: !c.schedule, intervals };
  };
  const native = () => profile.current().mode === "native";
  return {
    async reviewOverview() {
      await wait();
      if (!native()) return { native: false, due: 0, fresh: 0 };
      const due = cards.filter((c) => c.schedule && isDue(c)).length;
      return { native: true, due, fresh: cards.filter((c) => !c.schedule).length };
    },
    async reviewQueue() {
      await wait();
      const queue = cards.filter(isDue);
      return {
        cards: queue.map(view),
        due: queue.filter((c) => c.schedule).length,
        fresh: queue.filter((c) => !c.schedule).length,
      };
    },
    async answerReview(cardId, rating) {
      await wait();
      const c = cards.find((x) => x.card.cardId === cardId);
      if (!c) throw new Error("This card no longer exists.");
      const reviewId = String(++seq);
      undo.set(reviewId, { cardId, schedule: c.schedule });
      c.schedule = answerCard(c.schedule, rating, now(), ctx);
      return { reviewId };
    },
    async undoReview(cardId, reviewId) {
      await wait();
      const u = undo.get(reviewId);
      const c = cards.find((x) => x.card.cardId === cardId);
      if (u && c) {
        if (u.schedule) c.schedule = u.schedule;
        else delete c.schedule;
      }
    },
    async mediaFile() {
      return null;
    },
    async nativeDecks() {
      await wait();
      return [DECK, "Opmaat"].map((name) => {
        const own = cards.filter((c) => c.card.deck === name);
        return {
          name,
          options: DEFAULT_DECK_OPTIONS,
          total: own.length,
          fresh: own.filter((c) => !c.schedule).length,
          due: own.filter((c) => c.schedule && isDue(c)).length,
          suspended: 0,
          // Demo: a deck of about 400 reviewed cards.
          load: [0.8, 0.85, 0.87, 0.9, 0.92, 0.95, 0.97].map((retention) => ({
            retention,
            perDay: Math.round(20 + 12 / (1 - retention) / 4),
          })),
        };
      });
    },
    async setDeckOptions() {
      await wait();
    },
    async openPackage(file) {
      await wait();
      return {
        token: file.name,
        decks: [
          { name: "De Opmaat::Thema 01", notes: 48, cards: 48, reviews: 0 },
          { name: "De Opmaat::Thema 02", notes: 52, cards: 52, reviews: 0 },
        ],
      };
    },
    async importPackage(_token, decks, onProgress) {
      onProgress?.("Reading headwords");
      await wait();
      const notes = decks.length * 50;
      return { notes, cards: notes, reviews: 0, vocabNotes: notes, media: 0, skippedMedia: 0 };
    },
    async moveFromAnki(onProgress) {
      onProgress?.("Reading your decks in Anki");
      await wait();
      await profile.save({ ...profile.current(), mode: "native" });
      return {
        notes: 2412,
        cards: 4824,
        reviews: 31877,
        vocabNotes: 2390,
        media: 12,
        skippedMedia: 0,
      };
    },
    async exportPackage(decks) {
      await wait();
      const reviewed = cards.filter((c) => c.schedule).length;
      return {
        // Demo data: an empty zip stands in for the package.
        bytes: new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]),
        fileName: `${decks.length === 1 ? decks[0]!.replace(/::/g, "-") : "Kenning"}.apkg`,
        summary: { notes: cards.length, cards: cards.length, reviews: reviewed * 3, media: 0 },
      };
    },
    async moveToAnki(withHistory, onProgress) {
      onProgress?.("Adding your words to Anki");
      await wait();
      await profile.save({ ...profile.current(), mode: "connected" });
      return {
        added: cards.length,
        existing: 0,
        skipped: 0,
        scheduled: cards.filter((c) => c.schedule).length,
        reviews: withHistory ? cards.filter((c) => c.schedule).length * 3 : 0,
      };
    },
    async tuning() {
      await wait();
      return tuning;
    },
    async optimiseNow(onProgress) {
      onProgress?.("Training on your reviews");
      await wait();
      tuning = {
        tuned: true,
        at: now(),
        reviewsUsed: 31877,
        history: 31877,
        logLoss: 0.3121,
        rmse: 0.0234,
        previousLogLoss: 0.3378,
        previousRmse: 0.0412,
      };
      return { ...tuning, improved: true };
    },
    async autoTune() {
      return null;
    },
  };
}
