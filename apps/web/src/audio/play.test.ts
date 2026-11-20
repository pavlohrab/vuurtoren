import { describe, expect, it, vi } from "vitest";
import { type PlayerDeps, say } from "./play.js";

function deps(over: Partial<PlayerDeps> = {}): PlayerDeps {
  return {
    clip: vi.fn(async () => new Blob(["x"])),
    playBlob: vi.fn(async () => undefined),
    speak: vi.fn(async () => true),
    ...over,
  };
}

describe("saying a word", () => {
  it("plays the clip when the pack has it, at the chosen speed", async () => {
    const d = deps();
    expect(await say({ clip: "word-1", text: "het huis" }, 0.8, d)).toBe("clip");
    expect(d.playBlob).toHaveBeenCalledWith(expect.any(Blob), 0.8);
    expect(d.speak).not.toHaveBeenCalled();
  });

  it("falls back to the system voice without a clip, or when the clip cannot play", async () => {
    const none = deps({ clip: vi.fn(async () => null) });
    expect(await say({ clip: "word-1", text: "het huis" }, 1, none)).toBe("voice");
    expect(none.speak).toHaveBeenCalledWith("het huis", 1);
    const broken = deps({ playBlob: vi.fn(async () => Promise.reject(new Error("codec"))) });
    expect(await say({ clip: "word-1", text: "het huis" }, 1, broken)).toBe("voice");
    const offline = deps({ clip: vi.fn(async () => Promise.reject(new Error("offline"))) });
    expect(await say({ clip: "word-1", text: "het huis" }, 1, offline)).toBe("voice");
  });

  it("does nothing, quietly, when there is neither a clip nor a voice", async () => {
    const d = deps({ clip: vi.fn(async () => null), speak: vi.fn(async () => false) });
    expect(await say({ clip: "word-1", text: "het huis" }, 1, d)).toBe("none");
    expect(await say({}, 1, d)).toBe("none");
  });
});
