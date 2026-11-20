import { defaultProfile, migratedProfile } from "@app/core";
import { describe, expect, it } from "vitest";
import { createNodeDriver } from "./node.js";
import { applyEvent } from "./projections.js";
import { createRepository } from "./repository.js";

async function newRepo() {
  let t = 1_000_000;
  const driver = await createNodeDriver();
  const repo = await createRepository(driver, { deviceId: "dev1", now: () => t++ });
  return { repo, driver };
}

describe("LanguageProfileSet", () => {
  it("projects the profile per language and survives a rebuild", async () => {
    const { repo } = await newRepo();
    expect(await repo.languageProfile("nl")).toBeNull();
    const p = defaultProfile("nl", [{ deck: "Dutch 5000", wordField: "Word" }]);
    await repo.append({ type: "LanguageProfileSet", profile: p });
    expect(await repo.languageProfile("nl")).toEqual(p);
    expect(await repo.languageProfile("uk")).toBeNull();
    await repo.rebuild();
    expect(await repo.languageProfile("nl")).toEqual(p);
    await repo.close();
  });

  it("is last-write-wins by HLC regardless of arrival order", async () => {
    const { repo, driver } = await newRepo();
    const older = await repo.append({
      type: "LanguageProfileSet",
      profile: migratedProfile("nl", "Old", []),
    });
    const newer = await repo.append({ type: "LanguageProfileSet", profile: defaultProfile("nl") });
    // Replaying the older event late must not win.
    await applyEvent(driver, { id: older.id, hlc: older.hlc, createdAt: 0, event: older.event });
    expect((await repo.languageProfile("nl"))?.destinations.default).toBe("Vuurtoren::Nederlands");
    expect(newer.hlc > older.hlc).toBe(true);
    await repo.close();
  });
});
