import { afterEach, describe, expect, it } from "vitest";
import { watchKeyboard } from "./keyboardHints.js";

const root = document.documentElement;
afterEach(() => delete root.dataset["keyboard"]);

const press = (key: string, target: EventTarget = document.body, extra: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...extra }));

describe("keyboard hints", () => {
  it("show once a hardware keyboard is used, not for a soft keyboard typing in a field", () => {
    const stop = watchKeyboard();
    const field = document.createElement("input");
    document.body.append(field);
    try {
      press("a", field);
      press("Unidentified");
      press("x", document.body, { keyCode: 229 });
      expect(root.dataset["keyboard"]).toBeUndefined();
      press(" ");
      expect(root.dataset["keyboard"]).toBe("");
    } finally {
      field.remove();
      stop();
    }
  });

  it("Escape in a field also says a keyboard is there", () => {
    const stop = watchKeyboard();
    const field = document.createElement("textarea");
    document.body.append(field);
    try {
      press("Escape", field);
      expect(root.dataset["keyboard"]).toBe("");
    } finally {
      field.remove();
      stop();
    }
  });
});
