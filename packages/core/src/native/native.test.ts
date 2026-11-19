import { describe, expect, it } from "vitest";
import { classifyCard } from "../memory.js";
import { defaultProfile, isLanguageProfile, migratedProfile, profileMode } from "../profile.js";
import {
  DEFAULT_DECK_OPTIONS,
  DEFAULT_FSRS_PARAMS,
  type CardReview,
  answerCard,
  clozeNumbers,
  formatInterval,
  paramsDecay,
  previewCard,
  renderTemplate,
  replayReviews,
  scheduleMemory,
  trainingSequences,
} from "./index.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 12);
const ctx = { options: DEFAULT_DECK_OPTIONS, params: DEFAULT_FSRS_PARAMS, fuzz: false };

describe("profile mode", () => {
  it("new profiles are native, migrated and old ones connected", () => {
    expect(profileMode(defaultProfile("nl"))).toBe("native");
    expect(profileMode(defaultProfile("nl", [], "connected"))).toBe("connected");
    expect(profileMode(migratedProfile("nl", "Deck", []))).toBe("connected");
    const old: Partial<ReturnType<typeof defaultProfile>> = defaultProfile("nl");
    delete old.mode;
    expect(isLanguageProfile(old)).toBe(true);
    expect(profileMode(old)).toBe("connected");
    expect(isLanguageProfile({ ...old, mode: "hybrid" })).toBe(false);
  });
});

