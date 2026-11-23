import { beforeEach, describe, expect, it } from "vitest";
import {
  ASK_AGAIN_DAYS,
  FIRST_ASK_DAYS,
  countDay,
  dayOf,
  readSupport,
  recordUse,
  shouldAsk,
  type SupportState,
} from "./support.js";

const fresh: SupportState = { days: 0, lastDay: null, askedAt: null, never: false };

describe("support ask", () => {
  beforeEach(() => localStorage.clear());

  it("counts each day once", () => {
    let s = countDay(fresh, "2026-11-23");
    s = countDay(s, "2026-11-23");
    s = countDay(s, "2026-11-24");
    expect(s.days).toBe(2);
    expect(s.lastDay).toBe("2026-11-24");
  });

  it("asks first after 10 days of use", () => {
    expect(shouldAsk({ ...fresh, days: FIRST_ASK_DAYS - 1 })).toBe(false);
    expect(shouldAsk({ ...fresh, days: FIRST_ASK_DAYS })).toBe(true);
  });

  it("asks again only after 60 more days", () => {
    const asked = { ...fresh, days: 12, askedAt: 12 };
    expect(shouldAsk({ ...asked, days: 12 + ASK_AGAIN_DAYS - 1 })).toBe(false);
    expect(shouldAsk({ ...asked, days: 12 + ASK_AGAIN_DAYS })).toBe(true);
  });

  it("never asks after Don't ask again", () => {
    expect(shouldAsk({ ...fresh, days: 500, never: true })).toBe(false);
  });

  it("records a day of use in storage", () => {
    recordUse(new Date(2026, 10, 23, 9));
    recordUse(new Date(2026, 10, 23, 22));
    recordUse(new Date(2026, 10, 25, 8));
    expect(readSupport()).toMatchObject({ days: 2, lastDay: "2026-11-25" });
  });

  it("treats a malformed value as a fresh start", () => {
    localStorage.setItem("vuurtoren-support", '{"days":"x","never":"yes"}');
    expect(readSupport()).toEqual(fresh);
  });

  it("formats the local day", () => {
    expect(dayOf(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
