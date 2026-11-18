import { describe, expect, it } from "vitest";
import { MAX_RPC_BATCH, MAX_RPC_EVENT_CHARS, isRpcMethod, validateRpcArgs } from "./rpc.js";

describe("rpc allow-list", () => {
  it("does not expose rebuild", () => {
    expect(isRpcMethod("rebuild")).toBe(false);
    expect(isRpcMethod("append")).toBe(true);
  });

  it("checks the shape of appended events", () => {
    expect(
      validateRpcArgs("append", [{ type: "WordLookedUp", lang: "nl", key: "a", textId: "t" }]),
    ).toBeNull();
    expect(validateRpcArgs("append", [{ type: "Nope" }])).toMatch(/unknown event type/);
    expect(validateRpcArgs("append", [{ lang: "nl" }])).toMatch(/unknown event type/);
    const huge = { type: "SettingChanged", key: "x", value: "a".repeat(MAX_RPC_EVENT_CHARS) };
    expect(validateRpcArgs("append", [huge])).toMatch(/too large/);
  });

  it("checks batched key lists", () => {
    expect(validateRpcArgs("wordsByKeys", ["nl", ["a", "b"]])).toBeNull();
    expect(validateRpcArgs("getTexts", [[]])).toBeNull();
    expect(validateRpcArgs("wordsByKeys", ["nl", "a"])).toMatch(/array of strings/);
    expect(validateRpcArgs("getTexts", [[1]])).toMatch(/array of strings/);
    expect(validateRpcArgs("getTexts", [Array(MAX_RPC_BATCH + 1).fill("x")])).toMatch(/at most/);
    expect(validateRpcArgs("head", [])).toBeNull();
  });
});
