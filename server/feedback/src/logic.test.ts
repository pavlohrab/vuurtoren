import { describe, expect, it } from "vitest";
import {
  hasContent,
  headline,
  issueBody,
  issueLabels,
  issueTitle,
  message,
  readReport,
  screenName,
} from "./logic.js";

const sent = {
  id: "r-1234abcd",
  text: '"aardbeien" opens the card for "aardbei" but says it\'s a verb',
  version: "26e (b7c1d68)",
  device: "Android 15, Pixel 8",
  kind: "phone",
  screen: "/read/t42",
  errors: [],
  replyTo: "dev-5678efgh",
};

describe("the feedback Worker's logic", () => {
  it("takes a report as sent, and refuses one without an id", () => {
    const r = readReport(sent);
    expect("report" in r && r.report.replyTo).toBe("dev-5678efgh");
    expect(readReport({ ...sent, id: "x" })).toEqual({ error: "No report id." });
    expect(readReport(null)).toEqual({ error: "No report." });
  });

  it("trims what is too long and drops what isn't text", () => {
    const r = readReport({ ...sent, text: "a".repeat(5000), errors: ["e", 3, "f".repeat(400)] });
    if (!("report" in r)) throw new Error("refused");
    expect(r.report.text).toHaveLength(4000);
    expect(r.report.errors).toEqual(["e", "f".repeat(300)]);
  });

  it("needs words, a voice note or a picture", () => {
    const r = readReport({ ...sent, text: "" });
    if (!("report" in r)) throw new Error("refused");
    expect(hasContent(r.report, { screenshot: false, voice: false })).toBe(false);
    expect(hasContent(r.report, { screenshot: false, voice: true })).toBe(true);
  });

  it("writes Pavlo's message and the issue, with no name and no picture", () => {
    const r = readReport(sent);
    if (!("report" in r)) throw new Error("refused");
    expect(screenName("/words/all?state=decide")).toBe("Words");
    expect(headline(r.report)).toBe("Phone · 26e · Read");
    const m = message(r.report, "it says verb");
    expect(m).toContain("🎙 it says verb");
    expect(m).toContain("Reply to this message");
    expect(issueTitle(r.report, null)).toBe(sent.text);
    const body = issueBody(r.report, null);
    expect(body).toContain("Version: 26e (b7c1d68)");
    expect(body).not.toContain("dev-5678efgh");
  });

  it("labels the issue: from a tester, desktop or phone, and the platform", () => {
    const phone = readReport(sent);
    const desk = readReport({ ...sent, kind: "computer", device: "Linux, desktop app" });
    const mac = readReport({ ...sent, kind: "computer", device: "Safari on macOS" });
    if (!("report" in phone) || !("report" in desk) || !("report" in mac)) throw new Error("refused");
    expect(issueLabels(phone.report)).toEqual(["from a tester", "phone", "android"]);
    expect(issueLabels(desk.report)).toEqual(["from a tester", "desktop", "linux"]);
    expect(issueLabels(mac.report)).toEqual(["from a tester", "desktop", "macos"]);
  });
});