describe("native scheduler", () => {
  it("walks a new card through its learning steps", () => {
    const again = answerCard(undefined, 1, T0, ctx);
    expect(again.state).toBe(1);
    expect(again.due - T0).toBe(60_000);
    const good = answerCard(undefined, 3, T0, ctx);
    expect(good.due - T0).toBe(10 * 60_000);
    const graduated = answerCard(good, 3, T0 + 10 * 60_000, ctx);
    expect(graduated.state).toBe(2);
    expect(graduated.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it("previews all four buttons, in increasing order", () => {
    const s = answerCard(answerCard(undefined, 3, T0, ctx), 3, T0 + 600_000, ctx);
    const p = previewCard(s, T0 + 5 * DAY, ctx);
    expect(p[1].due).toBeLessThan(p[2].due);
    expect(p[2].due).toBeLessThanOrEqual(p[3].due);
    expect(p[3].due).toBeLessThan(p[4].due);
    expect(p[1].state).toBe(3);
  });

  it("honours the maximum interval", () => {
    let s = answerCard(undefined, 4, T0, ctx);
    const short = { ...ctx, options: { ...DEFAULT_DECK_OPTIONS, maxInterval: 10 } };
    for (let i = 1; i < 8; i++) s = answerCard(s, 4, s.due, short);
    expect(s.scheduledDays).toBeLessThanOrEqual(10);
  });

  it("spreads due dates with fuzz on", () => {
    const base = answerCard(answerCard(undefined, 4, T0, ctx), 4, T0 + 20 * DAY, ctx);
    const dues = new Set<number>();
    for (let i = 0; i < 12; i++) {
      dues.add(answerCard(base, 3, base.due + i * 1000, { ...ctx, fuzz: true }).scheduledDays);
    }
    expect(dues.size).toBeGreaterThan(1);
  });

  it("replays a history to the same state as answering it live", () => {
    const reviews: CardReview[] = [
      { cardId: 1, at: T0, rating: 3, kind: "learn", durationMs: 0 },
      { cardId: 1, at: T0 + 600_000, rating: 3, kind: "learn", durationMs: 0 },
      { cardId: 1, at: T0 + 3 * DAY, rating: 3, kind: "review", durationMs: 0 },
      { cardId: 1, at: T0 + 2 * DAY, rating: 0, kind: "manual", durationMs: 0 },
    ];
    let live = answerCard(undefined, 3, T0, ctx);
    live = answerCard(live, 3, T0 + 600_000, ctx);
    live = answerCard(live, 3, T0 + 3 * DAY, ctx);
    expect(replayReviews(reviews, ctx)).toEqual(live);
    expect(replayReviews([], ctx)).toBeUndefined();
  });

  it("starts over after a reset", () => {
    const reviews: CardReview[] = [
      { cardId: 1, at: T0, rating: 4, kind: "learn", durationMs: 0 },
      { cardId: 1, at: T0 + 9 * DAY, rating: 3, kind: "review", durationMs: 0 },
      { cardId: 1, at: T0 + 10 * DAY, rating: 0, kind: "manual", durationMs: 0 },
      { cardId: 1, at: T0 + 11 * DAY, rating: 3, kind: "learn", durationMs: 0 },
    ];
    expect(replayReviews(reviews, ctx)).toEqual(answerCard(undefined, 3, T0 + 11 * DAY, ctx));
  });

  it("reads memory like an Anki card: known needs stability ≥ 21 days and R ≥ 0.6", () => {
    const decay = paramsDecay(DEFAULT_FSRS_PARAMS);
    expect(decay).toBeCloseTo(0.1542, 3);
    const mature = {
      due: T0 + 30 * DAY,
      stability: 30,
      difficulty: 5,
      scheduledDays: 30,
      learningSteps: 0,
      reps: 4,
      lapses: 0,
      state: 2 as const,
      lastReview: T0,
    };
    expect(classifyCard(scheduleMemory(mature, decay), T0 + DAY).state).toBe("known");
    const young = { ...mature, stability: 5, scheduledDays: 5 };
    expect(classifyCard(scheduleMemory(young, decay), T0 + DAY).state).toBe("learning");
    expect(classifyCard(scheduleMemory(undefined, decay), T0).state).toBe("unknown");
    const forgotten = classifyCard(scheduleMemory(mature, decay), T0 + 3000 * DAY);
    expect(forgotten.state).toBe("learning");
  });

  it("formats intervals", () => {
    expect(formatInterval(60_000)).toBe("1m");
    expect(formatInterval(3 * 3600_000)).toBe("3h");
    expect(formatInterval(4 * DAY)).toBe("4d");
    expect(formatInterval(90 * DAY)).toBe("3mo");
    expect(formatInterval(700 * DAY)).toBe("1.9y");
  });
});

describe("training sequences", () => {
  it("uses study days, skips cards without their start and restarts after a reset", () => {
    const r = (cardId: number, at: number, rating: 0 | 1 | 2 | 3 | 4, kind: CardReview["kind"]) =>
      ({ cardId, at, rating, kind, durationMs: 0 }) as CardReview;
    const seqs = trainingSequences(
      [
        r(1, T0, 3, "learn"),
        r(1, T0 + 600_000, 3, "learn"),
        r(1, T0 + 2 * DAY, 3, "review"),
        r(2, T0, 3, "review"),
        r(3, T0, 3, "learn"),
        r(3, T0 + DAY, 0, "manual"),
        r(3, T0 + 2 * DAY, 1, "learn"),
        r(3, T0 + 4 * DAY, 3, "review"),
      ],
      0,
    );
    expect(seqs).toEqual([
      { ratings: [3, 3, 3], deltaDays: [0, 0, 2] },
      { ratings: [1, 3], deltaDays: [0, 2] },
    ]);
  });
});

describe("templates", () => {
  const fields = {
    Front: "huis",
    Back: "house",
    Extra: "",
    Text: "Het {{c1::huis}} is {{c2::groot::size}}.",
  };
  it("renders fields, sections, FrontSide and sounds", () => {
    const front = renderTemplate(
      "{{Front}}{{#Extra}}<i>{{Extra}}</i>{{/Extra}}[sound:a.mp3]",
      fields,
      0,
      false,
    );
    expect(front).toEqual({ html: "huis", audio: ["a.mp3"] });
    const back = renderTemplate(
      "{{FrontSide}}<hr id=answer>{{Back}}{{^Extra}}!{{/Extra}}",
      fields,
      0,
      true,
      front.html,
    );
    expect(back.html).toBe("huis<hr id=answer>house!");
  });
  it("renders clozes per card", () => {
    expect(clozeNumbers([fields.Text])).toEqual([1, 2]);
    expect(renderTemplate("{{cloze:Text}}", fields, 1, false).html).toBe(
      'Het huis is <span class="cloze">[size]</span>.',
    );
    expect(renderTemplate("{{cloze:Text}}", fields, 0, true).html).toBe(
      'Het <span class="cloze">huis</span> is groot.',
    );
  });
});
