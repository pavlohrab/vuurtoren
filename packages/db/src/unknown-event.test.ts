import { describe, expect, it } from "vitest";
import { createNodeDriver } from "./node.js";
import { applyEvent } from "./projections.js";
import { migrate } from "./schema.js";
import type { AppEvent } from "./types.js";

describe("unknown event types (written by a newer app)", () => {
  it("are skipped by the projections instead of failing the rebuild", async () => {
    const driver = await createNodeDriver();
    await migrate(driver);
    const event = { type: "FromTheFuture", x: 1 } as unknown as AppEvent;
    await expect(
      applyEvent(driver, { id: "01", hlc: "0", createdAt: 1, event }),
    ).resolves.toBeUndefined();
  });
});
