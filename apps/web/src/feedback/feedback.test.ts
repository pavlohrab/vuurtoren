import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deviceLine,
  newReport,
  recordError,
  sendReport,
  submit,
  SendRefused,
  feedbackOn,
} from "./feedback.js";

afterEach(() => vi.unstubAllEnvs());

const PIXEL =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP4A.250105.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36";

describe("the feedback button's report (FB1)", () => {
  it("is off without a key in the build", () => {
    vi.stubEnv("VITE_FEEDBACK_KEY", "");
    expect(feedbackOn()).toBe(false);
    vi.stubEnv("VITE_FEEDBACK_KEY", "k");
    expect(feedbackOn()).toBe(true);
  });

  it("names the device in plain words", () => {
    expect(deviceLine(PIXEL, "android")).toBe("Android 15, Pixel 8");
    expect(deviceLine("Mozilla/5.0 (X11; Linux x86_64)", "desktop")).toBe("Linux, desktop app");
    expect(
      deviceLine("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/133.0", "browser"),
    ).toBe("Firefox on Windows");
  });

  it("carries the error the tester was looking at, and the last ones seen", () => {
    recordError("The dictionary is still downloading.");
    const r = newReport({
      text: "  it says verb  ",
      screen: "/read/t42",
      kind: "android",
      userAgent: PIXEL,
      replies: true,
      error: "Grammar needs the language server.",
    });
    expect(r.text).toBe("it says verb");
    expect(r.kind).toBe("phone");
    expect(r.errors.slice(0, 2)).toEqual([
      "Grammar needs the language server.",
      "The dictionary is still downloading.",
    ]);
    expect(r.replyTo).toMatch(/^d-[0-9a-f]{24}$/);
    // The same device id each time, so Pavlo's replies find it.
    expect(
      newReport({ text: "x", screen: "/", kind: "android", userAgent: PIXEL, replies: true })
        .replyTo,
    ).toBe(r.replyTo);
    expect(
      newReport({ text: "x", screen: "/", kind: "android", userAgent: PIXEL, replies: false })
        .replyTo,
    ).toBeUndefined();
  });

  it("sends the report with the key, and a refusal says why", async () => {
    vi.stubEnv("VITE_FEEDBACK_KEY", "k");
    const report = newReport({
      text: "x",
      screen: "/",
      kind: "desktop",
      userAgent: "Linux",
      replies: false,
    });
    const ok = vi.fn(
      async (u: string, i?: RequestInit) => (void u, void i, new Response("{}", { status: 200 })),
    );
    await sendReport(report, {}, ok as unknown as typeof fetch);
    const [url, init] = ok.mock.calls[0]!;
    expect(url).toBe("https://issue.vuurtoren.app/v1/report");
    expect((init!.headers as Record<string, string>)["x-vuurtoren-key"]).toBe("k");
    const no = async () =>
      new Response(JSON.stringify({ error: "The picture is too big." }), { status: 413 });
    await expect(submit(report, {}, no as unknown as typeof fetch)).rejects.toBeInstanceOf(
      SendRefused,
    );
  });

  it("keeps a report the server couldn't take now (5xx, 429): only a real no is final", async () => {
    vi.stubEnv("VITE_FEEDBACK_KEY", "k");
    const report = newReport({
      text: "x",
      screen: "/",
      kind: "desktop",
      userAgent: "Linux",
      replies: false,
    });
    for (const status of [500, 502, 429]) {
      const down = async () => new Response("{}", { status });
      const sent = sendReport(report, {}, down as unknown as typeof fetch);
      await expect(sent).rejects.toThrow();
      await expect(sent).rejects.not.toBeInstanceOf(SendRefused);
    }
  });
});
