import type { CardState, NoteCardStatus } from "@app/anki";
import type { WordInfo } from "@app/db";
import { describe, expect, it } from "vitest";
import { absentAnki, ankiFromStatus, chooseNote, unavailableAnki } from "./ankiState.js";

const card = (o: Partial<CardState> & { cardId: number }): CardState => ({
  type: "new",
  suspended: false,
  buried: false,
  intervalDays: 0,
  ...o,
});
const note = (noteId: number, deck: string, cards: CardState[]): NoteCardStatus => ({
  noteId,
  deck,
  cards,
});
const info = (o: Partial<WordInfo> = {}): WordInfo => ({
  key: "boodschap",
  state: "unknown",
  pKnown: 0,
  source: "anki",
  decks: [],
  lookups: 0,
  noteIds: [1],
  ...o,
});

describe("ankiFromStatus", () => {
  it("new card", () => {
    expect(ankiFromStatus(info(), [note(1, "Freq", [card({ cardId: 10 })])])).toEqual({
      status: "new",
      detail: "New card · in Freq",
      deck: "Freq",
      noteIds: [1],
      cardIds: [10],
      prioritized: false,
      markedKnown: false,
      overridden: false,
    });
  });

  it("prioritised new card says it is next", () => {
    const a = ankiFromStatus(info({ prioritized: true }), [
      note(1, "Freq", [card({ cardId: 10 })]),
    ]);
    expect(a.detail).toBe("New card · next in Freq");
    expect(a.prioritized).toBe(true);
  });

  it("suspended new card", () => {
    const a = ankiFromStatus(info(), [note(1, "Freq", [card({ cardId: 10, suspended: true })])]);
    expect(a).toMatchObject({ status: "suspended", detail: "Suspended" });
  });

  it("review card with due text, and a suspended mature card stays 'review'", () => {
    const review = card({ cardId: 10, type: "review", intervalDays: 30, dueText: "due in 6 days" });
    expect(ankiFromStatus(info(), [note(1, "Freq", [review])])).toMatchObject({
      status: "review",
      detail: "In review · due in 6 days",
    });
    expect(
      ankiFromStatus(info(), [
        note(1, "Freq", [card({ cardId: 10, type: "review", intervalDays: 30, suspended: true })]),
      ]),
    ).toMatchObject({ status: "review", detail: "In review · suspended" });
  });

  it("learning card", () => {
    expect(
      ankiFromStatus(info(), [note(1, "Freq", [card({ cardId: 10, type: "learning" })])]),
    ).toMatchObject({ status: "learning", detail: "Learning" });
  });

  it("a note with one studied card counts as in progress", () => {
    const a = ankiFromStatus(info(), [
      note(1, "Opmaat", [card({ cardId: 10 }), card({ cardId: 11, type: "review" })]),
    ]);
    expect(a.status).toBe("review");
    expect(a.cardIds).toEqual([10, 11]);
  });

  it("prefers the first note being studied, otherwise the first note", () => {
    const fresh = note(1, "A", [card({ cardId: 10 })]);
    const studied = note(2, "B", [card({ cardId: 20, type: "review" })]);
    expect(chooseNote([fresh, studied])?.noteId).toBe(2);
    expect(chooseNote([fresh, note(3, "C", [card({ cardId: 30 })])])?.noteId).toBe(1);
    expect(chooseNote([note(1, "A", [])])).toBeUndefined();
  });

  it("is absent when Anki no longer has the notes", () => {
    expect(ankiFromStatus(info(), [])).toMatchObject({ status: "absent", noteIds: [] });
  });

  it("carries the local flags", () => {
    const a = ankiFromStatus(info({ markedKnownInAnki: true, overridden: true }), [
      note(1, "Freq", [card({ cardId: 10, type: "review" })]),
    ]);
    expect(a).toMatchObject({ markedKnown: true, overridden: true });
  });
});

describe("absent and unavailable", () => {
  it("absent has no ids", () => {
    expect(absentAnki(null)).toEqual({
      status: "absent",
      noteIds: [],
      cardIds: [],
      prioritized: false,
      markedKnown: false,
      overridden: false,
    });
  });

  it("unavailable keeps the notes and shows the reason", () => {
    expect(unavailableAnki(info({ noteIds: [4] }), "no answer within 3s")).toMatchObject({
      status: "unavailable",
      detail: "no answer within 3s",
      noteIds: [4],
    });
  });
});
