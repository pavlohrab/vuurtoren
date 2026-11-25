import { beforeEach, describe, expect, it, vi } from "vitest";
import { isNewer, newVersion, readUpdates, writeUpdates } from "./updates.js";

const release = (tag: string) =>
  vi.fn(async () => new Response(JSON.stringify({ tag_name: tag }), { status: 200 }));

describe("isNewer", () => {
  it("compares versions by their numbers", () => {
    expect(isNewer("0.3.0", "0.2.9")).toBe(true);
    expect(isNewer("v0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.2", "0.2.1")).toBe(false);
    expect(isNewer("1.0.0-beta", "0.9.0")).toBe(true);
  });
});

describe("newVersion", () => {
  beforeEach(() => localStorage.clear());

  it("tells about a newer release, and asks GitHub at most once a day", async () => {
    const f = release("v0.3.0");
    expect(await newVersion(1000, f, "0.2.0")).toBe("0.3.0");
    expect(await newVersion(2000, f, "0.2.0")).toBe("0.3.0");
    expect(f).toHaveBeenCalledTimes(1);
    await newVersion(1000 + 24 * 3600 * 1000, f, "0.2.0");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("is quiet for the same version, after Not now, when off, and offline", async () => {
    expect(await newVersion(1000, release("v0.2.0"), "0.2.0")).toBeNull();
    localStorage.clear();
    writeUpdates({ dismissed: "0.3.0" });
    expect(await newVersion(1000, release("v0.3.0"), "0.2.0")).toBeNull();
    // The next version shows again.
    expect(await newVersion(1000 + 24 * 3600 * 1000, release("v0.4.0"), "0.2.0")).toBe("0.4.0");
    localStorage.clear();
    writeUpdates({ off: true });
    const f = release("v0.3.0");
    expect(await newVersion(1000, f, "0.2.0")).toBeNull();
    expect(f).not.toHaveBeenCalled();
    localStorage.clear();
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await newVersion(1000, offline, "0.2.0")).toBeNull();
    expect(readUpdates().checkedAt).toBe(1000);
  });
});
