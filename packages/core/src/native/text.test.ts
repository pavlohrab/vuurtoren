import { describe, expect, it } from "vitest";
import { stripHtml, studyDayStart } from "./text.js";

describe("text helpers", () => {
  it("starts the study day at 4:00", () => {
    const d = new Date(2026, 5, 2, 3, 0).getTime();
    expect(new Date(studyDayStart(d)).getDate()).toBe(1);
    expect(new Date(studyDayStart(d + 2 * 3600_000)).getHours()).toBe(4);
  });

  it("strips tags and non-breaking spaces", () => {
    expect(stripHtml("<b>huis</b>&nbsp;x ")).toBe("huis x ");
  });
});
